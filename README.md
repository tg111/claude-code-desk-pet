# desk-pet：Claude Code 的桌面宠物 🐾

> 本仓库 fork 自 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)（原版是 DeepSeek Harness 的桌宠，素材与绝大部分代码来自原作者），在它的基础上改成了 **Claude Code** 的桌宠。按原项目的二创约定，任何介绍、展示、分发本作品的地方都请保留原作者地址：<https://github.com/PC2005-cloud/dsh-pet>。

一只住在你桌面上的透明小窗宠物，**跟着 Claude Code 干活**：你一回车它就开始思考，Claude 调工具它就忙前忙后，要你批准权限时它原地踱步张望，一轮做完它雀跃庆祝，出错了它垂头叹气——头顶气泡还会显示 Claude 的 TodoWrite 清单里正在做的那一步。

平时它待机呼吸、随机做动作（打瞌睡、玩魔方、吃火锅……一百余个手绘风透明动画无缝衔接）、在屏幕上溜达、被点会 Q 弹、能拖拽甩抛反弹；闲下来会碎碎念，右键还能和它聊天——碎碎念和对话直接用 **Claude Code 本身**（`claude -p`）生成，用的是你在 Claude Code 里的登录，不需要另配 API key。

<p align="center">
  <img src="dsh-pet/assets/preview/gongzuozhuangtai-sikao-maopao.gif" width="160" alt="思考" title="思考（UserPromptSubmit）">
  <img src="dsh-pet/assets/preview/gongzuozhuangtai-manglu-dianan.gif" width="160" alt="工作" title="工作（PreToolUse）">
  <img src="dsh-pet/assets/preview/gongzuozhuangtai-yuandi-duobu-zhangwang.gif" width="160" alt="等待确认" title="等待确认（权限申请）">
  <img src="dsh-pet/assets/preview/gongzuozhuangtai-queyue-qingzhu.gif" width="160" alt="完成" title="完成（Stop）">
  <img src="dsh-pet/assets/preview/gongzuozhuangtai-chuitou-tanqi-maohan.gif" width="160" alt="出错" title="出错（StopFailure）">
</p>

---

## 快速开始

