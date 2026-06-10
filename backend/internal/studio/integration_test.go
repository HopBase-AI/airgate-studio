package studio

import (
	"context"
	"database/sql"
	"os"
	"testing"

	_ "github.com/lib/pq"
)

// TestServiceIntegration 跑真实 Postgres，验证 migrate + 项目/资产 CRUD。
// 默认跳过；设置 STUDIO_TEST_DSN 后运行，例如：
//
//	STUDIO_TEST_DSN="postgres://postgres:test@localhost:55432/studiotest?sslmode=disable" go test -run Integration ./...
func TestServiceIntegration(t *testing.T) {
	dsn := os.Getenv("STUDIO_TEST_DSN")
	if dsn == "" {
		t.Skip("STUDIO_TEST_DSN 未设置，跳过集成测试")
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer func() { _ = db.Close() }()
	if err := db.Ping(); err != nil {
		t.Fatalf("ping db: %v", err)
	}

	// 干净起步
	_, _ = db.Exec(`DROP TABLE IF EXISTS studio_assets; DROP TABLE IF EXISTS studio_projects;`)
	if err := migrate(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	// 幂等性：重复 migrate 不应报错
	if err := migrate(db); err != nil {
		t.Fatalf("migrate (2nd): %v", err)
	}

	ctx := context.Background()
	svc := NewService(nil, db, nil)
	const uid = 7

	// EnsureDefaultProject：首次创建
	def, err := svc.EnsureDefaultProject(ctx, uid)
	if err != nil {
		t.Fatalf("EnsureDefaultProject: %v", err)
	}
	if def.Name != defaultProjectName {
		t.Errorf("默认项目名 = %q, want %q", def.Name, defaultProjectName)
	}
	// 再次调用应复用同一项目，不重复创建
	def2, err := svc.EnsureDefaultProject(ctx, uid)
	if err != nil {
		t.Fatalf("EnsureDefaultProject(2): %v", err)
	}
	if def2.ID != def.ID {
		t.Errorf("EnsureDefaultProject 重复创建：id %d != %d", def2.ID, def.ID)
	}

	// CreateProject + ListProjects
	proj, err := svc.CreateProject(ctx, uid, "电商海报")
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	projects, err := svc.ListProjects(ctx, uid)
	if err != nil {
		t.Fatalf("ListProjects: %v", err)
	}
	if len(projects) != 2 {
		t.Errorf("项目数 = %d, want 2", len(projects))
	}

	// RenameProject
	if err := svc.RenameProject(ctx, uid, proj.ID, "电商主图"); err != nil {
		t.Fatalf("RenameProject: %v", err)
	}
	// 跨用户改名应失败
	if err := svc.RenameProject(ctx, 999, proj.ID, "hack"); err != sql.ErrNoRows {
		t.Errorf("跨用户改名 err = %v, want ErrNoRows", err)
	}

	// AddAsset + ListAssets
	for i := 0; i < 3; i++ {
		if _, err := svc.AddAsset(ctx, uid, proj.ID, AssetRecord{
			URL: "/assets-runtime/img" + string(rune('a'+i)) + ".png", Prompt: "p", Model: "gpt-image-2", Mode: "text2img", Size: "auto",
		}); err != nil {
			t.Fatalf("AddAsset[%d]: %v", i, err)
		}
	}
	assets, total, err := svc.ListAssets(ctx, uid, proj.ID, 2, 0)
	if err != nil {
		t.Fatalf("ListAssets: %v", err)
	}
	if total != 3 {
		t.Errorf("资产 total = %d, want 3", total)
	}
	if len(assets) != 2 {
		t.Errorf("分页 limit=2 返回 %d 条, want 2", len(assets))
	}

	// AddAsset 到不存在的项目应 ErrNoRows
	if _, err := svc.AddAsset(ctx, uid, 999999, AssetRecord{URL: "/x.png"}); err != sql.ErrNoRows {
		t.Errorf("加资产到不存在项目 err = %v, want ErrNoRows", err)
	}

	// DeleteProject 级联删资产
	if err := svc.DeleteProject(ctx, uid, proj.ID); err != nil {
		t.Fatalf("DeleteProject: %v", err)
	}
	var assetCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM studio_assets WHERE project_id = $1`, proj.ID).Scan(&assetCount); err != nil {
		t.Fatalf("count assets: %v", err)
	}
	if assetCount != 0 {
		t.Errorf("删项目后残留 %d 条资产（级联失败）", assetCount)
	}
}
