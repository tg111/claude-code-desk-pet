#!/usr/bin/env node
/**
 * prepare.js —— 构建完整产物 + 收敛 files
 *
 * 做什么：
 *   1. 构建（npm run bundle：tsdown 把 src/standalone/cli.ts → lib/standalone.js）
 *   2. 构建桌面共享核心（npm run build:desktop-core：src/shared → runtime/electron-helper/shared-core.js）
 *   3. 改写 package.json：files 收敛为固定清单 —— 幂等：跑一次即定格，再跑结果不变
 *
 * 用法：node scripts/prepare.js（npm run build；npm pack 经 prepack 自动执行）
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PKG = join(ROOT, 'package.json');

// 1. 构建 src → lib
// Windows 下 npm 是 npm.cmd，spawnSync 无法直接执行 .cmd；用 cmd /c 跑整条命令
// （固定命令行，无用户输入，无注入风险）
console.log('[prepare] building (tsdown)...');
const npmRun = process.platform === 'win32' ? 'cmd /c npm run bundle' : 'npm run bundle';
const build = spawnSync(npmRun, { cwd: ROOT, stdio: 'inherit', shell: true });
if (build.status !== 0) {
  console.error(`[prepare] 构建失败 (exit ${build.status})`);
  process.exit(1);
}

// 1.5 构建桌面共享核心（src/shared → window.PetShared 经典 script；与浏览器 bundle 同一份源码）
console.log('[prepare] building desktop shared-core...');
const coreRun = process.platform === 'win32' ? 'cmd /c npm run build:desktop-core' : 'npm run build:desktop-core';
const buildCore = spawnSync(coreRun, { cwd: ROOT, stdio: 'inherit', shell: true });
if (buildCore.status !== 0) {
  console.error(`[prepare] 桌面 shared-core 构建失败 (exit ${buildCore.status})`);
  process.exit(1);
}

// 2. 改写 package.json：files 收敛为发布清单（幂等，无备份）
const pkg = JSON.parse(readFileSync(PKG, 'utf8'));
const keep = [
  'lib',
  'src',
  'assets/webm',
  'runtime/electron-helper',
  'assets/fonts',
  'assets/pic',
  // 表情包（碎碎念/对话配图的图片）：host 只从**包内** assets/memes 读图、与配置 memes 键配对，
  // 漏掉它 → 包内一张图都没有、配图功能整体失效。注意本函数每次发布（npm install/publish）都会
  // 用这个数组**覆盖** package.json 的 files，所以"只在 package.json 里加一行"是无效的，必须加在这里
  'assets/memes',
  'assets/config.jsonc',
  // 托盘图标（runtime/electron-helper/main.js 的 trayIcon 读它）
  'assets/logo.png',
  'scripts/ensure-electron.mjs',
];
writeFileSync(PKG, JSON.stringify({ ...pkg, files: keep }, null, 2) + '\n', 'utf8');
console.log(`[prepare] ✓ package.json files=[${keep.join(', ')}]`);
console.log('[prepare] ready: desk-pet（npm link 或 node lib/standalone.js）');