需要：Node.js ≥ 22.12、[pnpm](https://pnpm.io)、Claude Code，以及一个图形桌面（Windows / macOS / Linux）。

### ① 构建并安装桌宠程序（`desk-pet` 命令）

```sh
git clone https://github.com/tg111/dsh-pet.git
cd dsh-pet/dsh-pet
pnpm install
npm run build        # 产出 lib/（构建产物不入库，clone 后必须跑一次）
npm link             # 把 desk-pet 命令装到 PATH 上（Windows 下同样可用）
desk-pet --check     # 体检：配置、Electron、图形环境
```

> 第一次启动会自动下载 Electron（约 100MB，落在 `~/.desk-pet/electron`，同一版本只下一次；默认走 npmmirror 镜像，网络受限时可设 `DSH_PET_ELECTRON_MIRROR` 换镜像）。

### ② 在 Claude Code 里装插件（hook 转发 + 自动启动）

在 Claude Code 里执行：

```
/plugin install desk-pet --marketplace tg111/dsh-pet
```

（旧版 Claude Code 分两步：`/plugin marketplace add tg111/dsh-pet`，再 `/plugin install desk-pet@desk-pet`。）

装好后**新开一个 Claude Code 会话**：会话开始时插件会在后台把桌宠拉起来（右上角出现宠物），之后每个 hook 事件都会转发给它。多个会话共用同一只桌宠。

### ③ 不想装插件？手动配 hooks 也行

把下面这段合并进 `~/.claude/settings.json`（路径换成你 clone 的位置），效果与插件完全相同：

```jsonc
{
  "hooks": {
    "SessionStart":       [{ "hooks": [{ "type": "command", "command": "node /path/to/dsh-pet/claude-code-plugin/scripts/pet-hook.mjs" }] }],
    "UserPromptSubmit":   [{ "hooks": [{ "type": "command", "command": "node /path/to/dsh-pet/claude-code-plugin/scripts/pet-hook.mjs" }] }],
    "PreToolUse":         [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node /path/to/dsh-pet/claude-code-plugin/scripts/pet-hook.mjs" }] }],
    "PostToolUse":        [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node /path/to/dsh-pet/claude-code-plugin/scripts/pet-hook.mjs" }] }],
    "PostToolUseFailure": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node /path/to/dsh-pet/claude-code-plugin/scripts/pet-hook.mjs" }] }],
    "Notification":       [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node /path/to/dsh-pet/claude-code-plugin/scripts/pet-hook.mjs" }] }],
    "Stop":               [{ "hooks": [{ "type": "command", "command": "node /path/to/dsh-pet/claude-code-plugin/scripts/pet-hook.mjs" }] }],
    "StopFailure":        [{ "hooks": [{ "type": "command", "command": "node /path/to/dsh-pet/claude-code-plugin/scripts/pet-hook.mjs" }] }],
    "SessionEnd":         [{ "hooks": [{ "type": "command", "command": "node /path/to/dsh-pet/claude-code-plugin/scripts/pet-hook.mjs" }] }]
  }
}
```

这种方式下转发脚本会优先用同仓库里构建好的 `dsh-pet/lib/standalone.js` 启动桌宠，连 `npm link` 都可以省掉。

### 退出 / 停用

- **退出桌宠**：系统托盘图标 →「退出桌宠」（或前台运行时 `Ctrl+C`、`POST /shutdown`）。下一个 Claude Code 会话开始时它会再次出现
- **只转发、不自动启动**：环境变量 `DESK_PET_AUTOSTART=0`（之后用 `desk-pet` 手动启动）
- **彻底停用**：`/plugin` 里禁用 desk-pet，或设 `DESK_PET_DISABLE=1`

## 它怎么知道 Claude Code 在干嘛

```
Claude Code ──hook(stdin JSON)──▶ pet-hook.mjs ──POST /claude-code/hook──▶ desk-pet 进程 ──▶ 透明小窗动画 + 气泡
                                   （零依赖，<1s，失败静默）     （读 ~/.desk-pet/server.json 找端口）
```

| Claude Code hook | 桌宠档位 | 动画 |
| --- | --- | --- |
| `UserPromptSubmit` | 思考 | 思考冒泡 |
| `PreToolUse` | 工作（`TodoWrite` 顺带更新气泡里的任务文案） | 忙碌点按 |
| `PreToolUse` · `AskUserQuestion` | 等待（等你选） | 原地踱步张望 |
| `PostToolUse` / `PostToolUseFailure` | 整理 | 清点归档 |
| `Notification`（权限确认 / MCP 征询） | 等待 | 原地踱步张望 |
| `Stop` | 成功（几秒后回到日常） | 雀跃庆祝 |
| `StopFailure`（API 出错、限流等） | 出错 | 垂头叹气冒汗 |
| `Notification`（等你输入）/ `SessionEnd` | 回到空闲 | 日常动作 |

实现上，桌宠进程把 hook 载荷**翻译成原插件本来就消费的会话事件**（`src/standalone/claude-code.ts`），工作状态的聚合、多会话优先级、终态自动过期、任务文案这些逻辑与原版一行未改。桌宠自己调 `claude -p` 生成碎碎念时会关掉 hook 并带上 `DESK_PET_INTERNAL=1`，不会把自己的闲聊当成你的会话。

## 常用环境变量

| 变量 | 作用 |
| --- | --- |
| `DESK_PET_HOME` | 数据目录（默认 `~/.desk-pet`；配置、对话记忆、Electron、日志都在这里） |
| `DESK_PET_MODEL` | 碎碎念 / 对话用的模型别名（默认 `haiku`，可填 `sonnet` / `opus`） |
| `DESK_PET_CLAUDE_BIN` | `claude` 可执行文件路径（默认走 PATH） |
| `DESK_PET_CMD` | 转发脚本自动启动桌宠时用的整条命令（默认找同仓库的 `lib/standalone.js`，再找 PATH 上的 `desk-pet`） |
| `DESK_PET_AUTOSTART=0` / `DESK_PET_DISABLE=1` | 只转发不自动启动 / 完全停用 |
| `DESK_PET_OPEN_URL` | 右键「打开 Claude Code」打开的地址（默认 `https://claude.ai/code`） |
| `DESK_PET_PORT` | 转发脚本直接用这个端口（不读 `server.json`） |

## 没出现怎么办

1. 看日志：`~/.desk-pet/desk-pet.log`（由 hook 自动启动时的输出）
2. 在终端里前台跑一次：`desk-pet`，看横幅里的「桌面小窗」是否为 1 只、有没有报错；`desk-pet --check` 体检
3. 提示找不到 `desk-pet` 命令：回到「快速开始 ①」执行 `npm link`，或设 `DESK_PET_CMD="node /path/to/dsh-pet/dsh-pet/lib/standalone.js"`
4. 排查 hook 有没有到：`DSH_PET_STANDALONE_DEBUG=1 desk-pet` 前台运行，每条 hook 都会打一行 `hook PreToolUse → tool/call`
5. Linux 无图形环境（SSH / 容器）会自动跳过桌面窗口；远程桌面 / Xvfb 可设 `DSH_PET_DESKTOP_FORCE=1`

## 功能一览

- **跟着 Claude Code 干活**：思考 / 工作 / 整理 / 等待 / 成功 / 出错六档动画 + 头顶气泡；多个会话同时跑时按优先级展示（等你确认 > 出错 > 工作 > 思考 > 整理 > 成功），子代理的工具调用也算在父会话的「工作」里
- **碎碎念与对话**：走 `claude -p`，人设见配置里的 `whisperPrompt`；右键「对话」与它聊天，记忆持久化在 `~/.desk-pet/dsh-pet/memory.json`；还会从表情包池里挑一张配图
- **动画链**：每个动画（含待机）播完即按权重选下一个，首尾相接；双缓冲交叉淡入，切换无空白帧
- **屏幕漫游 / 点击 / 拖拽 / 甩抛**：朝朝向方向行走、不走出屏幕；拖拽阻尼弹簧跟手，甩出抛物线飞行、屏幕边缘反弹、落地 Q 弹
- **右键菜单**：打开 Claude Code、碎碎念、对话、回到初始位置、隐藏（托盘可恢复）、重载配置，以及「动作 → 分类 → 具体动画」任意点播
- **多开**：同时显示多只宠物，各自独立大小与位置；还能用 pet pack 添加**全新种类**（见下文「配置 → 方式四」）
- **自定义动画**：往 `~/.desk-pet/dsh-pet/main-animation/webm/` 放 VP9-Alpha 的 `.webm` 即为新动画，优先于包内素材
- **托盘**：开关每只宠物的桌面显示、退出桌宠
- **无障碍**：支持 `prefers-reduced-motion`

> 原版的 DSH 插件形态（浏览器浮层、网页设置页、余额查询、系统通知、斜杠命令）已从本仓库删除，想要那一版请看[原项目](https://github.com/PC2005-cloud/dsh-pet)。

## 🔌 对外接口（供其他插件调用）

桌宠不只自己玩，也**对外开放一套 HTTP 接口**，让别的插件或脚本能驱动它、读它的状态。

- **能做什么**：让它说一句指定的话、播一段指定动画、与它对话、把它挪到某个位置或抛出去；读它当前说的话与工作状态
- **为什么开放**：桌宠不该只是个摆设——比如一个「女仆」插件巡检验完想说句话，就能让桌宠当它的「实体」开口；也方便任何人基于它做二次开发
- **怎么调**：基址 `http://127.0.0.1:<端口>/dsh-pet-7340`（端口见 `~/.desk-pet/server.json`，默认 3080；只监听本机、无鉴权）。动作类接口只回 `{ok}`，数据统一从 `GET /state` 读。在 Claude Code 里，你甚至可以让 Claude 自己 `curl` 一下，让桌宠替它说句话

三个相关文件：

- [`API.md`](API.md) —— 接口一览（每个接口一句话，功能预览）
- [`openapi.yaml`](openapi.yaml) —— 完整契约（OpenAPI 3.1，可直接导入 Swagger UI / Postman）
- [`tools/api-tester.html`](tools/api-tester.html) —— 桌宠控制台：扮演第三方消费方的示例页面，可直观试用（`node tools/api-tester.cjs` 启动）


## 兼容性

- **Claude Code**：需要支持插件与 hooks 的版本（2.1 及以上实测）；hook 转发脚本只用 Node 内置模块（Claude Code 自带 Node 环境即可）
- **操作系统**：Windows / Linux / macOS 三端均可运行（Electron 透明置顶窗）；Electron 按平台自动探测/下载（`electron.exe` / `Electron.app` / linux 单文件），无需手动安装
- **无头 / 无桌面环境**：Linux 无 `DISPLAY` / `WAYLAND_DISPLAY`（SSH、容器）时自动跳过桌面窗口，只打一行日志告警；hook 照常接收，不影响 Claude Code
- **多显示器**：支持多屏环境——跨屏漫游/抛掷以各屏工作区为界，异构缩放（各屏 DPI 不同）、任务栏条带、屏幕之间空洞均正确判定（横屏 / 竖屏 / 上下叠放皆可）


## ⚙️ 碎碎念与对话

- **模型后端**：Claude Code 模式下走 `claude -p`——用的是你在 Claude Code 里的登录（订阅 / API key / Bedrock / Vertex 都行），不用另配 key；默认 `haiku`，环境变量 `DESK_PET_MODEL=sonnet` 可换。调用时关闭全部工具、MCP 与 hook，也不写进 `/resume` 会话列表；**会计入你的 Claude 用量**
- **碎碎念**：`pets[i].whisperEnabled` 开启后，按 `eventsRefreshSec.whisper`（秒，默认 900）周期自动生成一句——每只宠物独立周期、独立文案；触发时随机抽 `events.whisper` 动画 + 头顶说话气泡（10 秒消失）。默认开启
- **手动触发**：右键菜单「碎碎念」随时来一句——不受 `whisperEnabled` 门控（该字段只关自动周期轮询）
- **对话**：右键菜单「对话」打开输入框，与宠物聊天——回复走碎碎念同款展示（说话动画 + 气泡）；记忆持久化在 `~/.desk-pet/dsh-pet/memory.json`（每只宠物各一份）

## ⚙️ 工作状态联动（Work Status）

`pets[i].workStatusEnabled` 开启后，宠物跟随 Claude Code 会话活动（经 hook，对应关系见上文「它怎么知道 Claude Code 在干嘛」）切「思考 / 工作 / 整理 / 等待 / 成功 / 出错」六档动画 + 头顶气泡：非终态动画循环播、气泡常驻；成功 / 出错播一遍、气泡 10 秒自动收起。

- **档位动画**：`animations.events.workStatus` 数组，索引即档位（勿在中间插入新档，只可追加末尾）
- **气泡文案**：`workStatusTexts` 每档可配多句随机，任务详情（Claude Code 的 TodoWrite 清单里正在做的那一项）优先
- **档位候选数组**：任意档位槽位可写 `string | string[]`——数组 = 档内随机抽 1，循环播放自动轮换、避免连播同一段（碎碎念档位同样适用）

## ⚙️ 配置（大小 / 位置 / 多开）

所有配置都是 JSONC 文件，**改完右键宠物「重载配置」即生效**（或重启 `desk-pet`）。配置有错时不会静默：错误写在 `~/.desk-pet/desk-pet.log` / 前台终端里，桌面上会出现红色错误条并每 5 秒重试。

### 包内默认：`dsh-pet/assets/config.jsonc`

完整的结构参考（注释齐全）：宠物列表、动画池、播放权重、事件动画、刷新周期、物理参数、人设提示词……不要直接改它，把想改的字段抄进下面的用户配置即可。

```jsonc
"pets": [
  { "id": "main", "name": "蓝毛小女仆", "size": 462, "whisperEnabled": true,
    "workStatusEnabled": true, "display": "desktop", "position": { "corner": "top-right", "marginX": 24, "marginY": 100 } }
]
```

- 每只宠物：`id`（唯一标识）／ `name`（显示名，也会进人设）／ `size`（宽度 px，高度 = 宽 × 9/16）／ `whisperEnabled`（自动碎碎念）／ `workStatusEnabled`（跟随 Claude Code 切换工作状态）／ `display`（`desktop` = 显示、`none` = 隐藏；托盘里也能切）／ `position`（`corner` 四角之一 + `marginX` / `marginY` 边距）
- 多只宠物 = `pets` 里写多项，每只独立大小与位置

### 用户配置：`~/.desk-pet/dsh-pet/main-config.jsonc`

**与包内默认同一套格式**，只写你想改的顶层字段；没写的回落默认。第一次可以直接把包内 `config.jsonc` 整份复制过来再改：

| 字段                   | 作用                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| `pets`                 | 宠物列表（大小 / 位置 / 多开 / 各项开关）                                                  |
| `whisperPrompt`        | 碎碎念与对话共用的人设提示词                                                               |
| `whisperModel` / `chatModel` | 单独指定模型：`{ "provider": "claude-code", "model": "sonnet" }`；都留空 = 用 `DESK_PET_MODEL`（默认 haiku） |
| `chatMemoryRounds`     | 对话每次带上的最近历史轮数（默认 5）                                                       |
| `workStatusTexts`      | 六档工作状态的气泡文案（每档可写多句随机）                                                 |
| `animations`           | **动画池**：idle / turn / drag / clicks / moves / categories / events（工作状态等事件动画） |
| `animationWeights`     | 动画链播放权重（idle / turn / move）                                                       |
| `eventsRefreshSec`     | 刷新周期（秒）：`whisper` = 自动碎碎念间隔（默认 900）                                     |
| `physics`              | 拖拽抛掷手感：重力 / 弹性 / 地面摩擦 / 顶部反弹 / 总力度 / 宠物互撞                         |
| `memes` / `whisperImageEnabled` / `chatImageEnabled` | 表情包配图映射与开关                                         |

> 覆盖语义：用户层给出即**整体替换**该字段（如写了 `animations` 就用你的整份动画池），没写的字段回落包内默认。

同目录下还有：对话记忆 `memory.json`（删掉即清空记忆）、自定义动画 `main-animation/webm/*.webm`（VP9-Alpha，优先于包内素材，在动画池里写文件名即可用）、自定义表情包 `memes/*.png`（键与描述写进 `memes`）。

### 额外宠物（pet pack）——添加新「种类」

上面只能调整**默认宠物的实例**（数量/大小/位置），动画池始终是一份。要添加**全新种类的宠物**（独立动画池 + 自己的素材），在用户数据根下建 `pet/` 目录：

```
~/.desk-pet/dsh-pet/
├─ main-config.jsonc           ← 主宠物配置（现有，不动）
├─ main-animation/webm/*.webm  ← 主宠物素材（现有，只属于 main）
└─ pet/
   ├─ pig-config.json          ← 额外宠物 pig 的配置（命名词干 = 种类名，实例 id 任意）
   └─ pig-animation/*.webm     ← pig 自己的动画素材（直接平铺，仿 main-animation）
```

每只额外宠物 = 一个 `-config.json` + 一个 `-animation/` 目录，同前缀配对；扫描 `pet/` 自动发现，右键「重载配置」即生效。一个 `-config.json` 定义**一个「种类」**（动画池 + 素材目录），`pets` 数组可放该种类的**任意多只实例**（共享动画池与素材）：

```jsonc
// pet/pig-config.json —— 与 main-config.jsonc 同构的完整配置
{
  "notificationsEnabled": true,
  "pets": [
    {
      "id": "pig1",              // 实例 id（可多只；不必等于文件名前缀）
      "size": 420,
      "display": "desktop",     // desktop = 显示 / none = 隐藏
      "position": { "corner": "top-right", "marginX": 24, "marginY": 100 }
    },
    { "id": "pig2", "size": 360, "display": "desktop", "position": { "corner": "top-left", "marginX": 24, "marginY": 100 } }
  ],
  "animations": {
    "idle": ["待机"], "turn": [], "drag": [], "clicks": ["打滚"],
    "moves": { "default": { "minDist": 80, "maxDist": 360, "margin": 20, "leadSec": 2, "tailSec": 2 }, "actions": [] },
    "categories": [],
    // workStatus 六档 = 思考 / 工作 / 整理 / 等待 / 成功 / 出错
    "events": { "workStatus": ["思考", "干活", "整理", "等你", "庆祝", "沮丧"] }
  },
  "animationWeights": { "idle": 80, "turn": 0, "move": 0 },
  "eventsRefreshSec": { "whisper": 900 }
}
```

规则（与主宠物**严格隔离**，绝不混用）：
- **素材只查自己的**：素材目录名 = 文件名前缀（`pet/pig-config.json` → `pet/pig-animation/`），该种类所有实例共用；动画 URL `/thumb/<前缀>/<名>.webm`，查不到即 404——绝不落到 `main-animation` 或包内素材
- **动画池不回落全局**：`animations` / `animationWeights` 必须写全（缺失即配置错误）
- 与主配置同构的约束：`pets` 每只字段完整合法、数组内 id 唯一、`animations` / `animationWeights` 结构校验同一套规则；`notificationsEnabled` / `eventsRefreshSec` 是全局属性，不归宠物文件管（写了忽略、不写不报错）
- 配置非法 / 缺少 `-animation/` 目录 / 实例 id 与主宠物冲突 → 加载时显式报错并跳过（不影响其他宠物）
## 效果预览

全部动画（640×360，插件实际播放用的资源）——GIF 预览存放于仓库 `dsh-pet/assets/preview/`（raw 直链渲染，文件名采用拼音便于跨平台）；完整透明视频见插件包 `dsh-pet/assets/webm/`（VP9-alpha，唯一发布格式）：

**待机 / 转向**

<p>
  <img src="dsh-pet/assets/preview/daiji-huxi-xiuxian.gif" width="160" alt="待机呼吸休闲" title="待机呼吸休闲">
  <img src="dsh-pet/assets/preview/dongzhangxiwang.gif" width="160" alt="东张西望" title="东张西望">
</p>

**移动**

<p>
  <img src="dsh-pet/assets/preview/pangxie-zoulu.gif" width="160" alt="螃蟹走路" title="螃蟹走路">
  <img src="dsh-pet/assets/preview/yuandi-piaofu-tabu.gif" width="160" alt="原地漂浮踏步" title="原地漂浮踏步">
  <img src="dsh-pet/assets/preview/yuandi-zuozhuan-benpao.gif" width="160" alt="原地左转奔跑" title="原地左转奔跑">
</p>

**小动作**

<p>
  <img src="dsh-pet/assets/preview/youxian-hengga.gif" width="160" alt="悠闲哼歌" title="悠闲哼歌">
  <img src="dsh-pet/assets/preview/chaoda-shenlanyao.gif" width="160" alt="超大伸懒腰" title="超大伸懒腰">
  <img src="dsh-pet/assets/preview/yuandi-qiaoji-zhuomian-hudong.gif" width="160" alt="原地敲击桌面互动" title="原地敲击桌面互动">
  <img src="dsh-pet/assets/preview/yuandi-zhongli-xiadun-yasuo.gif" width="160" alt="原地重力下蹲压缩" title="原地重力下蹲压缩">
  <img src="dsh-pet/assets/preview/haqian-liantian.gif" width="160" alt="哈欠连天" title="哈欠连天">
  <img src="dsh-pet/assets/preview/yuandi-xiaoqi-chenmian.gif" width="160" alt="原地小憩沉眠" title="原地小憩沉眠">
  <img src="dsh-pet/assets/preview/nvpu-quxi-liyi.gif" width="160" alt="女仆屈膝礼仪" title="女仆屈膝礼仪">
  <img src="dsh-pet/assets/preview/beixiayitiao-zhamao.gif" width="160" alt="被吓一跳" title="被吓一跳">
  <img src="dsh-pet/assets/preview/xiaofudu-yuandi-360du-xuanzhuan-zhanshi.gif" width="160" alt="小幅度原地360度旋转展示" title="小幅度原地360度旋转展示">
  <img src="dsh-pet/assets/preview/touchi-lingshi-bei-zhuazhu.gif" width="160" alt="偷吃零食被抓住" title="偷吃零食被抓住">
  <img src="dsh-pet/assets/preview/yong-jingyu-weiba-paidadi.gif" width="160" alt="用鲸鱼尾巴拍打地面" title="用鲸鱼尾巴拍打地面">
  <img src="dsh-pet/assets/preview/da-keshui-bei-jingxing.gif" width="160" alt="打瞌睡被惊醒" title="打瞌睡被惊醒">
  <img src="dsh-pet/assets/preview/zhao-jingzi.gif" width="160" alt="照镜子" title="照镜子">
  <img src="dsh-pet/assets/preview/zhengti-huanzhuang-shise.gif" width="160" alt="整体换装试色" title="整体换装试色">
  <img src="dsh-pet/assets/preview/qingkuai-jilu.gif" width="160" alt="轻快记录" title="轻快记录">
  <img src="dsh-pet/assets/preview/xie-daima.gif" width="160" alt="写代码" title="写代码">
  <img src="dsh-pet/assets/preview/yaoshan-naliang.gif" width="160" alt="摇扇纳凉" title="摇扇纳凉">
  <img src="dsh-pet/assets/preview/chenjian-shuaya.gif" width="160" alt="晨间刷牙" title="晨间刷牙">
</p>

**玩耍**

<p>
  <img src="dsh-pet/assets/preview/yuandi-zhuanxin-wan-mofang.gif" width="160" alt="原地专心玩魔方" title="原地专心玩魔方">
  <img src="dsh-pet/assets/preview/yuandi-dunxia-wan-wanju-qiche.gif" width="160" alt="原地蹲下玩玩具汽车" title="原地蹲下玩玩具汽车">
  <img src="dsh-pet/assets/preview/jingyu-tu-paopao-texiao.gif" width="160" alt="鲸鱼吐泡泡特效" title="鲸鱼吐泡泡特效">
  <img src="dsh-pet/assets/preview/yuandi-tiaoyue-zhuasui-touding-wupin.gif" width="160" alt="原地跳跃抓碎头顶物品" title="原地跳跃抓碎头顶物品">
  <img src="dsh-pet/assets/preview/wan-youxi-qijibaituai.gif" width="160" alt="玩游戏气急败坏" title="玩游戏气急败坏">
  <img src="dsh-pet/assets/preview/wan-shuiqiang.gif" width="160" alt="玩水枪" title="玩水枪">
  <img src="dsh-pet/assets/preview/xiaotiqin-yanzou.gif" width="160" alt="小提琴演奏" title="小提琴演奏">
  <img src="dsh-pet/assets/preview/lanjing-xianshi.gif" width="160" alt="蓝鲸现世" title="蓝鲸现世">
  <img src="dsh-pet/assets/preview/youya-nvpuwu.gif" width="160" alt="优雅女仆舞" title="优雅女仆舞">
  <img src="dsh-pet/assets/preview/qingkuai-yaobaiwu.gif" width="160" alt="轻快摇摆舞" title="轻快摇摆舞">
  <img src="dsh-pet/assets/preview/keai-zhaiwu.gif" width="160" alt="可爱宅舞" title="可爱宅舞">
  <img src="dsh-pet/assets/preview/chui-qiqiu.gif" width="160" alt="吹气球" title="吹气球">
  <img src="dsh-pet/assets/preview/dongwu-huanrao.gif" width="160" alt="动物环绕" title="动物环绕">
  <img src="dsh-pet/assets/preview/fang-fengzheng.gif" width="160" alt="放风筝" title="放风筝">
  <img src="dsh-pet/assets/preview/chai-liwu.gif" width="160" alt="拆礼物" title="拆礼物">
  <img src="dsh-pet/assets/preview/bian-gezi.gif" width="160" alt="变鸽子" title="变鸽子">
  <img src="dsh-pet/assets/preview/puke-moshu.gif" width="160" alt="扑克魔术" title="扑克魔术">
  <img src="dsh-pet/assets/preview/chou-tuoluo.gif" width="160" alt="抽陀螺" title="抽陀螺">
  <img src="dsh-pet/assets/preview/chui-dizi.gif" width="160" alt="吹笛子" title="吹笛子">
  <img src="dsh-pet/assets/preview/hudie-mifeng-huanrao-touding-kaihua.gif" width="160" alt="蝴蝶蜜蜂环绕头顶开花" title="蝴蝶蜜蜂环绕头顶开花">
  <img src="dsh-pet/assets/preview/lu-mao.gif" width="160" alt="撸猫" title="撸猫">
  <img src="dsh-pet/assets/preview/pingkong-shenghua.gif" width="160" alt="凭空生花" title="凭空生花">
  <img src="dsh-pet/assets/preview/qi-muma.gif" width="160" alt="骑木马" title="骑木马">
  <img src="dsh-pet/assets/preview/sanqiu-paojie.gif" width="160" alt="三球抛接" title="三球抛接">
  <img src="dsh-pet/assets/preview/ti-jianzi.gif" width="160" alt="踢毽子" title="踢毽子">
  <img src="dsh-pet/assets/preview/xiawuziqi.gif" width="160" alt="下五子棋" title="下五子棋">
  <img src="dsh-pet/assets/preview/dangqiuqian.gif" width="160" alt="荡秋千" title="荡秋千">
</p>

**吃什么**

<p>
  <img src="dsh-pet/assets/preview/chi-baifan.gif" width="160" alt="吃白饭" title="吃白饭">
  <img src="dsh-pet/assets/preview/dakou-chi-lingshi.gif" width="160" alt="大口吃零食" title="大口吃零食">
  <img src="dsh-pet/assets/preview/chi-token.gif" width="160" alt="吃Token" title="吃Token">
  <img src="dsh-pet/assets/preview/chi-zaocan.gif" width="160" alt="吃早餐" title="吃早餐">
  <img src="dsh-pet/assets/preview/chi-wucan.gif" width="160" alt="吃午餐" title="吃午餐">
  <img src="dsh-pet/assets/preview/chi-wancan.gif" width="160" alt="吃晚餐" title="吃晚餐">
  <img src="dsh-pet/assets/preview/chi-bingqilin-ronghua.gif" width="160" alt="吃冰淇淋融化" title="吃冰淇淋融化">
  <img src="dsh-pet/assets/preview/chi-dazhaxie.gif" width="160" alt="吃大闸蟹" title="吃大闸蟹">
  <img src="dsh-pet/assets/preview/chi-tanghulu.gif" width="160" alt="吃糖葫芦" title="吃糖葫芦">
  <img src="dsh-pet/assets/preview/chi-changshoumian.gif" width="160" alt="吃长寿面" title="吃长寿面">
  <img src="dsh-pet/assets/preview/chi-xigua.gif" width="160" alt="吃西瓜" title="吃西瓜">
  <img src="dsh-pet/assets/preview/shuan-huoguo.gif" width="160" alt="涮火锅" title="涮火锅">
</p>

**时节**

<p>
  <img src="dsh-pet/assets/preview/beiluoye-yanmo.gif" width="160" alt="被落叶淹没" title="被落叶淹没">
  <img src="dsh-pet/assets/preview/zhongqiu-shangyue-chi-yuebing.gif" width="160" alt="中秋赏月吃月饼" title="中秋赏月吃月饼">
  <img src="dsh-pet/assets/preview/duixueren.gif" width="160" alt="堆雪人" title="堆雪人">
  <img src="dsh-pet/assets/preview/fang-yanhua.gif" width="160" alt="放烟花" title="放烟花">
  <img src="dsh-pet/assets/preview/chi-zongzi.gif" width="160" alt="吃粽子" title="吃粽子">
  <img src="dsh-pet/assets/preview/chi-niangao.gif" width="160" alt="吃年糕" title="吃年糕">
  <img src="dsh-pet/assets/preview/chi-qingtuan.gif" width="160" alt="吃青团" title="吃青团">
  <img src="dsh-pet/assets/preview/chi-labazhou.gif" width="160" alt="吃腊八粥" title="吃腊八粥">
  <img src="dsh-pet/assets/preview/chi-chongyanggao.gif" width="160" alt="吃重阳糕" title="吃重阳糕">
  <img src="dsh-pet/assets/preview/shou-hongbao.gif" width="160" alt="收红包" title="收红包">
  <img src="dsh-pet/assets/preview/xie-fuzi.gif" width="160" alt="写福字" title="写福字">
  <img src="dsh-pet/assets/preview/chuanzhenqiqiao.gif" width="160" alt="穿针乞巧" title="穿针乞巧">
  <img src="dsh-pet/assets/preview/wu-shitou.gif" width="160" alt="舞狮头" title="舞狮头">
  <img src="dsh-pet/assets/preview/taotang-nanguadeng.gif" width="160" alt="讨糖南瓜灯" title="讨糖南瓜灯">
  <img src="dsh-pet/assets/preview/cha-zhuyu-shangju.gif" width="160" alt="插茱萸赏菊" title="插茱萸赏菊">
  <img src="dsh-pet/assets/preview/fanghedeng.gif" width="160" alt="放河灯" title="放河灯">
  <img src="dsh-pet/assets/preview/menghua-xiaoyouling.gif" width="160" alt="萌化小幽灵" title="萌化小幽灵">
  <img src="dsh-pet/assets/preview/zhuangdian-shengdanshu.gif" width="160" alt="装点圣诞树" title="装点圣诞树">
  <img src="dsh-pet/assets/preview/fang-kongmingdeng.gif" width="160" alt="放孔明灯" title="放孔明灯">
  <img src="dsh-pet/assets/preview/chitangyuan.gif" width="160" alt="吃汤圆" title="吃汤圆">
  <img src="dsh-pet/assets/preview/chijiaozi.gif" width="160" alt="吃饺子" title="吃饺子">
</p>

**文字**

<p>
  <img src="dsh-pet/assets/preview/shia-chishenme.gif" width="160" alt="是啊，吃什么" title="是啊，吃什么">
  <img src="dsh-pet/assets/preview/shendu-sikao-suisuinian.gif" width="160" alt="深度思考碎碎念" title="深度思考碎碎念">
</p>

**点击回应**

<p>
  <img src="dsh-pet/assets/preview/dianji-huiying-kaixin-yuedong.gif" width="160" alt="点击回应-开心跃动" title="点击回应-开心跃动">
  <img src="dsh-pet/assets/preview/dianji-huiying-haixiu-jingya.gif" width="160" alt="点击回应-害羞惊讶" title="点击回应-害羞惊讶">
  <img src="dsh-pet/assets/preview/dianji-huiying-aojiao-shengqi-ceshen-zhanshi.gif" width="160" alt="点击回应-傲娇生气" title="点击回应-傲娇生气">
  <img src="dsh-pet/assets/preview/dianji-huiying-naoyang-gegexiao.gif" width="160" alt="点击回应-挠痒咯咯笑" title="点击回应-挠痒咯咯笑">
  <img src="dsh-pet/assets/preview/dianji-huiying-yuanqi-huishou.gif" width="160" alt="点击回应-元气挥手" title="点击回应-元气挥手">
</p>

**拖拽**

<p>
  <img src="dsh-pet/assets/preview/beishubiao-tuozhuai-xuankong-fankui.gif" width="160" alt="被鼠标拖拽悬空反馈" title="被鼠标拖拽悬空反馈">
</p>

**碎碎念说话动画**（碎碎念 / 对话回复触发，随机抽 1 段）

<p>
  <img src="dsh-pet/assets/preview/suisuinian-cazhuo-suisuinian.gif" width="160" alt="碎碎念-擦桌碎碎念" title="碎碎念-擦桌碎碎念">
  <img src="dsh-pet/assets/preview/suisuinian-fadai-suisuinian.gif" width="160" alt="碎碎念-发呆碎碎念" title="碎碎念-发呆碎碎念">
  <img src="dsh-pet/assets/preview/suisuinian-duiping-suisuinian.gif" width="160" alt="碎碎念-对屏碎碎念" title="碎碎念-对屏碎碎念">
</p>

**工作状态动画**（跟随 Claude Code 的 hook 事件，六档：思考 / 工作 / 整理 / 等待 / 成功 / 出错）

<p>
  <img src="dsh-pet/assets/preview/gongzuozhuangtai-sikao-maopao.gif" width="160" alt="工作状态-思考冒泡" title="工作状态-思考冒泡">
  <img src="dsh-pet/assets/preview/gongzuozhuangtai-manglu-dianan.gif" width="160" alt="工作状态-忙碌点按" title="工作状态-忙碌点按">
  <img src="dsh-pet/assets/preview/gongzuozhuangtai-qingdian-guidang.gif" width="160" alt="工作状态-清点归档" title="工作状态-清点归档">
  <img src="dsh-pet/assets/preview/gongzuozhuangtai-yuandi-duobu-zhangwang.gif" width="160" alt="工作状态-原地踱步张望" title="工作状态-原地踱步张望">
  <img src="dsh-pet/assets/preview/gongzuozhuangtai-queyue-qingzhu.gif" width="160" alt="工作状态-雀跃庆祝" title="工作状态-雀跃庆祝">
  <img src="dsh-pet/assets/preview/gongzuozhuangtai-chuitou-tanqi-maohan.gif" width="160" alt="工作状态-垂头叹气冒汗" title="工作状态-垂头叹气冒汗">
</p>

> 注：动画为透明背景；GIF 预览中透明部分显示为页面底色，实际 webm 播放为透明。

## 从零生成你自己的宠物（完整流程）

### ① 提示词 → 源视频

用 AI 视频生成工具（如可灵、Runway、豆包等，本项目素材即由豆包生成），按 `prompts/桌面宠物 10 秒动作提示词.md` 的配方，一个动作生成一段 10 秒绿幕视频：

- 视频比例 16:9，背景纯绿幕（#00FF00）
- 人物位置/大小固定（头顶 ~20% 高度、脚底 ~85% 高度）
- 动作全程在画幅内，首尾帧为标准正面站立
- 每段动画按秒分解（0-10s 各阶段动作）

生成结果按动作各存一个 mp4，放入 `video/`。

> **源视频获取**：为控制仓库体积，`video/` 源视频不入 git。Releases 提供**打包压缩包**，浏览器直接下载即可：
>
> - `assets-videos.zip` —— 全部源视频压缩包（中文名 mp4，解压后放入 `video/`）
>
> 解压：`Expand-Archive assets-videos.zip`（Windows）或 `unzip assets-videos.zip`，把 mp4 放回 `video/` 即可运行素材链。

### ② 源视频 → 透明动画（素材链）

step02（透明视频）有**两条路线，按需二选一**（默认自动、人人可复现；效果不佳可用 PR 手工抠像覆盖）：

```sh
cd scripts
# 路线 A（默认）：自动绿幕抠像（HSV 色相，无需人工）
python watermark_step01.py   # 水印遮罩填充 → step01/
python chroma_step02.py      # 绿幕抠像转透明 → step02/

# 路线 B（可选）：PR 手工抠像覆盖（针对含第三方物品/自动抠像效果不佳的动作）
#   1. 在 PR 里手工抠像，导出带 alpha 的透明 .mov（如 ProRes 4444 with Alpha）
#   2. 放入 pr/，文件名与动作名一致（如 吃白饭.mov）
python pr_import_step02.py   # pr/*.mov → step02/（透明 webm，覆盖该动作自动抠像结果）

# 后续步骤两条路线共用：
python normalize_step03.py   # 归一化 2160×1215 统一站立居中 → step03/
python encode_thumbs.py      # 转码 640×360 播放变体 → step04/
```

**依赖**：Python 3 + ffmpeg + numpy + scipy（素材链脚本自动用工作区 `.tools/` 下的 ffmpeg）。

> **本项目全部采用路线 B**（全部动作均为 PR 手工抠像）：对"含第三方物品/透明边缘复杂"的动作，自动 HSV 抠像易残边或误抠，PR 手动遮罩更精细。两条路线产出同一级 `step02/`，后续步骤完全一致；`chroma_step02.py` 保留为自动化兜底，任何动作仍可一键自动生成。

### ③ 动画 → 桌宠

```sh
# 把 step04 的播放变体同步进包内素材（webm 直接 cp），然后重新构建
cp step04/*.webm dsh-pet/assets/webm/   # 播放格式（VP9-alpha）
cd dsh-pet && npm run build
```

只想加几个动画、不想动包内素材：直接放进 `~/.desk-pet/dsh-pet/main-animation/webm/`，在动画池里写上文件名，右键「重载配置」即可。

> 中间产物（step01-04）由脚本生成、不入仓库；`video/` 源视频和脚本是成果、入库维护。

### 项目结构

三件套按 ①②③ 分块（gitignore 的本地目录不列）：

```
├── .claude-plugin/    # Claude Code 插件市场清单（marketplace.json）
├── claude-code-plugin/ # Claude Code 插件：hooks.json + 零依赖转发脚本 scripts/pet-hook.mjs
├── prompts/           # ① 动画生成提示词配方（绿幕规范 + 按秒分解）
├── video/             # ② 素材源视频（绿幕 mp4；不入库，Releases 提供压缩包）
├── scripts/           # ② 素材生成链（Python/ffmpeg：水印 → 抠像 → 归一化 → 转码 → GIF 预览）
├── step01~04/         # ② 素材链中间产物（不入库）
├── pr/  prproj/       # ② 路线 B：PR 手工抠像输入与工程（本地工作数据，不入库）
├── tools/             # 开发小工具（素材链各阶段预览等）
├── assets/            # 仓库展示用截图
├── .github/workflows/ # CI：原项目的 HEVC 素材转码流水线（Claude Code 模式用不到）
├── dsh-pet/           # ③ 桌宠本体（desk-pet 程序 + 素材）
│   ├── src/           #   TS 源码：host（配置/路由/工作状态）、client（动画链）、shared（双端共用纯逻辑）
│   │                  #   standalone（desk-pet 进程：Claude Code hook 翻译、claude -p 后端、单实例）
│   ├── lib/           #   构建产物（npm run build 生成，不入库）
│   ├── runtime/       #   桌面模式运行壳（Electron 透明窗）
│   ├── assets/        #   webm 动画 / preview GIF / 字体 / 图标 / config.jsonc 默认配置
│   └── scripts/       #   构建与发布脚本（prepare.js / prepack-check / ensure-electron 等）
└── LICENSE            # MIT
```

## 许可

- 代码：MIT
- 素材（动画/提示词/源视频）：允许开源使用，**禁止商用**
- **二次创作（二创）约定**：基于本项目的衍生 / 改版 / 换皮作品，在**任何介绍、展示、分发该作品的地方**，须附上原作者 GitHub 地址：<https://github.com/PC2005-cloud/dsh-pet>
