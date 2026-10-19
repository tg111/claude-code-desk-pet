/**
 * Claude Code 模式的单实例与「服务在哪」登记。
 *
 * 为什么需要：桌宠由 hook 转发脚本在 SessionStart 时自动拉起，而用户常常同时开好几个
 * Claude Code 会话 —— 每个会话都会尝试拉一次。只能有一个桌宠进程：锁文件挡住后来者，
 * `server.json` 告诉转发脚本该往哪个端口发 hook（首选端口被占用时服务会顺延到别的端口）。
 *
 * 两个文件都在 DESK_PET_HOME（Claude Code 模式默认 `~/.desk-pet`）下：
 *   - `desk-pet.lock`  内容 = 持锁进程 pid；进程已不在（崩溃 / 被杀）的锁视为过期，自动接管
 *   - `server.json`      `{ pid, port, version, startedAt }`，正常退出时删除
 */
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';

export const LOCK_FILE = 'desk-pet.lock';
export const SERVER_INFO_FILE = 'server.json';

/** 本机 `server.json` 的内容（转发脚本只读 port） */
export interface ServerInfo {
  pid: number;
  port: number;
  version: string;
  startedAt: string;
}

/** 进程是否还在（EPERM = 在但不归我们管，也算在） */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readPid(file: string): number {
  try {
    return Number.parseInt(readFileSync(file, 'utf8').trim(), 10);
  } catch {
    return Number.NaN;
  }
}

/**
 * 抢单实例锁。
 * @param home 数据目录
 * @returns `{ release }` = 抢到了；`{ runningPid }` = 已有活着的实例
 */
export function acquireInstanceLock(home: string): { release(): void } | { runningPid: number } {
  mkdirSync(home, { recursive: true });
  const file = join(home, LOCK_FILE);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(file, 'wx');
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return {
        release: (): void => {
          // 只删自己的锁：万一被别的实例接管过（不该发生），不替它删
          if (readPid(file) === process.pid) rmSync(file, { force: true });
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const pid = readPid(file);
      if (pid !== process.pid && isProcessAlive(pid)) return { runningPid: pid };
      rmSync(file, { force: true }); // 过期锁：持有者已不在
    }
  }
  throw new Error(`无法获取单实例锁：${file}`);
}

/** 写 `server.json`（转发脚本据此找到端口） */
export function writeServerInfo(home: string, info: ServerInfo): void {
  writeFileSync(join(home, SERVER_INFO_FILE), JSON.stringify(info, null, 2) + '\n', 'utf8');
}

/** 删 `server.json`（只删自己写的那份） */
export function removeServerInfo(home: string): void {
  const file = join(home, SERVER_INFO_FILE);
  try {
    const info = JSON.parse(readFileSync(file, 'utf8')) as Partial<ServerInfo>;
    if (info.pid !== process.pid) return;
  } catch {
    return;
  }
  rmSync(file, { force: true });
}

/** 旧版数据目录里多套的一层子目录名（配置 / 记忆 / 素材曾放在 `<数据目录>/dsh-pet/` 下） */
export const LEGACY_DATA_SUBDIR = 'dsh-pet';

/**
 * 一次性迁移：把 `<数据目录>/dsh-pet/` 里的东西挪到 `<数据目录>/` 下（同名已存在的不动，留给用户自己处理）。
 * 挪空了就把旧目录删掉。失败不影响启动——只是继续用新位置（旧文件原地不动）。
 * @returns 实际挪动的条目名
 */
export function migrateLegacyDataDir(home: string, warn: (message: string) => void): string[] {
  const legacy = join(home, LEGACY_DATA_SUBDIR);
  if (!existsSync(legacy)) return [];
  const moved: string[] = [];
  try {
    for (const name of readdirSync(legacy)) {
      const target = join(home, name);
      if (existsSync(target)) {
        warn(`旧数据 ${join(legacy, name)} 未迁移：${target} 已存在（请手动合并）`);
        continue;
      }
      renameSync(join(legacy, name), target);
      moved.push(name);
    }
    if (readdirSync(legacy).length === 0) rmdirSync(legacy);
  } catch (error) {
    warn(`迁移旧数据目录失败：${error instanceof Error ? error.message : String(error)}`);
  }
  return moved;
}
