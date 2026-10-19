// tsdown 配置：src → lib 产物（只有一个入口）
//
// desk-pet 进程（src/standalone/cli.ts → lib/standalone.js）：宿主半边（src/host）跑在伪 ctx 上，
// 起本机 HTTP 服务接收 Claude Code hook、拉起 Electron 桌面小窗。只在 Node ≥ 22.12 上运行
// （package.json 的 engines 已声明），因此目标是 es2022：更低的目标会把 class field 一类语法
// 降级成 `_defineProperty(...)`，把 `@oxc-project/runtime` 拖成一条裸 import —— 那个包不在本包
// 依赖里，装好的用户跑起来会 ERR_MODULE_NOT_FOUND（scripts/prepack-check.js 第 5 项守着这条）。
//
// 桌面渲染端用的共享纯逻辑（src/shared → runtime/electron-helper/shared-core.js）不归这里，
// 见 scripts/build-desktop-core.mjs。
import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { standalone: 'src/standalone/cli.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'es2022',
  dts: false,
  outDir: 'lib',
  clean: true,
  external: [/^@electron\//, /^node:/],
});
