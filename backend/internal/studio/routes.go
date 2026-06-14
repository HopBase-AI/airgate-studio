package studio

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	sdk "github.com/DouDOU-start/airgate-sdk/sdkgo"
)

const headerUserID = "X-Airgate-User-Id"

func registerRoutes(p *StudioPlugin, r sdk.RouteRegistrar) {
	r.Handle(http.MethodPost, "/generation-tasks", p.handleCreateGenerationTask)
	r.Handle(http.MethodGet, "/generation-tasks", p.handleListGenerationTasks)
	r.Handle(http.MethodGet, "/generation-tasks/", p.handleGetGenerationTask)
	r.Handle(http.MethodDelete, "/generation-tasks/", p.handleDeleteGenerationTask)
	r.Handle(http.MethodGet, "/platforms", p.handleListPlatforms)
	r.Handle(http.MethodGet, "/models", p.handleListModels)

	// 项目 / 资产（需要 DB；用 requireProjectService 守护，未配置态返回 503）。
	// 路由匹配为「先精确、再最长 `/` 前缀」，故 /projects/{id} 与 /projects/{id}/assets
	// 都落在 GET|POST /projects/ 前缀下，由 handler 内按是否以 /assets 结尾分流。
	r.Handle(http.MethodGet, "/projects", p.requireProjectService(p.handleListProjects))
	r.Handle(http.MethodPost, "/projects", p.requireProjectService(p.handleCreateProject))
	r.Handle(http.MethodGet, "/projects/", p.requireProjectService(p.handleProjectGet))
	r.Handle(http.MethodPost, "/projects/", p.requireProjectService(p.handleProjectPost))
	r.Handle(http.MethodPut, "/projects/", p.requireProjectService(p.handleUpdateProject))
	r.Handle(http.MethodDelete, "/projects/", p.requireProjectService(p.handleProjectDelete))

	// 暂停发布：Skills 会触发额外同步 LLM 调用，先不注册路由，避免隐藏入口外仍可产生成本。
	// r.Handle(http.MethodPost, "/skills/rewrite-prompt", p.requireUser(p.handleRewritePrompt))
	// r.Handle(http.MethodPost, "/skills/caption-image", p.requireUser(p.handleCaptionImage))
}

// requireUser 守护需要用户身份但不依赖 DB 的路由（如 skills）。
func (p *StudioPlugin) requireUser(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get(headerUserID) == "" {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing user identity"})
			return
		}
		next(w, r)
	}
}

// requireProjectService 守护需要持久化的路由：DB 未配置时返回 503，缺用户身份时返回 401。
func (p *StudioPlugin) requireProjectService(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !p.Configured() {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "studio 项目功能未配置（缺少数据库）"})
			return
		}
		if r.Header.Get(headerUserID) == "" {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing user identity"})
			return
		}
		next(w, r)
	}
}

func parseUserID(r *http.Request) int {
	id, _ := strconv.Atoi(r.Header.Get(headerUserID))
	return id
}

func parseUserIDInt64(r *http.Request) int64 {
	id, _ := strconv.ParseInt(r.Header.Get(headerUserID), 10, 64)
	return id
}

// handleProjectGet 分流 GET /projects/{id}... ：以 /assets 结尾→列资产；否则 404。
func (p *StudioPlugin) handleProjectGet(w http.ResponseWriter, r *http.Request) {
	if strings.HasSuffix(r.URL.Path, "/assets") {
		p.handleListProjectAssets(w, r)
		return
	}
	writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
}

// handleProjectPost 分流 POST /projects/{id}... ：以 /assets 结尾→加资产；否则 404。
func (p *StudioPlugin) handleProjectPost(w http.ResponseWriter, r *http.Request) {
	if strings.HasSuffix(r.URL.Path, "/assets") {
		p.handleAddProjectAsset(w, r)
		return
	}
	writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
}

