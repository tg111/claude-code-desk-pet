/**
 * 端到端契约：伪 ctx + **真实 apply** + 真实 `node:http` 服务。
 *
 * 这一层回答"desk-pet 到底有没有把宿主半边跑起来"，并钉住三件事：
 *   1. `apply` 注册的路由前缀确实被服务接管 —— 只有一份路由表，没有第二套实现；
 *   2. Claude Code hook 经**真实 HTTP** 进来 → 翻译 → 事件总线 → 工作状态写进 `/state`（整条链路）；
 *   3. 路径安全与"配置不可达"的口径经真实 HTTP 仍然成立（服务不重写 URL、不吞异常）。
 *
 * 覆盖范围的限制与 `routes.test.ts` 相同：源码形态下包根解析成 `<pkg>/src`，
 * 包内 `assets/config.jsonc` 不可达 → `readAllConfig` 必抛。因此这里不断言"成品配置"，
 * 那条路径由构建产物（`lib/standalone.js`）的端到端验证覆盖（见 README 的独立运行一节）。
 *
 * 顺序上先监听、再 `apply` —— 与 CLI 完全一致：插件的 `launchHelper` 依赖
 * `ctx.webServer.port > 0`，端口为 0 时它只会 500ms 重试一次、永不拉起桌面窗口。
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { packageRoot } from '../host/helper-process.ts';
import { apply } from '../host/index.ts';
import { createStandaloneContext, type RegisteredRoute, type StandaloneLogger } from './context.ts';
import { CLAUDE_HOOK_PATH, createClaudeHookRoute } from './claude-code.ts';
import { listenStandaloneServer, type StandaloneServer } from './server.ts';

/** 静默日志器（插件仍会往 console 打少量 warn，那是它自己的诊断，这里不拦） */
const silent: StandaloneLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

let home = '';
let base = '';
let server: StandaloneServer | undefined;
let context: ReturnType<typeof createStandaloneContext> | undefined;
let savedHome: string | undefined;
let savedElectron: string | undefined;

before(async () => {
  home = mkdtempSync(join(tmpdir(), 'dsh-pet-standalone-'));
  savedHome = process.env.DSH_HOME;
  savedElectron = process.env.DSH_PET_ELECTRON_PATH;
  process.env.DSH_HOME = home;
  // 指向一个真实存在的可执行文件：万一走到拉起分支也不会真的下载 Electron
  process.env.DSH_PET_ELECTRON_PATH = process.execPath;

  const routes: RegisteredRoute[] = [];
  const portRef = { value: 0 };
  const created = createStandaloneContext({ port: () => portRef.value, logger: silent, routes });
  // 与 CLI 同一个顺序：hook 入口先于 apply 注册
  routes.push(createClaudeHookRoute(created.emit, silent));
  const listening = await listenStandaloneServer({
    routes,
    logger: silent,
    port: 0,
    // 与 CLI 同一个运维信息形状（这条断言顺带钉住 CLI 用的字段名）
    status: () => ({ name: 'dsh-pet-standalone', plugin: { root: packageRoot } }),
  });
  // 顺序与 CLI 完全一致：先监听拿到端口，再 apply —— 插件的 launchHelper 依赖 port > 0
  portRef.value = listening.port;
  apply(created.ctx);
  context = created;
  server = listening;
  base = `http://127.0.0.1:${listening.port}`;
});

