# 桌面窗口运行时测试（macOS）

在 `desk-pet/` 包目录运行（先 `npm run build`）：

```sh
pnpm install --frozen-lockfile
DESK_PET_ELECTRON=/path/to/Electron.app/Contents/MacOS/Electron npm run test:ui
```

`desktop-macos.test.mjs` 用 Playwright 驱动真实的 Electron 桌面小窗：起一个隔离的临时宿主服务（只读包内默认配置与素材），校验原生几何、HiDPI 下的右键菜单与点击穿透恢复。不读取或修改用户的配置与对话记忆。

只在 macOS 且设置了 `DESK_PET_ELECTRON` 时运行，其余平台自动跳过；与 `npm test` 的 Node 单元测试分开运行。
