# desk-pet 🐾 —— Claude Code 的桌面宠物

> fork 自 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)（原版是 DeepSeek Harness 的桌宠，素材与绝大部分代码来自原作者）。按原项目的二创约定，任何介绍、展示、分发本作品的地方都请保留原作者地址：<https://github.com/PC2005-cloud/dsh-pet>。

一只住在桌面透明小窗里的宠物，**跟着 Claude Code 干活**：你提交一条消息它开始思考，Claude 调工具它忙前忙后，等你批准权限时它原地踱步张望，一轮做完雀跃庆祝，出错了垂头叹气；头顶气泡会显示 TodoWrite 清单里正在做的那一步。闲下来它会碎碎念、陪你聊天——都由 Claude Code 自己（`claude -p`）生成，用你现有的登录，不用另配 API key。

<p>
  <img src="assets/preview/gongzuozhuangtai-sikao-maopao.gif" width="160" alt="思考" title="思考">
  <img src="assets/preview/gongzuozhuangtai-manglu-dianan.gif" width="160" alt="工作" title="工作">
  <img src="assets/preview/gongzuozhuangtai-yuandi-duobu-zhangwang.gif" width="160" alt="等待确认" title="等待确认">
  <img src="assets/preview/gongzuozhuangtai-queyue-qingzhu.gif" width="160" alt="完成" title="完成">
  <img src="assets/preview/gongzuozhuangtai-chuitou-tanqi-maohan.gif" width="160" alt="出错" title="出错">
</p>

