/**
 * 右键「打开 Claude Code」契约测试（跨进程：宿主 → Electron 主进程 → 渲染端菜单）。
 *
 * 钉住三件事（两半各自构建、无法互相 import，只能读源码断言）：
 *   ① 菜单项文案与动作名：渲染端菜单是「打开 Claude Code」，动作仍叫 open-site（共享菜单契约认它）；
 *   ② 去向由**主进程**决定：只认 DESK_PET_OPEN_URL（且必须是 http/https），缺省 https://claude.ai/code；
 *      渲染端只发一个不带参数的 IPC，页面无权决定打开哪里；
 *   ③ 原版的分派逻辑（唤起外部桌面应用的自定义协议、带启动令牌的站点 URL）不得复活。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** 包内文件源码（守卫用；相对 src/host/ 解析） */
const readSource = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const host = readSource('./index.ts');
const main = readSource('../../runtime/electron-helper/main.js');
const preload = readSource('../../runtime/electron-helper/preload.js');
const sprite = readSource('../../runtime/electron-helper/sprite.js');

describe('右键「打开 Claude Code」', () => {
  test('渲染端：菜单文案固定，动作名仍是 open-site，经 preload 发不带参数的 IPC', () => {
    assert.ok(/\{ label: '打开 Claude Code', action: 'open-site' \}/.test(sprite));
    assert.ok(/leaf\.action === 'open-site'\) \{[\s\S]*?petBridge\.openClaudeCode\(\)/.test(sprite));
    assert.ok(/openClaudeCode\(\) \{\s*ipcRenderer\.send\('pet:open-claude'\);/.test(preload));
  });

  test('主进程：去向只认 DESK_PET_OPEN_URL（http/https），缺省 claude.ai/code', () => {
    assert.ok(/const CLAUDE_OPEN_URL = \/\^https\?:\[\/\]\[\/\]\/\.test\(process\.env\.DESK_PET_OPEN_URL/.test(main));
    assert.ok(/: 'https:\/\/claude\.ai\/code';/.test(main));
    assert.ok(/ipcMain\.on\('pet:open-claude', \(\) => \{\s*shell\.openExternal\(CLAUDE_OPEN_URL\)/.test(main));
  });

  test('原版的分派逻辑不得复活', () => {
    assert.ok(!/shell\.openExternal\('[a-z]+:\/\/open'\)/.test(main), '不得再用自定义协议唤起别的桌面应用');
    assert.ok(!/_SITE_URL|_OPEN_TARGET/.test(main + host), '不得再注入站点令牌 / 宿主形态');
    assert.ok(!/isDesktopHost|authenticatedUrl/.test(host));
  });

  test('托盘总有「退出桌宠」（桌宠由 hook 在后台拉起，没有终端可按 Ctrl+C）', () => {
    assert.ok(/items\.push\(\{ label: '退出桌宠', click: \(\) => trayQuitHost\(\) \}\)/.test(main));
  });
});
