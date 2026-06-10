package studio

import (
	"database/sql"
	"time"

	_ "github.com/lib/pq"
)

// Project 是创作工作坊的「项目」维度：用户在一个项目里持续生成资源。
type Project struct {
	ID        int64     `json:"id"`
	UserID    int       `json:"user_id"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// AssetRecord 是项目内一张生成图的引用记录。
//
// 注意：生图任务完成时 Core 的 gateway-openai executor 已把图存成持久资产
// （purpose=generated），task 返回的就是持久 public URL。这里只存该 URL 的引用，
// 不重复 store —— 重复 store 只会产生副本、保留期还一样。
type AssetRecord struct {
	ID        int64     `json:"id"`
	UserID    int       `json:"user_id"`
	ProjectID int64     `json:"project_id"`
	TaskID    int64     `json:"task_id"`
	URL       string    `json:"url"`
	Prompt    string    `json:"prompt"`
	Model     string    `json:"model"`
	Mode      string    `json:"mode"`
	Size      string    `json:"size"`
	CreatedAt time.Time `json:"created_at"`
}

func migrate(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS studio_projects (
			id         BIGSERIAL PRIMARY KEY,
			user_id    INTEGER NOT NULL,
			name       TEXT NOT NULL DEFAULT '未命名项目',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

		CREATE INDEX IF NOT EXISTS idx_studio_projects_user ON studio_projects(user_id, updated_at DESC);

		CREATE TABLE IF NOT EXISTS studio_assets (
			id         BIGSERIAL PRIMARY KEY,
			user_id    INTEGER NOT NULL,
			project_id BIGINT NOT NULL REFERENCES studio_projects(id) ON DELETE CASCADE,
			task_id    BIGINT NOT NULL DEFAULT 0,
			url        TEXT NOT NULL,
			prompt     TEXT NOT NULL DEFAULT '',
			model      TEXT NOT NULL DEFAULT '',
			mode       TEXT NOT NULL DEFAULT '',
			size       TEXT NOT NULL DEFAULT '',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

		CREATE INDEX IF NOT EXISTS idx_studio_assets_project ON studio_assets(project_id, created_at DESC);
	`)
	return err
}
