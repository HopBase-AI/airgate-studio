package studio

import (
	"context"
	"database/sql"
	"fmt"
	"hash/fnv"
	"log/slog"
	"strings"

	sdk "github.com/DouDOU-start/airgate-sdk/sdkgo"
)

const defaultProjectName = "未命名项目"

// Service 承载项目与资产的持久化逻辑。db 为 nil 时（未配置 plugin_dsn）所有方法返回错误，
// 由 handler 层转成 503，保证插件「未配置态」不崩溃。
type Service struct {
	logger *slog.Logger
	db     *sql.DB
	host   sdk.Host
}

func NewService(logger *slog.Logger, db *sql.DB, host sdk.Host) *Service {
	return &Service{logger: logger, db: db, host: host}
}

// ── Project CRUD ──

func (s *Service) CreateProject(ctx context.Context, userID int, name string) (*Project, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		name = defaultProjectName
	}
	p := &Project{UserID: userID, Name: name}
	if err := s.db.QueryRowContext(ctx,
		`INSERT INTO studio_projects (user_id, name)
		 VALUES ($1, $2)
		 RETURNING id, created_at, updated_at`,
		userID, name,
	).Scan(&p.ID, &p.CreatedAt, &p.UpdatedAt); err != nil {
		return nil, fmt.Errorf("写入项目失败: %w", err)
	}
	return p, nil
}

func (s *Service) ListProjects(ctx context.Context, userID int) ([]Project, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, user_id, name, created_at, updated_at
		 FROM studio_projects
		 WHERE user_id = $1
		 ORDER BY updated_at DESC, id DESC`, userID,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	projects := make([]Project, 0)
	for rows.Next() {
		var p Project
		if err := rows.Scan(&p.ID, &p.UserID, &p.Name, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		projects = append(projects, p)
	}
	return projects, rows.Err()
}

func (s *Service) RenameProject(ctx context.Context, userID int, projectID int64, name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Errorf("项目名不能为空")
	}
	res, err := s.db.ExecContext(ctx,
		`UPDATE studio_projects SET name = $1, updated_at = NOW()
		 WHERE id = $2 AND user_id = $3`,
		name, projectID, userID,
	)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *Service) DeleteProject(ctx context.Context, userID int, projectID int64) error {
	// studio_assets 通过 ON DELETE CASCADE 自动清掉引用记录；不删底层资产对象
	// （由 Core 的资产保留策略统一管理），避免误删被多处引用的图。
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM studio_projects WHERE id = $1 AND user_id = $2`,
		projectID, userID,
	)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// EnsureDefaultProject 返回用户的默认项目；不存在则创建。用 advisory lock 防并发重复创建
// （老用户首次进入工作坊时会触发）。
func (s *Service) EnsureDefaultProject(ctx context.Context, userID int) (*Project, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("开启事务失败: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock($1)`, defaultProjectLockKey(userID)); err != nil {
		return nil, fmt.Errorf("锁定默认项目失败: %w", err)
	}

	p := &Project{UserID: userID}
	err = tx.QueryRowContext(ctx,
		`SELECT id, user_id, name, created_at, updated_at
		 FROM studio_projects
		 WHERE user_id = $1
		 ORDER BY created_at ASC, id ASC
		 LIMIT 1`, userID,
	).Scan(&p.ID, &p.UserID, &p.Name, &p.CreatedAt, &p.UpdatedAt)
	if err == nil {
		return p, tx.Commit()
	}
	if err != sql.ErrNoRows {
		return nil, err
	}

	p.Name = defaultProjectName
	if err := tx.QueryRowContext(ctx,
		`INSERT INTO studio_projects (user_id, name)
		 VALUES ($1, $2)
		 RETURNING id, created_at, updated_at`,
		userID, defaultProjectName,
	).Scan(&p.ID, &p.CreatedAt, &p.UpdatedAt); err != nil {
		return nil, fmt.Errorf("创建默认项目失败: %w", err)
	}
	return p, tx.Commit()
}

func (s *Service) projectExists(ctx context.Context, userID int, projectID int64) (bool, error) {
	var exists bool
	err := s.db.QueryRowContext(ctx,
		`SELECT EXISTS(SELECT 1 FROM studio_projects WHERE id = $1 AND user_id = $2)`,
		projectID, userID,
	).Scan(&exists)
	return exists, err
}

// ── Asset CRUD ──

// AddAsset 把一张已生成图的持久 URL + 元数据写入项目。仅记引用，不调用任何 host assets 方法。
func (s *Service) AddAsset(ctx context.Context, userID int, projectID int64, rec AssetRecord) (*AssetRecord, error) {
	if strings.TrimSpace(rec.URL) == "" {
		return nil, fmt.Errorf("url 不能为空")
	}
	ok, err := s.projectExists(ctx, userID, projectID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, sql.ErrNoRows
	}

	out := rec
	out.UserID = userID
	out.ProjectID = projectID
	if err := s.db.QueryRowContext(ctx,
		`INSERT INTO studio_assets (user_id, project_id, task_id, url, prompt, model, mode, size, source_video_url)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		 RETURNING id, created_at`,
		userID, projectID, rec.TaskID, rec.URL, rec.Prompt, rec.Model, rec.Mode, rec.Size, rec.SourceVideoURL,
	).Scan(&out.ID, &out.CreatedAt); err != nil {
		return nil, fmt.Errorf("写入资产失败: %w", err)
	}
	// 触碰项目 updated_at，让最近活跃的项目排在前面
	_, _ = s.db.ExecContext(ctx, `UPDATE studio_projects SET updated_at = NOW() WHERE id = $1`, projectID)
	return &out, nil
}

// ListAssets 分页读取项目内资产，按创建时间倒序。返回是否还有更多。
func (s *Service) ListAssets(ctx context.Context, userID int, projectID int64, limit, offset int) ([]AssetRecord, int, error) {
	var total int
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM studio_assets WHERE project_id = $1 AND user_id = $2`,
		projectID, userID,
	).Scan(&total); err != nil {
		return nil, 0, err
	}

	rows, err := s.db.QueryContext(ctx,
		`SELECT id, user_id, project_id, task_id, url, prompt, model, mode, size, source_video_url, created_at
		 FROM studio_assets
		 WHERE project_id = $1 AND user_id = $2
		 ORDER BY created_at DESC, id DESC
		 LIMIT $3 OFFSET $4`,
		projectID, userID, limit, offset,
	)
	if err != nil {
		return nil, 0, err
	}
	defer func() { _ = rows.Close() }()

	assets := make([]AssetRecord, 0, limit)
	for rows.Next() {
		var a AssetRecord
		if err := rows.Scan(&a.ID, &a.UserID, &a.ProjectID, &a.TaskID, &a.URL, &a.Prompt, &a.Model, &a.Mode, &a.Size, &a.SourceVideoURL, &a.CreatedAt); err != nil {
			return nil, 0, err
		}
		assets = append(assets, a)
	}
	return assets, total, rows.Err()
}

func (s *Service) DeleteAsset(ctx context.Context, userID int, assetID int64) error {
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM studio_assets WHERE id = $1 AND user_id = $2`,
		assetID, userID,
	)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// defaultProjectLockKey 把 userID 映射成 advisory lock 的 key，命名空间用 fnv 哈希避免与其他锁冲突。
func defaultProjectLockKey(userID int) int64 {
	h := fnv.New64a()
	_, _ = h.Write([]byte(fmt.Sprintf("studio-default-project:%d", userID)))
	return int64(h.Sum64())
}
