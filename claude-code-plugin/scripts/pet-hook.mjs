#!/usr/bin/env node
/**
 * Claude Code hook → 桌宠 的转发脚本（零依赖，只用 Node 内置模块）。
 *
 * Claude Code 每触发一次 hook，就把事件 JSON 写进本脚本的 stdin。本脚本只做两件事：
 *   1. 转发：读 `~/.desk-pet/server.json` 找到桌宠服务的端口，把原始载荷 POST 到
 *      `/claude-code/hook`（翻译成动画档位在桌宠那边做，见 dsh-pet/src/standalone/claude-code.ts）；
 *   2. 自动拉起：桌宠没在跑时，SessionStart / UserPromptSubmit 会在后台把它启动起来。
 *
 * 铁律：**绝不拖慢、绝不打断 Claude Code**。任何失败都静默退出 0，不往 stdout 写任何东西
 * （SessionStart / UserPromptSubmit 的 stdout 会被当成上下文塞进对话），整体耗时控制在 1 秒内。
 *
 * 环境变量：
 *   DESK_PET_DISABLE=1     完全停用（不转发、不拉起）
 *   DESK_PET_AUTOSTART=0   只转发，不自动拉起
 *   DESK_PET_CMD           自定义启动命令（整条命令行，经 shell 执行），例如 "node /path/to/lib/standalone.js"
 *   DESK_PET_HOME          数据目录（默认 ~/.desk-pet；也认 DSH_HOME），与桌宠进程保持一致
 *   DESK_PET_PORT          直接指定端口（不读 server.json）
 */
import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, statSync, truncateSync } from 'node:fs';
import { request } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK_PATH = '/claude-code/hook';
const POST_TIMEOUT_MS = 800;
const STDIN_TIMEOUT_MS = 1000;
const LOG_LIMIT_BYTES = 1024 * 1024;
/** 这两类事件发生时，桌宠没在跑就把它拉起来 */
const AUTOSTART_EVENTS = new Set(['SessionStart', 'UserPromptSubmit']);

const env = process.env;
const here = dirname(fileURLToPath(import.meta.url));
const home = env.DSH_HOME || env.DESK_PET_HOME || join(homedir(), '.desk-pet');

/** 读完 stdin（Claude Code 写完即关闭；兜底超时，防止被手动运行时挂住） */
function readStdin() {
  return new Promise((accept) => {
    const chunks = [];
    const timer = setTimeout(() => accept(Buffer.concat(chunks).toString('utf8')), STDIN_TIMEOUT_MS);
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => {
      clearTimeout(timer);
      accept(Buffer.concat(chunks).toString('utf8'));
    });
    process.stdin.on('error', () => {
      clearTimeout(timer);
      accept('');
    });
  });
}

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && error.code === 'EPERM';
  }
}

/** 桌宠服务在哪：显式端口 > server.json（且登记的进程还活着）；都没有 → null（= 没在跑） */
function serverPort() {
  const forced = Number(env.DESK_PET_PORT);
  if (Number.isInteger(forced) && forced > 0) return forced;
  try {
    const info = JSON.parse(readFileSync(join(home, 'server.json'), 'utf8'));
    if (isAlive(Number(info.pid)) && Number.isInteger(info.port) && info.port > 0) return info.port;
  } catch {
    /* 没有登记 = 没在跑 */
  }
  return null;
}

function post(port, body) {
  return new Promise((accept) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: HOOK_PATH,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
        timeout: POST_TIMEOUT_MS,
      },
      (res) => {
        res.resume();
        accept(res.statusCode === 200);
      },
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => accept(false));
    req.end(body);
  });
}

/** 启动命令：DESK_PET_CMD > 同仓库里构建好的 lib/standalone.js > PATH 上的 desk-pet */
function launchCommand() {
  if (env.DESK_PET_CMD) return { command: env.DESK_PET_CMD, args: [], shell: true };
  const sibling = resolve(here, '..', '..', 'dsh-pet', 'lib', 'standalone.js');
  if (existsSync(sibling)) return { command: process.execPath, args: [sibling], shell: false };
  return { command: 'desk-pet', args: [], shell: process.platform === 'win32' };
}

/** 后台拉起桌宠：脱离本进程（hook 结束后它继续活着），输出写进 ~/.desk-pet/desk-pet.log */
function launch() {
  const logFile = join(home, 'desk-pet.log');
  let out = 'ignore';
  try {
    if (existsSync(logFile) && statSync(logFile).size > LOG_LIMIT_BYTES) truncateSync(logFile, 0);
    out = openSync(logFile, 'a');
  } catch {
    /* 数据目录还不存在：桌宠首次启动会自己建，这一次不留日志 */
  }
  const { command, args, shell } = launchCommand();
  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: ['ignore', out, out],
      shell,
      windowsHide: true,
      env,
    });
    child.on('error', () => {});
    child.unref();
  } catch {
    /* 找不到命令：静默（排查看 README 的「没出现怎么办」） */
  }
  if (typeof out === 'number') closeSync(out);
}

async function main() {
  // 桌宠自己调 claude -p 生成碎碎念时会带这个变量：那不是用户的会话，别把它当成工作状态
  if (env.DESK_PET_INTERNAL === '1' || env.DESK_PET_DISABLE === '1') return;
  const raw = await readStdin();
  let event = '';
  try {
    event = String(JSON.parse(raw || '{}').hook_event_name || '');
  } catch {
    return;
  }
  const port = serverPort();
  if (port !== null && (await post(port, raw || '{}'))) return;
  if (AUTOSTART_EVENTS.has(event) && env.DESK_PET_AUTOSTART !== '0') launch();
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