// handleProjectDelete 分流 DELETE /projects/{id}... ：含 /assets/{assetID}→删资产；否则删项目。
func (p *StudioPlugin) handleProjectDelete(w http.ResponseWriter, r *http.Request) {
	if strings.Contains(r.URL.Path, "/assets/") {
		p.handleDeleteProjectAsset(w, r)
		return
	}
	p.handleDeleteProject(w, r)
}

func (p *StudioPlugin) handleCreateGenerationTask(w http.ResponseWriter, r *http.Request) {
	var req createGenerationTaskRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	normalizeGenerationRequest(&req)

	if req.Prompt == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "prompt is required"})
		return
	}
	if req.Model == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "model is required"})
		return
	}
	userID, _ := strconv.ParseInt(r.Header.Get("X-Airgate-User-Id"), 10, 64)

	taskType := resolveTaskType(req.Kind, req.Operation)
	input := buildTaskInput(req)
	attributes := buildTaskAttributes(req)

	task, err := hostCreateTask(r.Context(), p.host, executorPluginID, taskType, userID, input, attributes)
	if err != nil {
		p.logger.Error("create_generation_task_failed", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "创建任务失败: " + err.Error()})
		return
	}

	writeJSON(w, http.StatusAccepted, buildGenerationTaskResponse(task))
}

func (p *StudioPlugin) handleGetGenerationTask(w http.ResponseWriter, r *http.Request) {
	taskIDStr := strings.TrimPrefix(r.URL.Path, "/generation-tasks/")
	taskID, err := strconv.ParseInt(taskIDStr, 10, 64)
	if err != nil || taskID <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid task_id"})
		return
	}

	userID, _ := strconv.ParseInt(r.Header.Get("X-Airgate-User-Id"), 10, 64)
	task, err := hostGetTask(r.Context(), p.host, executorPluginID, userID, taskID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "查询任务失败: " + err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, buildGenerationTaskResponse(task))
}

func (p *StudioPlugin) handleDeleteGenerationTask(w http.ResponseWriter, r *http.Request) {
	taskIDStr := strings.TrimPrefix(r.URL.Path, "/generation-tasks/")
	taskID, err := strconv.ParseInt(taskIDStr, 10, 64)
	if err != nil || taskID <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid task_id"})
		return
	}

	userID, _ := strconv.ParseInt(r.Header.Get("X-Airgate-User-Id"), 10, 64)
	if err := hostDeleteTask(r.Context(), p.host, executorPluginID, userID, taskID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "删除任务失败: " + err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (p *StudioPlugin) handleListGenerationTasks(w http.ResponseWriter, r *http.Request) {
	userID, _ := strconv.ParseInt(r.Header.Get("X-Airgate-User-Id"), 10, 64)

	limit := 20
	if v, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && v > 0 && v <= 100 {
		limit = v
	}
	offset := 0
	if v, err := strconv.Atoi(r.URL.Query().Get("offset")); err == nil && v >= 0 {
		offset = v
	}
	status := r.URL.Query().Get("status")

	result, err := hostListTasks(r.Context(), p.host, executorPluginID, userID, "", status, limit, offset)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "查询任务列表失败: " + err.Error()})
		return
	}

	tasks := make([]map[string]interface{}, 0, len(result.Tasks))
	for _, t := range result.Tasks {
		tasks = append(tasks, buildGenerationTaskResponse(t))
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"tasks": tasks, "total": result.Total})
}

func (p *StudioPlugin) handleListPlatforms(w http.ResponseWriter, r *http.Request) {
	platforms, err := hostListPlatforms(r.Context(), p.host)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"platforms": platforms})
}

func (p *StudioPlugin) handleListModels(w http.ResponseWriter, r *http.Request) {
	platform := r.URL.Query().Get("platform")
	capability := r.URL.Query().Get("capability")
	models, err := hostListModels(r.Context(), p.host, platform, capability)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"models": models})
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}
