package studio

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
)

// ── Project handlers ──

func (p *StudioPlugin) handleListProjects(w http.ResponseWriter, r *http.Request) {
	userID := parseUserID(r)
	// 首次访问自动确保有一个默认项目，避免前端拿到空列表无处落图。
	if _, err := p.svc.EnsureDefaultProject(r.Context(), userID); err != nil {
		p.logger.Error("ensure_default_project_failed", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "初始化默认项目失败: " + err.Error()})
		return
	}
	projects, err := p.svc.ListProjects(r.Context(), userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "查询项目列表失败: " + err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"projects": projects})
}

func (p *StudioPlugin) handleCreateProject(w http.ResponseWriter, r *http.Request) {
	userID := parseUserID(r)
	var req struct {
		Name string `json:"name"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	project, err := p.svc.CreateProject(r.Context(), userID, req.Name)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, project)
}

func (p *StudioPlugin) handleUpdateProject(w http.ResponseWriter, r *http.Request) {
	userID := parseUserID(r)
	projectID, ok := parseProjectID(r)
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid project id"})
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if err := p.svc.RenameProject(r.Context(), userID, projectID, req.Name); err != nil {
		if err == sql.ErrNoRows {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "项目不存在"})
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (p *StudioPlugin) handleDeleteProject(w http.ResponseWriter, r *http.Request) {
	userID := parseUserID(r)
	projectID, ok := parseProjectID(r)
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid project id"})
		return
	}
	if err := p.svc.DeleteProject(r.Context(), userID, projectID); err != nil {
		if err == sql.ErrNoRows {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "项目不存在"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// ── Asset handlers ──

func (p *StudioPlugin) handleListProjectAssets(w http.ResponseWriter, r *http.Request) {
	userID := parseUserID(r)
	projectID, ok := parseProjectID(r)
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid project id"})
		return
	}
	limit := 20
	if v, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && v > 0 && v <= 100 {
		limit = v
	}
	offset := 0
	if v, err := strconv.Atoi(r.URL.Query().Get("offset")); err == nil && v >= 0 {
		offset = v
	}
	assets, total, err := p.svc.ListAssets(r.Context(), userID, projectID, limit, offset)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "查询资产失败: " + err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"assets": assets, "total": total})
}

func (p *StudioPlugin) handleAddProjectAsset(w http.ResponseWriter, r *http.Request) {
	userID := parseUserID(r)
	projectID, ok := parseProjectID(r)
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid project id"})
		return
	}
	var req struct {
		TaskID         int64  `json:"task_id"`
		URL            string `json:"url"`
		Prompt         string `json:"prompt"`
		Model          string `json:"model"`
		Mode           string `json:"mode"`
		Size           string `json:"size"`
		SourceVideoURL string `json:"source_video_url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if strings.TrimSpace(req.URL) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "url is required"})
		return
	}
	asset, err := p.svc.AddAsset(r.Context(), userID, projectID, AssetRecord{
		TaskID:         req.TaskID,
		URL:            req.URL,
		Prompt:         req.Prompt,
		Model:          req.Model,
		Mode:           req.Mode,
		Size:           req.Size,
		SourceVideoURL: req.SourceVideoURL,
	})
	if err != nil {
		if err == sql.ErrNoRows {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "项目不存在"})
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, asset)
}

func (p *StudioPlugin) handleDeleteProjectAsset(w http.ResponseWriter, r *http.Request) {
	userID := parseUserID(r)
	assetID, ok := parseAssetID(r)
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid asset id"})
		return
	}
	if err := p.svc.DeleteAsset(r.Context(), userID, assetID); err != nil {
		if err == sql.ErrNoRows {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "资产不存在"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// parseProjectID 从形如 /projects/{id} 或 /projects/{id}/assets 的路径里解析项目 ID。
func parseProjectID(r *http.Request) (int64, bool) {
	rest := strings.TrimPrefix(r.URL.Path, "/projects/")
	if rest == "" {
		return 0, false
	}
	idStr := rest
	if i := strings.IndexByte(rest, '/'); i >= 0 {
		idStr = rest[:i]
	}
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil || id <= 0 {
		return 0, false
	}
	return id, true
}

// parseAssetID 从形如 /projects/{id}/assets/{assetID} 的路径里解析资产 ID。
func parseAssetID(r *http.Request) (int64, bool) {
	const marker = "/assets/"
	i := strings.LastIndex(r.URL.Path, marker)
	if i < 0 {
		return 0, false
	}
	idStr := r.URL.Path[i+len(marker):]
	if j := strings.IndexByte(idStr, '/'); j >= 0 {
		idStr = idStr[:j]
	}
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil || id <= 0 {
		return 0, false
	}
	return id, true
}
