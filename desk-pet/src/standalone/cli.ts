#!/usr/bin/env node
/**
 * desk-pet 入口 —— Claude Code 的桌面宠物进程。
 *
 * 它把三件事串起来（每一步都复用插件自己的实现，没有第二份业务逻辑）：
 *   1. `./context` 造一个伪 Cordis ctx，把插件的宿主半边（`src/host/index.ts` 的 `apply`）跑起来；
 *   2. `./server` 起一个真正的 `node:http` 服务，把 `apply` 注册的 prefix handler 接上去
 *      （路由表仍然只有插件那一份）；
 *   3. 插件自己的 `launchHelper` 因此照常探测 Electron、按配置拉起透明置顶小窗，
 *      并与宿主经 bridge 管道通信。
 *
 * Claude Code 接入（本文件之外各一个模块）：
 *   - `./claude-code`：`POST /claude-code/hook` 收 hook 转发脚本发来的事件，翻译成插件的
 *     `session/event` → 工作状态动画与气泡（思考 / 工作 / 整理 / 等待 / 成功 / 出错）；
 *   - `./claude-llm`：碎碎念 / 对话走 `claude -p`（用户在 Claude Code 里的登录，零额外配置）；
 *   - `./instance`：单实例锁 + `server.json`（多个会话共用一只桌宠，转发脚本据此找端口）。
 *
 * 用法：
 *   desk-pet                          # 前台运行（Ctrl+C 退出）；装了 Claude Code 插件后由 hook 自动拉起
 *   npm run standalone                  # 仓库里跑（先 npm run build）
 *   desk-pet --port 3081
 *   desk-pet --check                  # 只体检，不开窗口
 *
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

import { flattenPetList, readAllConfig } from '../host/config';
import { deskPetHomeDir, packageRoot } from '../host/helper-process';
import { apply } from '../host/index';
import { runCheck, packageVersion } from './check';
import { createClaudeHookRoute, CLAUDE_HOOK_PATH } from './claude-code';
import { CLAUDE_CODE_PROVIDER, createClaudeCliLlm, DEFAULT_CLAUDE_MODEL } from './claude-llm';
import { acquireInstanceLock, migrateLegacyDataDir, removeServerInfo, writeServerInfo } from './instance';
import {
  createStandaloneContext,
  createStandaloneLogger,
  type RegisteredRoute,
  type StandaloneLogger,
} from './context';
import { claudePetHome, configPathsFor, describePets, isDesktopVisible, parseArgs, USAGE } from './options';
import { listenStandaloneServer } from './server';

/**
 * 启动：先起服务拿到端口，再 `apply`（宿主据此拼桌面 Helper 的 configUrl）。
 * @returns 服务起来了返回 null（进程靠它活着）；没起服务就结束时返回退出码
 */
