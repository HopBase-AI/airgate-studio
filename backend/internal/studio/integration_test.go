package studio

import (
	"context"
	"database/sql"
	"errors"
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
	// 模拟从没有唯一索引的旧版本升级：重复任务资产应被清成一条，
	// 然后创建幂等索引。
	if _, err := db.Exec(`
		DROP INDEX idx_studio_assets_project_task_url;
		INSERT INTO studio_projects (id, user_id, name) VALUES (900001, 700, 'upgrade fixture');
		INSERT INTO studio_assets (user_id, project_id, task_id, url) VALUES
			(700, 900001, 800001, '/upgrade.png'),
			(700, 900001, 800001, '/upgrade.png');
	`); err != nil {
		t.Fatalf("prepare upgrade fixture: %v", err)
	}
	if err := migrate(db); err != nil {
		t.Fatalf("migrate legacy duplicates: %v", err)
	}
	var upgradeRows int
	if err := db.QueryRow(`SELECT COUNT(*) FROM studio_assets WHERE project_id = 900001`).Scan(&upgradeRows); err != nil {
		t.Fatalf("count upgraded assets: %v", err)
	}
	if upgradeRows != 1 {
		t.Fatalf("legacy duplicate rows = %d, want 1", upgradeRows)
	}
	// 幂等性：索引已经存在时重复 migrate 不应报错，也不再执行清理扫描。
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
	var firstAssetID int64
	for i := 0; i < 3; i++ {
		added, err := svc.AddAsset(ctx, uid, proj.ID, AssetRecord{
			TaskID: int64(100 + i), URL: "/assets-runtime/img" + string(rune('a'+i)) + ".png", Prompt: "p",
			Platform: "openai", Model: "gpt-image-2", GroupID: 42, RouteKey: "openai:gpt-image-2",
			Mode: "text2img", Size: "auto",
		})
		if err != nil {
			t.Fatalf("AddAsset[%d]: %v", i, err)
		}
		if i == 0 {
			firstAssetID = added.ID
		}
	}
	if _, err := db.Exec(`UPDATE studio_projects SET updated_at = TIMESTAMPTZ '2000-01-01 00:00:00+00' WHERE id = $1`, proj.ID); err != nil {
		t.Fatalf("pin project updated_at: %v", err)
	}
	duplicate, err := svc.AddAsset(ctx, uid, proj.ID, AssetRecord{
		TaskID: 100, URL: "/assets-runtime/imga.png", Prompt: "updated", Model: "gpt-image-2", Mode: "text2img", Size: "auto",
	})
	if err != nil {
		t.Fatalf("AddAsset duplicate: %v", err)
	}
	if duplicate.ID != firstAssetID {
		t.Errorf("duplicate task asset id = %d, want existing id %d", duplicate.ID, firstAssetID)
	}
	if duplicate.Prompt != "p" {
		t.Errorf("duplicate task asset rewrote metadata: prompt = %q, want p", duplicate.Prompt)
	}
	var projectOrderUnchanged bool
	if err := db.QueryRow(
		`SELECT updated_at = TIMESTAMPTZ '2000-01-01 00:00:00+00' FROM studio_projects WHERE id = $1`,
		proj.ID,
	).Scan(&projectOrderUnchanged); err != nil {
		t.Fatalf("read project updated_at: %v", err)
	}
	if !projectOrderUnchanged {
		t.Error("idempotent AddAsset unexpectedly touched project updated_at")
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
	for _, asset := range assets {
		if asset.Platform != "openai" || asset.Model != "gpt-image-2" || asset.GroupID != 42 || asset.RouteKey != "openai:gpt-image-2" || asset.Size != "auto" {
			t.Fatalf("asset route snapshot did not round-trip: %+v", asset)
		}
	}

	// 项目内删除使用持久墓碑：列表立即隐藏，恢复轮询也不能把同一任务重新插回。
	if err := svc.DeleteAsset(ctx, uid, firstAssetID); err != nil {
		t.Fatalf("DeleteAsset: %v", err)
	}
	if _, err := svc.AddAsset(ctx, uid, proj.ID, AssetRecord{
		TaskID: 100, URL: "/assets-runtime/imga.png", Prompt: "recovered",
	}); !errors.Is(err, ErrAssetDeleted) {
		t.Fatalf("re-add tombstoned asset err = %v, want ErrAssetDeleted", err)
	}
	_, total, err = svc.ListAssets(ctx, uid, proj.ID, 10, 0)
	if err != nil {
		t.Fatalf("ListAssets after soft delete: %v", err)
	}
	if total != 2 {
		t.Errorf("soft delete visible total = %d, want 2", total)
	}

	// 删除生成任务时同步清掉该用户的项目资产引用。
	otherProject, err := svc.EnsureDefaultProject(ctx, 999)
	if err != nil {
		t.Fatalf("EnsureDefaultProject(other): %v", err)
	}
	if _, err := svc.AddAsset(ctx, 999, otherProject.ID, AssetRecord{TaskID: 101, URL: "/other-user.png"}); err != nil {
		t.Fatalf("AddAsset(other): %v", err)
	}
	if err := svc.DeleteAssetsByTask(ctx, uid, 101); err != nil {
		t.Fatalf("DeleteAssetsByTask: %v", err)
	}
	_, total, err = svc.ListAssets(ctx, uid, proj.ID, 10, 0)
	if err != nil {
		t.Fatalf("ListAssets after task cleanup: %v", err)
	}
	if total != 1 {
		t.Errorf("任务资产清理后 total = %d, want 1", total)
	}
	_, otherTotal, err := svc.ListAssets(ctx, 999, otherProject.ID, 10, 0)
	if err != nil {
		t.Fatalf("ListAssets(other): %v", err)
	}
	if otherTotal != 1 {
		t.Errorf("任务资产清理影响其他用户: total = %d, want 1", otherTotal)
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