**English:** a desktop pet for [Claude Code](https://claude.com/claude-code). It is a transparent animated pet that follows Claude Code's work status: thinking, working, waiting for approval, done, or error. Install it with `npm i -g desk-pet`, then run `/plugin marketplace add tg111/claude-code-desk-pet` and `/plugin install desk-pet@desk-pet` in Claude Code, and start a new session. See the [project README](https://github.com/tg111/claude-code-desk-pet#readme) for details.

> 本目录是桌宠本体（`desk-pet` 程序 + 动画素材）。完整说明（hook 对应关系、配置、pet pack、素材生成链）见[仓库根目录 README](https://github.com/tg111/claude-code-desk-pet#readme)。

---

## 🚀 安装

需要 Node.js ≥ 22.12、Claude Code，以及图形桌面（Windows / macOS / Linux）。

**① 安装 `desk-pet` 命令**：

```sh
npm i -g desk-pet
desk-pet --check     # 体检：配置、Electron、图形环境
```

或者在本目录下从源码构建（需要 pnpm）：

```sh
pnpm install
npm run build        # 产出 lib/（构建产物不入库，clone 后必须跑一次）
npm link             # 把 desk-pet 装到 PATH 上
desk-pet --check     # 体检：配置、Electron、图形环境
```

**② 在 Claude Code 里装插件**（hook 转发 + 会话开始时自动拉起桌宠）：

```
/plugin install desk-pet --marketplace tg111/claude-code-desk-pet
```

旧版 Claude Code：`/plugin marketplace add tg111/claude-code-desk-pet`，再 `/plugin install desk-pet@desk-pet`。不想装插件也可以手动把 hooks 写进 `~/.claude/settings.json`，见根 README「快速开始 ③」。

装好后新开一个 Claude Code 会话，宠物就会出现在屏幕右上角；多个会话共用同一只。第一次启动会下载 Electron（约 100MB，落在 `~/.desk-pet/electron`，同一版本只下一次；网络受限时设 `DESK_PET_ELECTRON_MIRROR` 换镜像）。

## 🧍 手动运行

```sh
desk-pet                 # 前台运行（Ctrl+C 退出）；装了插件则由 hook 在后台自动拉起
desk-pet --port 3100     # 指定端口（默认 3080，被占用自动顺延）
desk-pet --check         # 只体检，不开窗口
npm run standalone       # 仓库里直接跑构建产物
```

退出：托盘图标 →「退出桌宠」，或 `POST http://127.0.0.1:<端口>/shutdown`。同一时间只会有一个桌宠进程（`~/.desk-pet/desk-pet.lock`），实际端口登记在 `~/.desk-pet/server.json`。

## ✨ 功能

- **工作状态**：思考 / 工作 / 整理 / 等待 / 成功 / 出错六档动画 + 气泡；多个会话同时跑时按优先级展示（等你确认 > 出错 > 工作 > 思考 > 整理 > 成功），终态几秒后自动回到日常动作
- **碎碎念**：按 `eventsRefreshSec.whisper` 周期（默认 900 秒）自动来一句，右键「碎碎念」随时催一句；每句调用一次 `claude -p`（默认 haiku，会计入你的 Claude 用量）
- **对话**：右键「对话」弹窗聊天，记忆存在 `~/.desk-pet/memory.json`（全存不删，每次只带最近 `chatMemoryRounds` 轮）
- **表情包配图**：碎碎念随机配一张，对话由模型按语境挑一张
- **一百余个手绘风透明动画**：待机、打瞌睡、玩魔方、写代码、吃火锅、四季节日……按权重无缝衔接；双缓冲交叉淡入，切换零空白帧
- **物理手感**：屏幕漫游、点击 Q 弹、过阻尼弹簧拖拽、甩出抛物线飞行 + 边缘反弹 + 落地 Q 弹；重力、弹性、摩擦等都可配
- **右键菜单**：打开 Claude Code、碎碎念、对话、回到初始位置、隐藏（托盘可恢复）、重载配置，以及「动作 → 分类 → 具体动画」任意点播
- **托盘**：开关每只宠物的显示、退出桌宠
- **多开与 pet pack**：多只宠物同屏，各自大小位置；还能添加独立动画池与素材的全新种类
- **对外 HTTP 接口**：别的脚本（或 Claude 自己）可以让它说话、播动画、挪位置，见 [`API.md`](https://github.com/tg111/claude-code-desk-pet/blob/main/API.md)

## 🔧 环境变量

| 变量                                          | 作用                                                                                           |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `DESK_PET_HOME`                               | 数据目录（默认 `~/.desk-pet`）                                                                 |
| `DESK_PET_MODEL`                              | 碎碎念 / 对话的模型别名（默认 `haiku`，可填 `sonnet` / `opus`）                                |
| `DESK_PET_CLAUDE_BIN`                         | `claude` 可执行文件路径（默认走 PATH）                                                         |
| `DESK_PET_CMD`                                | hook 自动拉起桌宠时用的整条命令（默认找同仓库 `lib/standalone.js`，再找 PATH 上的 `desk-pet`） |
| `DESK_PET_AUTOSTART=0` / `DESK_PET_DISABLE=1` | 只转发不自动启动 / 完全停用                                                                    |
| `DESK_PET_OPEN_URL`                           | 右键「打开 Claude Code」打开的地址（默认 `https://claude.ai/code`）                            |
| `DESK_PET_DEBUG=1`                            | 前台运行时每条 hook 打一行日志，排查「宠物没反应」                                             |
| `DESK_PET_DESKTOP_FORCE=1`                    | Linux 检测不到图形环境时（远程桌面 / Xvfb）强制开桌面窗口                                      |

## ⚙️ 配置

| 层                   | 路径                               | 作用                                                                |
| -------------------- | ---------------------------------- | ------------------------------------------------------------------- |
| 默认配置（只读）     | 本目录 `assets/config.jsonc`       | 完整结构参考，注释齐全                                              |
| 用户配置             | `~/.desk-pet/main-config.jsonc`    | 同一套格式，只写想改的顶层字段（整段替换），没写的回落默认          |
| 对话记忆（自动生成） | `~/.desk-pet/memory.json`          | 删掉即清空记忆                                                      |
| 自定义动画（可选）   | `~/.desk-pet/main-animation/webm/` | 放 VP9-Alpha `.webm`，在动画池里写文件名即可用，优先于包内素材      |
| 自定义表情包（可选） | `~/.desk-pet/memes/`               | 放 `.png`，键与描述写进配置的 `memes`                               |
| 额外宠物种类（可选） | `~/.desk-pet/pet/`                 | `<种类>-config.json` + `<种类>-animation/`，见根 README「额外宠物」 |

改完右键宠物「重载配置」即生效。常改的字段：`pets`（大小 / 位置 / 多开 / 开关）、`whisperPrompt`（人设）、`workStatusTexts`（六档气泡文案）、`eventsRefreshSec.whisper`（碎碎念间隔）、`physics`（拖拽手感）、`whisperModel` / `chatModel`（如 `{ "provider": "claude-code", "model": "sonnet" }`）。

## 🗑️ 卸载

1. 在 Claude Code 的 `/plugin` 里卸载 desk-pet（或删掉手动写进 `settings.json` 的 hooks）
2. 托盘「退出桌宠」，然后 `npm rm -g desk-pet` 去掉 `desk-pet` 命令
3. 删数据（可选）：`~/.desk-pet/`（配置、记忆、Electron 运行时、日志）；Electron 窗口缓存在 `%APPDATA%\desk-pet-electron-helper\`（macOS `~/Library/Application Support/`，Linux `~/.config/`）

## 📄 许可

- 代码：MIT
- 素材（动画 / 提示词 / 源视频）：来自原项目，允许开源使用，**禁止商用**
- 二创须附原作者地址：<https://github.com/PC2005-cloud/dsh-pet>