async function run(logger: StandaloneLogger, options: { port: number }): Promise<number | null> {
  const home = deskPetHomeDir();
  const paths = configPathsFor(packageRoot, home);

  // 预检：包内默认配置读不到时宿主半边必然每请求失败；早给可操作的诊断，别让用户对着空桌面猜
  if (!existsSync(paths.defaultFile)) {
    logger.error(
      `包内默认配置缺失：${paths.defaultFile}。若你是在直接跑源码（包根被解析成了 src/），` +
        '请改用构建产物：npm run bundle 后 node lib/standalone.js（或 npm run standalone）。',
    );
    return 1;
  }

  // 单实例：多个 Claude Code 会话各自的 SessionStart 都会来拉一次，只留第一个
  const lock = acquireInstanceLock(home);
  if ('runningPid' in lock) {
    logger.info(`桌宠已在运行（pid ${lock.runningPid}），本次不再启动。`);
    return 0;
  }

  // 旧版把配置 / 记忆放在 <数据目录>/dsh-pet/ 下：挪到 <数据目录>/（只在持锁后做，避免两个实例同时挪）
  const moved = migrateLegacyDataDir(home, (message) => logger.warn(message));
  if (moved.length > 0) logger.info(`已把旧数据目录迁到 ${home}：${moved.join('、')}`);

  const routes: RegisteredRoute[] = [];
  const portRef = { value: options.port };
  const model = process.env.DESK_PET_MODEL || DEFAULT_CLAUDE_MODEL;
  const llm = createClaudeCliLlm({ model, logger });
  const context = createStandaloneContext({
    port: () => portRef.value,
    logger,
    routes,
    llm,
    model: { provider: CLAUDE_CODE_PROVIDER, model },
  });
  // hook 入口先于 apply 注册：exact 路由，与插件的 /desk-pet 前缀互不相干
  routes.push(createClaudeHookRoute(context.emit, logger));
  // /shutdown 的回调要在服务构造时给出去，而停机函数要在服务之后定义：
  // 用一个可替换的转发器解耦（服务构造时只拿到"将来会是谁"）。
  let forwardShutdown: () => void = () => {};
  let server: Awaited<ReturnType<typeof listenStandaloneServer>>;
  try {
    server = await listenStandaloneServer({
      routes,
      logger,
      port: options.port,
      status: () => ({
        name: 'desk-pet',
        plugin: { root: packageRoot, version: packageVersion(packageRoot) },
        port: portRef.value,
        pid: process.pid,
        uptimeSec: Math.round(process.uptime()),
      }),
      onShutdown: () => forwardShutdown(),
    });
  } catch (error) {
    lock.release();
    throw error;
  }
  portRef.value = server.port;
  writeServerInfo(home, {
    pid: process.pid,
    port: server.port,
    version: packageVersion(packageRoot),
    startedAt: new Date().toISOString(),
  });

  let shuttingDown = false;
  const shutdown = async (reason: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`收尾（${reason}）…`);
    // 先释放插件注册的 effect（停桌面 Helper、清周期定时器），再关服务
    await context.dispose();
    await server.close();
    llm.dispose();
    removeServerInfo(home);
    lock.release();
    logger.info('已退出。');
  };
  const requestShutdown = (reason: string): void => {
    shutdown(reason)
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        logger.error(`收尾失败：${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      });
  };
  forwardShutdown = () => requestShutdown('POST /shutdown');
  process.on('SIGINT', () => requestShutdown('SIGINT'));
  process.on('SIGTERM', () => requestShutdown('SIGTERM'));

  // 起插件宿主半边：路由表、状态仓、桌面 Helper（含 bridge 管道）都在这一句里
  apply(context.ctx);

  let pets: Record<string, unknown>[] = [];
  let configSource = paths.userFile;
  try {
    pets = flattenPetList(readAllConfig(paths));
    if (!existsSync(paths.userFile)) configSource = `${paths.userFile}（不存在 → 用包内默认）`;
  } catch (error) {
    logger.warn(
      `读配置失败（服务照常运行，相关端点会显式报错）：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const desktopVisible = pets.filter(isDesktopVisible);
  for (const line of [
    '',
    '===== Claude Code 桌宠 =====',
    `  版本        ${packageVersion(packageRoot)}  ${packageRoot}`,
    `  路由        http://127.0.0.1:${server.port}/desk-pet/`,
    `  hook 入口   POST http://127.0.0.1:${server.port}${CLAUDE_HOOK_PATH}`,
    `  碎碎念/对话 claude -p --model ${model}`,
    `  配置        ${configSource}`,
    `  宠物        ${describePets(pets)}`,
    desktopVisible.length === 0
      ? '  桌面小窗    0 只（宠物都被隐藏了：托盘里勾选即可恢复；服务照常接收 hook）'
      : `  桌面小窗    ${desktopVisible.length} 只`,
    '  退出        托盘菜单「退出桌宠」、Ctrl+C，或 POST /shutdown',
    '',
  ]) {
    logger.info(line);
  }
  if (context.failures.length > 0) {
    logger.warn(`初始化期间有 ${context.failures.length} 项失败（见上方日志）；路由仍可用，相关端点会显式报错`);
  }
  return null;
}

/** CLI 入口：返回退出码；服务在跑时返回 null */
async function main(): Promise<number | null> {
  const parsed = parseArgs(process.argv.slice(2));
  if ('error' in parsed) {
    console.error(`desk-pet: ${parsed.error}\n`);
    console.error(USAGE);
    return 2;
  }
  const { options } = parsed;
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  // 数据目录：没显式给 DESK_PET_HOME 时落到 ~/.desk-pet（配置、对话记忆、Electron 都在这里）
  process.env.DESK_PET_HOME = claudePetHome(process.env, homedir());
  const logger = createStandaloneLogger();
  if (options.check) return runCheck(logger);
  return run(logger, options);
}

/**
 * 写完 stdout 再退出（管道上的 stdout 是异步写的，直接 process.exit 可能截掉最后几行）。
 * 不能只靠「事件循环空了自然退出」：安装版里本文件跑在 Electron 主进程，它不会自己退出。
 */
function exitAfterFlush(code: number): void {
  process.stdout.write('', () => process.exit(code));
}

// 本文件就是可执行入口（package.json 的 bin 指向构建产物 lib/standalone.js），
// 因此无条件启动：不做 import.meta.main / argv[1] 比较之类的守卫 ——
// import.meta.main 要 Node 24+，而 argv[1] 比较在 pnpm 的 bin 符号链接下会判错。
main()
  .then((code) => {
    if (code !== null) exitAfterFlush(code);
  })
  .catch((error: unknown) => {
    console.error(`desk-pet: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    process.exit(1);
  });
