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
	// Generation history and task operations are user-owned.  Keep the guard at
	// the plugin boundary as well as in the Core task query: the admin extension
	// entry can otherwise arrive with user id 0, which Core intentionally treats
	// as an internal, unscoped caller.
	r.Handle(http.MethodPost, "/generation-tasks", p.requireUser(p.handleCreateGenerationTask))
	r.Handle(http.MethodGet, "/generation-tasks", p.requireUser(p.handleListGenerationTasks))
	r.Handle(http.MethodGet, "/generation-tasks/", p.requireUser(p.handleGetGenerationTask))
	r.Handle(http.MethodDelete, "/generation-tasks/", p.requireUser(p.handleDeleteGenerationTask))
	r.Handle(http.MethodGet, "/platforms", p.handleListPlatforms)
	r.Handle(http.MethodGet, "/models", p.handleListModels)
	r.Handle(http.MethodGet, "/image-groups", p.requireUser(p.handleListImageGroups))
	r.Handle(http.MethodGet, "/inspirations", p.handleListInspirations)

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
		if parseUserIDInt64(r) <= 0 {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing or invalid user identity"})
			return
		}
		next(w, r)
	}
}

// requireProjectService 守护需要持久化的路由：DB 未配置时返回 503，缺用户身份时返回 401。
func (p *StudioPlugin) requireProjectService(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if parseUserIDInt64(r) <= 0 {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing or invalid user identity"})
			return
		}
		if !p.Configured() {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "studio 项目功能未配置（缺少数据库）"})
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
	if req.ProjectID < 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "project_id must be non-negative"})
		return
	}
	isVideo := req.Kind == "video"
	if isVideo {
		if err := validateVideoModelParams(req.Model, req.Parameters); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
	} else if err := validateImageModelSize(req.Model, req.Parameters); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	userID, _ := strconv.ParseInt(r.Header.Get("X-Airgate-User-Id"), 10, 64)

	// 先校验该平台确实有当前用户可用的分组；显式传 group_id 时再校验该分组。
	// core 的 gateway.forward 侧还有专属分组授权兜底，这里用于给前端明确错误。
	if isVideo {
		if err := validateVideoGenerationAccess(r.Context(), p.host, userID, req.GroupID, req.Platform, req.Model); err != nil {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": err.Error()})
			return
		}
	} else if err := validateGenerationAccess(r.Context(), p.host, userID, req.GroupID, req.Platform, req.Model); err != nil {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": err.Error()})
		return
	}

	taskType := resolveTaskType(req.Kind, req.Operation)
	input := buildTaskInput(req)
	// 参考图落盘后在 input 里是相对地址（core 的 normalizeTaskInputAssets 把
	// ≥16KB 的 data:image/* 换成 /assets-runtime/...）。把参考图直接交给上游拉取的
	// 执行器（视频全家 + gateway-seedance 生图）需要本站对外基地址才能还原成绝对
	// URL，否则任务会以「参考图是相对地址但任务未携带 public_base」失败；
	// 从反代注入的 X-Forwarded-* 推断。其余执行器不读这个键，多带无害。
	if base := publicBaseFromRequest(r); base != "" {
		input["public_base"] = base
	}
	attributes := buildTaskAttributes(req)
	executorID := generationExecutorPluginID(req.Platform)
	if !executorSupportsTaskType(executorID, taskType) || !executorSupportsOperation(executorID, req.Operation) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "该平台不支持当前图片编辑方式，请更换模型或模式"})
		return
	}

	task, err := hostCreateTask(r.Context(), p.host, executorID, taskType, userID, input, attributes)
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
	task, err := hostGetTaskFromPlugins(r.Context(), p.host, generationExecutorPluginIDs(), userID, taskID)
	if err != nil {
		if isHostTaskNotFound(err) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "task not found"})
			return
		}
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
	if err := hostDeleteTaskFromPlugins(r.Context(), p.host, generationExecutorPluginIDs(), userID, taskID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "删除任务失败: " + err.Error()})
		return
	}
	if p.svc != nil {
		if err := p.svc.DeleteAssetsByTask(r.Context(), int(userID), taskID); err != nil && p.logger != nil {
			// The host task is already deleted. Keep the API successful and let the
			// frontend tombstone hide any late/stale project row while we retain the
			// cleanup failure in logs for repair.
			p.logger.Error("delete_generation_task_project_assets_failed", "user_id", userID, "task_id", taskID, "error", err)
		}
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

	result, err := hostListTasks(r.Context(), p.host, generationExecutorPluginIDs(), userID, "", status, limit, offset)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "查询任务列表失败: " + err.Error()})
		return
	}

	tasks := make([]map[string]interface{}, 0, len(result.Tasks))
	for _, t := range result.Tasks {
		// 执行插件还有 ToB API 影子任务（video.api / minimax-api）与审计任务，
		// 不属于工作台历史，滤掉避免以残缺卡片混进画廊。
		if !isStudioTaskType(t.TaskType) {
			continue
		}
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

// publicBaseFromRequest 由反代注入的 X-Forwarded-Proto/Host 推断本站对外基地址。
func publicBaseFromRequest(r *http.Request) string {
	host := strings.TrimSpace(r.Header.Get("X-Forwarded-Host"))
	if host == "" {
		return ""
	}
	proto := strings.TrimSpace(r.Header.Get("X-Forwarded-Proto"))
	if proto == "" {
		proto = "https"
	}
	return proto + "://" + host
}

// handleListImageGroups 返回当前用户在指定平台下可选的生成计费分组，
// 已按有效倍率最便宜优先排序（与不指定分组时的自动选组顺序一致）。
// ?media=video 时不要求图片能力（视频平台分组）。
func (p *StudioPlugin) handleListImageGroups(w http.ResponseWriter, r *http.Request) {
	platform := r.URL.Query().Get("platform")
	if strings.TrimSpace(platform) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "platform is required"})
		return
	}
	userID := parseUserIDInt64(r)
	model := r.URL.Query().Get("model")
	needsImage := r.URL.Query().Get("media") != "video"
	groups, err := hostListEligibleGroups(r.Context(), p.host, userID, platform, model, needsImage)
	if err != nil {
		p.logger.Error("list_image_groups_failed", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "查询可用分组失败"})
		return
	}
	if groups == nil {
		groups = []imageGroup{}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"groups": groups})
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}
