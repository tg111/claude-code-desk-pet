/**
 * desk-pet 的命令行解析与路径推导（纯逻辑，零 I/O —— 便于 node:test 直接单测）。
 *
 * 配置路径：`--check` 要在不 `apply`（= 不拉起桌宠窗口）的前提下回答"会读哪份配置"，
 * 所以这里转出宿主自己的 configPathsFor（同一份实现，不存在镜像漂移）。
 */

import { DEFAULT_STANDALONE_PORT } from './server';

/** 命令行解析结果 */
export interface CliOptions {
  port: number;
  check: boolean;
  help: boolean;
}

/** `--help` 正文 */
export const USAGE = `desk-pet —— Claude Code 的桌面宠物

用法：desk-pet [选项]

选项：
  --port <端口>   监听端口（默认 ${DEFAULT_STANDALONE_PORT}；被占用时自动向后顺延）
  --check         只体检：打印配置来源、宠物清单与 Electron 状态，不启动窗口
  -h, --help      显示本帮助

说明：
  桌宠以「透明置顶小窗」运行；装上 Claude Code 插件（claude-code-plugin/）后，
  它会在会话开始时被自动拉起，并跟着 Claude Code 的 hook 事件切换工作状态动画。
  碎碎念 / 对话走 claude -p（模型别名用 DESK_PET_MODEL 指定，默认 haiku）。

环境变量：
  DESK_PET_HOME       数据目录（默认 ~/.desk-pet）
  DESK_PET_MODEL      碎碎念 / 对话用的模型别名（默认 haiku）
  DESK_PET_CLAUDE_BIN claude 可执行文件路径（默认走 PATH）
`;

/**
 * 数据目录：DESK_PET_HOME → ~/.desk-pet（与宿主同一份实现）。
 * CLI 把结果写回 DESK_PET_HOME，宿主内所有按它推导的路径（配置、记忆、Electron 落地目录）随之确定。
 */
export { dataHomeFor as claudePetHome } from '../host/helper-process';

/**
 * 解析 argv。
 * @param argv `process.argv.slice(2)`
 * @returns 选项，或 `{ error }`（调用方打印用法并以 2 退出）
 */
export function parseArgs(argv: string[]): { options: CliOptions } | { error: string } {
  const options: CliOptions = { port: DEFAULT_STANDALONE_PORT, check: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg === '--check') {
      options.check = true;
    } else if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '--port' || arg.startsWith('--port=')) {
      const raw = arg === '--port' ? String(argv[index + 1] ?? '') : arg.slice('--port='.length);
      if (arg === '--port') index += 1;
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 1 || value > 65535) {
        return { error: `--port 需要 1..65535 的整数端口，收到 ${JSON.stringify(raw)}` };
      }
      options.port = value;
    } else {
      return { error: `未知参数：${arg}` };
    }
  }
  return { options };
}

/** 配置路径推导：与宿主同一份实现（见 host/config.ts） */
export { configPathsFor } from '../host/config';

/** 宠物列表的展示串：`display` 原样打印，由用户确认（独立模式不替用户改配置） */
export function describePets(pets: Record<string, unknown>[]): string {
  if (pets.length === 0) return '（没有宠物：配置里 pets 为空）';
  return pets
    .map((pet) => `${String(pet.id ?? '?')}(size=${String(pet.size ?? '?')}, display=${String(pet.display ?? '?')})`)
    .join('  ');
}

/**
 * 该实例是否会出现在桌面（`display` 含 desktop/both）。
 *
 * 口径来源是 `src/host/index.ts` 的 `isDesktopVisible`（那里是模块内 const、未导出），
 * 独立模式只是为了**打印提示**才知道这条规则，不参与渲染决策（渲染由插件自己判断），
 * 因此这里保留一份最小镜像；规则若变，测试与提示文案会露出来。
 */
export function isDesktopVisible(pet: Record<string, unknown>): boolean {
  const display = pet.display;
  return display === 'desktop' || display === 'both';
}
