import { defineConfig } from 'vitest/config';

// 独立于 vite.config.ts：构建配置里的 define(process.env.NODE_ENV='production')
// 会把 React 切到生产构建，act() 与开发期告警都将失效，不能用于测试。
// sharedModulesPlugin 只在 generateBundle 阶段生效，测试链路无需它。
export default defineConfig({
  test: {
    environment: 'happy-dom',
    // 真实浏览器的 DOMParser 不执行脚本；happy-dom 默认会执行，关掉以对齐生产行为。
    environmentOptions: {
      happyDOM: {
        settings: { disableJavaScriptEvaluation: true },
      },
    },
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
