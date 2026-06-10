package studio

import (
	"context"
	"database/sql"
	"log/slog"
	"strconv"
	"strings"

	sdk "github.com/DouDOU-start/airgate-sdk/sdkgo"
)

type StudioPlugin struct {
	logger *slog.Logger
	host   sdk.Host
	db     *sql.DB
	svc    *Service

	// skills 默认模型配置（来自 ConfigSchema，可为空 → 运行时回退 models.list）
	skillPlatform    string
	skillTextModel   string
	skillVisionModel string
	skillGroupID     int64 // skill LLM 调用绑定的分组（用折扣分组省钱）；0 = 不绑分组按标准价
}

func (p *StudioPlugin) Info() sdk.PluginInfo { return buildPluginInfo() }

func (p *StudioPlugin) Init(ctx sdk.PluginContext) error {
	if ctx != nil {
		p.logger = ctx.Logger()
	}
	if p.logger == nil {
		p.logger = slog.Default()
	}
	if hostAware, ok := ctx.(sdk.HostAware); ok {
		p.host = hostAware.Host()
	}

	// 连接插件专属数据库（Core 自动 provision 的独立 schema）。优先 plugin_dsn，回退 db_dsn。
	// DSN 缺失时以「未配置态」加载：项目/资产功能禁用，但插件不崩溃。
	if cfg := ctx.Config(); cfg != nil {
		p.skillPlatform = strings.TrimSpace(cfg.GetString("skill_platform"))
		p.skillTextModel = strings.TrimSpace(cfg.GetString("skill_text_model"))
		p.skillVisionModel = strings.TrimSpace(cfg.GetString("skill_vision_model"))
		if p.skillPlatform == "" {
			p.skillPlatform = "openai"
		}
		if raw := strings.TrimSpace(cfg.GetString("skill_group_id")); raw != "" {
			if gid, err := strconv.ParseInt(raw, 10, 64); err == nil && gid > 0 {
				p.skillGroupID = gid
			}
		}
		for _, key := range []string{sdk.PluginDSNConfigKey, "db_dsn"} {
			dsn := strings.TrimSpace(cfg.GetString(key))
			if dsn == "" {
				continue
			}
			db, err := sql.Open("postgres", dsn)
			if err != nil {
				p.logger.Warn("studio 打开数据库失败，尝试下一个 DSN", "dsn_source", key, "error", err)
				continue
			}
			if err := db.Ping(); err != nil {
				_ = db.Close()
				p.logger.Warn("studio Ping 数据库失败，尝试下一个 DSN", "dsn_source", key, "error", err)
				continue
			}
			p.db = db
			p.logger.Info("studio 数据库已连接", "dsn_source", key)
			break
		}
	}
	if p.db == nil {
		p.logger.Warn("plugin_dsn/db_dsn 未配置，studio 项目功能将禁用（未配置态）")
	} else {
		p.svc = NewService(p.logger, p.db, p.host)
	}

	p.logger.Info("Studio 插件初始化")
	return nil
}

func (p *StudioPlugin) Start(_ context.Context) error {
	p.logger.Info("Studio 插件启动")
	return nil
}

func (p *StudioPlugin) Stop(_ context.Context) error {
	if p.db != nil {
		_ = p.db.Close()
	}
	p.logger.Info("Studio 插件停止")
	return nil
}

func (p *StudioPlugin) RegisterRoutes(r sdk.RouteRegistrar) {
	registerRoutes(p, r)
}

func (p *StudioPlugin) Migrate() error {
	if p.db == nil {
		return nil
	}
	return migrate(p.db)
}

func (p *StudioPlugin) BackgroundTasks() []sdk.BackgroundTask { return nil }

// Configured 表示项目/资产持久化是否可用（DB 已连接）。
func (p *StudioPlugin) Configured() bool { return p.svc != nil }