after(async () => {
  // 释放 effect（停 Helper、清两条自续期轮询定时器）——不释放的话 node:test 跑完不退出
  await context?.dispose().catch(() => {});
  await context?.dispose().catch(() => {}); // 幂等：重复释放不得抛错
  await server?.close().catch(() => {});
  if (savedHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = savedHome;
  if (savedElectron === undefined) delete process.env.DSH_PET_ELECTRON_PATH;
  else process.env.DSH_PET_ELECTRON_PATH = savedElectron;
  rmSync(home, { recursive: true, force: true });
});

/** 取一条插件路由的响应 */
async function get(path: string): Promise<{ status: number; text: string; json: () => unknown }> {
  const response = await fetch(`${base}${path}`);
  const text = await response.text();
  return { status: response.status, text, json: () => JSON.parse(text) as unknown };
}

describe('插件宿主半边在独立模式下跑起来了', () => {
  test('apply 注册了插件自己的路由前缀（独立模式不自己写路由表）', () => {
    const routes = context?.routes ?? [];
    assert.equal(routes.length, 2, 'hook 入口 + 宿主的一条 prefix 路由；多出来的注册要在这里显式确认');
    assert.equal(routes[0]?.path, CLAUDE_HOOK_PATH);
    assert.equal(routes[1]?.kind, 'prefix');
    assert.equal(routes[1]?.path, '/dsh-pet-7340');
    assert.equal(typeof routes[1]?.handler, 'function');
  });

  test('/state 初始形状（还没有任何 hook 事件 → 叶子保持初始值）', async () => {
    const response = await get('/dsh-pet-7340/state');
    assert.equal(response.status, 200);
    const body = response.json() as {
      sections: Record<string, { counter: number; data: unknown }>;
      pets: Record<string, unknown>;
    };
    assert.deepEqual(Object.keys(body.sections).sort(), ['config', 'workStatus']);
    assert.equal(body.sections.workStatus?.counter, 0);
    assert.equal(body.sections.workStatus?.data, null);
    assert.equal(body.sections.config?.counter, 0, '配置变更信号也没人写过');
    assert.deepEqual(body.pets, {});
  });
});

describe('Claude Code hook → /state（整条链路）', () => {
  /** POST 一条 hook 载荷，返回响应 */
  const hook = async (payload: unknown): Promise<{ status: number; json: unknown }> => {
    const response = await fetch(`${base}${CLAUDE_HOOK_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { status: response.status, json: await response.json() };
  };
  const workStatus = async (): Promise<unknown> =>
    ((await get('/dsh-pet-7340/state')).json() as { sections: { workStatus: { data: unknown } } }).sections.workStatus
      .data;

  test('提交消息 → 思考；TodoWrite → 工作 + 任务文案；权限确认 → 等待；Stop → 成功', async () => {
    assert.deepEqual(await hook({ hook_event_name: 'UserPromptSubmit', session_id: 'it' }), {
      status: 200,
      json: { ok: true, events: 1 },
    });
    assert.deepEqual(await workStatus(), { state: 'thinking', task: null });
    await hook({
      hook_event_name: 'PreToolUse',
      session_id: 'it',
      tool_name: 'TodoWrite',
      tool_input: { todos: [{ content: '写集成测试', status: 'in_progress' }] },
    });
    assert.deepEqual(await workStatus(), { state: 'working', task: '写集成测试' });
    await hook({ hook_event_name: 'Notification', session_id: 'it', notification_type: 'permission_prompt' });
    assert.deepEqual(await workStatus(), { state: 'waiting', task: '写集成测试' });
    await hook({ hook_event_name: 'Stop', session_id: 'it' });
    assert.equal(((await workStatus()) as { state: string }).state, 'success');
    // 会话结束 → 回空闲（终态不等它自己过期）
    await hook({ hook_event_name: 'SessionEnd', session_id: 'it' });
    assert.deepEqual(await workStatus(), { state: null, task: null });
  });

  test('非 POST → 405；坏 JSON → 400（转发脚本出错也不会把服务带崩）', async () => {
    assert.equal((await get(CLAUDE_HOOK_PATH)).status, 405);
    const bad = await fetch(`${base}${CLAUDE_HOOK_PATH}`, { method: 'POST', body: '{not json' });
    assert.equal(bad.status, 400);
  });
});

describe('配置与素材不可达时的口径 —— 显式失败，不静默兜底', () => {
  test('包内默认配置读不到（源码形态）→ /config 500 + 错误正文', async () => {
    const response = await get('/dsh-pet-7340/config');
    assert.equal(response.status, 500, '读不到配置必须显式失败：静默返回空配置会让桌宠"看起来正常但什么都没有"');
    const body = response.json() as { error?: string };
    assert.equal(typeof body.error, 'string');
    assert.ok((body.error ?? '').length > 0, '错误正文必须可读');
  });

  test('thumb 的路由安全口径经真实 HTTP 仍然成立', async () => {
    // 反斜杠不被 URL 的 pathname 拆段，会作为 petId 直接进路径拼接 —— 必须 400
    assert.equal((await get('/dsh-pet-7340/thumb/..%5C..%5Coutside/leak.webm')).status, 400);
    // 扩展名白名单
    assert.equal((await get('/dsh-pet-7340/thumb/main/x.txt')).status, 400);
    // 不存在的素材（主素材链与独占目录都查不到）
    assert.equal((await get(`/dsh-pet-7340/thumb/main/${encodeURIComponent('不存在.webm')}`)).status, 404);
  });

  test('pic/memes 的素材根同样不得当路径片段', async () => {
    assert.equal((await get('/dsh-pet-7340/pic/memes/..%5C..%5Coutside-memes/leak.png')).status, 400);
    assert.equal((await get('/dsh-pet-7340/pic/memes/main/nope.png')).status, 404);
  });
});

describe('独立服务自己的端点', () => {
  test('/ 回报插件版本与端口（运维信息，带跨源头）', async () => {
    const response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    const body = (await response.json()) as { name: string; plugin: { root: string } };
    assert.equal(body.name, 'dsh-pet-standalone');
    assert.equal(body.plugin.root, packageRoot);
  });

  test('/shutdown 在没有收尾回调时也只回 200，不影响服务继续工作', async () => {
    const response = await fetch(`${base}/shutdown`, { method: 'POST' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, stopping: true });
    assert.equal((await get('/dsh-pet-7340/state')).status, 200, '测试里没人真的停机：服务应继续可用');
  });
});
