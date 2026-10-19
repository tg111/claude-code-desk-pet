/**
 * Claude Code 接入的契约测试：hook 翻译、事件总线、`claude -p` 后端、单实例锁。
 *
 * 翻译层的价值全在「翻出来的事件与宿主认的形状一致」——所以这里不只断言事件类型，还把翻译结果
 * 直接喂给宿主自己的 `reduceWorkStatus` / `currentTaskFromTodo`，
 * 钉住"Claude Code 的哪个 hook 最终落到哪一档动画"。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { generateWhisper } from '../host/whisper.ts';
import { currentTaskFromTodo, reduceWorkStatus } from '../host/work-status.ts';
import { translateClaudeHook } from './claude-code.ts';
import type { ClaudeHookPayload } from './claude-code.ts';
import { CLAUDE_CODE_PROVIDER, createClaudeCliLlm, promptOf } from './claude-llm.ts';
import { createStandaloneContext } from './context.ts';
import type { StandaloneLogger } from './context.ts';
import { acquireInstanceLock, LOCK_FILE, removeServerInfo, SERVER_INFO_FILE, writeServerInfo } from './instance.ts';
import { claudePetHome } from './options.ts';

const silent: StandaloneLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

/** 一条 hook 最终落到的工作状态档位（取翻译结果里最后一个能切档的事件） */
function stateOf(payload: ClaudeHookPayload): string | null {
  let state: string | null = null;
  for (const { event } of translateClaudeHook(payload)) {
    state = reduceWorkStatus(event as never) ?? state;
  }
  return state;
}

describe('translateClaudeHook —— hook 落到哪一档', () => {
  test('一轮完整对话：思考 → 工作 → 整理 → 等待 → 成功', () => {
    assert.equal(stateOf({ hook_event_name: 'UserPromptSubmit', session_id: 's' }), 'thinking');
    assert.equal(stateOf({ hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'Bash' }), 'working');
    assert.equal(stateOf({ hook_event_name: 'PostToolUse', session_id: 's', tool_name: 'Bash' }), 'result');
    assert.equal(stateOf({ hook_event_name: 'PostToolUseFailure', session_id: 's', tool_name: 'Bash' }), 'result');
    assert.equal(
      stateOf({ hook_event_name: 'Notification', session_id: 's', notification_type: 'permission_prompt' }),
      'waiting',
    );
    assert.equal(stateOf({ hook_event_name: 'Stop', session_id: 's' }), 'success');
    assert.equal(stateOf({ hook_event_name: 'StopFailure', session_id: 's', error: 'rate_limit' }), 'error');
  });

  test('AskUserQuestion = 等你选：改名成宿主认的 ask_user_question，参数原样序列化', () => {
    const payload = {
      hook_event_name: 'PreToolUse',
      session_id: 's',
      tool_name: 'AskUserQuestion',
      tool_input: { questions: [{ question: '用哪个方案？', options: [] }] },
    };
    assert.equal(stateOf(payload), 'waiting');
    const [only] = translateClaudeHook(payload);
    assert.equal(only.event.data?.name, 'ask_user_question');
    assert.deepEqual(JSON.parse(String(only.event.data?.arguments)), payload.tool_input);
  });

  test('超大的工具参数不搬进事件（截成空对象）', () => {
    const [only] = translateClaudeHook({
      hook_event_name: 'PreToolUse',
      session_id: 's',
      tool_name: 'Write',
      tool_input: { content: 'x'.repeat(200 * 1024) },
    });
    assert.equal(only.event.data?.arguments, '{}');
  });

  test('TodoWrite 先写任务详情（取最后一个 in_progress），再算一次工作', () => {
    const events = translateClaudeHook({
      hook_event_name: 'PreToolUse',
      session_id: 's',
      tool_name: 'TodoWrite',
      tool_input: {
        todos: [
          { content: '读代码', status: 'completed' },
          { content: '接 hook', status: 'in_progress' },
        ],
      },
    });
    assert.deepEqual(
      events.map((e) => e.event.type),
      ['todo/write', 'tool/call'],
    );
    assert.equal(currentTaskFromTodo(events[0].event as never), '接 hook');
  });

  test('等你输入 / 会话结束 → turn/end aborted（插件据此清会话回空闲，不卡在上一档）', () => {
    for (const payload of [
      { hook_event_name: 'Notification', notification_type: 'idle_prompt' },
      { hook_event_name: 'SessionEnd', reason: 'exit' },
    ]) {
      const [only] = translateClaudeHook(payload);
      assert.equal(only.event.type, 'turn/end');
      assert.deepEqual(only.event.data, { reason: { kind: 'aborted' } });
      assert.equal(reduceWorkStatus(only.event as never), null);
    }
  });

  test('旧版 Notification 没有 notification_type：按文案兜底', () => {
    assert.equal(
      stateOf({ hook_event_name: 'Notification', message: 'Claude needs your permission to use Bash' }),
      'waiting',
    );
  });

  test('不关心的 hook 不产生事件；session_id 缺失时有稳定兜底', () => {
    assert.deepEqual(translateClaudeHook({ hook_event_name: 'SessionStart' }), []);
    assert.deepEqual(translateClaudeHook({ hook_event_name: 'SubagentStop' }), []);
    assert.deepEqual(translateClaudeHook(null as never), []);
    const [only] = translateClaudeHook({ hook_event_name: 'Stop' });
    assert.equal(only.session.id, 'claude-code');
  });

  test('子代理的工具调用（带 agent_id）照常记成父对话在工作', () => {
    assert.equal(
      stateOf({ hook_event_name: 'PreToolUse', session_id: 's', agent_id: 'a1', tool_name: 'Read' }),
      'working',
    );
  });

  test('seq 严格递增（插件同档位按 seq 取最近）', () => {
    const a = translateClaudeHook({ hook_event_name: 'UserPromptSubmit', session_id: 's' })[0].event.seq;
    const b = translateClaudeHook({ hook_event_name: 'UserPromptSubmit', session_id: 's' })[0].event.seq;
    assert.ok(b > a);
  });
});

describe('伪 ctx 的事件总线', () => {
  test('on 订阅、emit 投递、释放后不再收到；单个订阅者抛错不影响其他订阅者', () => {
    const context = createStandaloneContext({ port: 1, logger: silent });
    const on = context.ctx.on as (name: string, fn: (...args: unknown[]) => void) => () => void;
    const got: unknown[] = [];
    on('session/event', () => {
      throw new Error('boom');
    });
    const off = on('session/event', (session, event) => got.push([session, event]));
    context.emit('session/event', 'S', 'E');
    context.emit('other', 'x');
    assert.deepEqual(got, [['S', 'E']]);
    off();
    context.emit('session/event', 'S2', 'E2');
    assert.equal(got.length, 1);
  });

  test('注入 model / llm 后：模型候选链非空、生成走注入的 llm', async () => {
    const llm = {
      stream: () => ({
        async *[Symbol.asyncIterator]() {
          yield { type: 'text-delta', index: 0, text: '摸鱼时间到～' };
          yield { type: 'finish', reason: { kind: 'completed' } };
        },
      }),
      resolveModelInfo: async () => undefined,
    };
    const context = createStandaloneContext({
      port: 1,
      logger: silent,
      llm,
      model: { provider: CLAUDE_CODE_PROVIDER, model: 'haiku' },
    });
    assert.deepEqual(await generateWhisper(context.ctx as never, '人设'), { ok: true, text: '摸鱼时间到～' });
  });
});

/** 假子进程：记录参数与 stdin，按脚本回 stdout / 退出码 */
function fakeSpawn(reply: { stdout?: string; stderr?: string; code?: number; error?: NodeJS.ErrnoException }) {
  const calls: Array<{ command: string; args: string[]; env: Record<string, string>; stdin: string }> = [];
  const impl = ((command: string, args: string[], opts: { env: Record<string, string> }) => {
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
    const stdout = new EventEmitter() as EventEmitter & { setEncoding(): void };
    const stderr = new EventEmitter() as EventEmitter & { setEncoding(): void };
    stdout.setEncoding = () => {};
    stderr.setEncoding = () => {};
    const call = { command, args, env: opts.env, stdin: '' };
    calls.push(call);
    child.stdout = stdout;
    child.stderr = stderr;
    child.kill = () => true;
    child.stdin = Object.assign(new EventEmitter(), {
      end: (text: string) => {
        call.stdin = text;
        setImmediate(() => {
          if (reply.error) {
            child.emit('error', reply.error);
            return;
          }
          if (reply.stdout) stdout.emit('data', reply.stdout);
          if (reply.stderr) stderr.emit('data', reply.stderr);
          child.emit('close', reply.code ?? 0);
        });
      },
    });
    return child;
  }) as never;
  return { calls, impl };
}

/** 按插件的流协议收正文：只拼 text-delta，并确认流以 finish 收尾 */
async function collect(stream: AsyncIterable<{ type: string; text?: string }>): Promise<string> {
  let out = '';
  let last = '';
  for await (const chunk of stream) {
    if (chunk.type === 'text-delta') out += chunk.text ?? '';
    last = chunk.type;
  }
  assert.equal(last, 'finish');
  return out;
}

describe('createClaudeCliLlm —— claude -p 后端', () => {
  const messages = [{ role: 'user', content: [{ type: 'text', text: '说句话' }] }];

  test('参数：打印模式、关工具、关 hook、不留会话；标记 DESK_PET_INTERNAL；提示词走 stdin', async () => {
    const { calls, impl } = fakeSpawn({ stdout: '  今天也要加油哦  \n' });
    const llm = createClaudeCliLlm({ command: 'claude', logger: silent, spawnImpl: impl });
    try {
      const stream = (llm.stream as (o: unknown) => AsyncIterable<{ type: string; text?: string }>)({
        model: 'sonnet',
        system: '你是桌宠',
        messages,
      });
      assert.equal(await collect(stream), '今天也要加油哦');
      const [call] = calls;
      if (process.platform !== 'win32') {
        assert.equal(call.command, 'claude');
        assert.deepEqual(call.args.slice(0, 3), ['-p', '--model', 'sonnet']);
        assert.equal(call.args[call.args.indexOf('--tools') + 1], '');
        assert.ok(call.args.includes('--no-session-persistence'));
        assert.ok(call.args.includes('--strict-mcp-config'));
        const settings = call.args[call.args.indexOf('--settings') + 1];
        assert.deepEqual(JSON.parse(readFileSync(settings, 'utf8')), { disableAllHooks: true });
      }
      assert.equal(call.env.DESK_PET_INTERNAL, '1');
      assert.equal(call.stdin, '说句话');
    } finally {
      llm.dispose();
    }
  });

  test('没给模型 → 用默认别名', async () => {
    const { calls, impl } = fakeSpawn({ stdout: 'ok' });
    const llm = createClaudeCliLlm({ model: 'haiku', logger: silent, spawnImpl: impl });
    try {
      await collect((llm.stream as (o: unknown) => AsyncIterable<{ type: string; text?: string }>)({ messages }));
      assert.ok(calls[0].args.join(' ').includes('--model haiku'));
    } finally {
      llm.dispose();
    }
  });

  test('失败在迭代时抛出（插件的 try/catch 能接住）：非零退出码带 stderr 尾行、找不到命令给可操作提示', async () => {
    const failing = fakeSpawn({ stderr: 'warming up\nInvalid API key', code: 1 });
    const llm = createClaudeCliLlm({ logger: silent, spawnImpl: failing.impl });
    const missing = fakeSpawn({ error: Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }) });
    const llm2 = createClaudeCliLlm({ command: 'claude', logger: silent, spawnImpl: missing.impl });
    try {
      const run = (l: typeof llm) =>
        collect((l.stream as (o: unknown) => AsyncIterable<{ type: string; text?: string }>)({ messages }));
      await assert.rejects(run(llm), /Invalid API key/);
      await assert.rejects(run(llm2), /找不到 claude 命令/);
    } finally {
      llm.dispose();
      llm2.dispose();
    }
  });

  test('清单：只有 Claude Code 一个服务商，模型是别名', async () => {
    const llm = createClaudeCliLlm({ logger: silent });
    const providers = (llm.listProviders as () => Array<{ id: string }>)();
    assert.deepEqual(
      providers.map((p) => p.id),
      [CLAUDE_CODE_PROVIDER],
    );
    const models = await (llm.listModels as (p: string) => Promise<Array<{ id: string }>>)(CLAUDE_CODE_PROVIDER);
    assert.deepEqual(
      models.map((m) => m.id),
      ['haiku', 'sonnet', 'opus'],
    );
    assert.deepEqual(await (llm.listModels as (p: string) => Promise<unknown[]>)('deepseek'), []);
  });
});

describe('promptOf —— 多轮消息压成一段输入', () => {
  test('单条原样；有历史则写成对话记录，最后一条是要回的话', () => {
    assert.equal(promptOf([{ role: 'user', content: [{ type: 'text', text: '在吗' }] }]), '在吗');
    const prompt = promptOf([
      { role: 'user', content: [{ type: 'text', text: '早' }] },
      { role: 'assistant', content: [{ type: 'text', text: '早呀主人' }] },
      { role: 'user', content: [{ type: 'text', text: '今天写什么' }] },
    ]);
    assert.match(prompt, /主人：早\n你：早呀主人/);
    assert.match(prompt, /主人现在说：\n今天写什么/);
    assert.equal(promptOf([]), '');
  });
});

describe('单实例锁与 server.json', () => {
  test('第二次抢锁拿到持有者 pid；释放后可再抢；过期锁（进程已不在）自动接管', () => {
    const home = mkdtempSync(join(tmpdir(), 'desk-pet-lock-'));
    try {
      const first = acquireInstanceLock(home);
      assert.ok('release' in first);
      // 锁被另一个活着的进程（这里借父进程 pid）持有 → 不接管，报出它的 pid
      writeFileSync(join(home, LOCK_FILE), String(process.ppid));
      const second = acquireInstanceLock(home);
      assert.deepEqual(second, { runningPid: process.ppid });
      writeFileSync(join(home, LOCK_FILE), '999999999');
      const third = acquireInstanceLock(home);
      assert.ok('release' in third, '持有者已不在：锁视为过期');
      third.release();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('server.json 只删自己写的那份', () => {
    const home = mkdtempSync(join(tmpdir(), 'desk-pet-info-'));
    try {
      writeServerInfo(home, { pid: process.pid, port: 3080, version: 'x', startedAt: 'now' });
      removeServerInfo(home);
      assert.throws(() => readFileSync(join(home, SERVER_INFO_FILE)));
      writeServerInfo(home, { pid: 1, port: 3080, version: 'x', startedAt: 'now' });
      removeServerInfo(home);
      assert.ok(readFileSync(join(home, SERVER_INFO_FILE), 'utf8').includes('"pid": 1'));
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('数据目录：DSH_HOME > DESK_PET_HOME > ~/.desk-pet', () => {
    assert.equal(claudePetHome({ DSH_HOME: '/a', DESK_PET_HOME: '/b' }, '/h'), '/a');
    assert.equal(claudePetHome({ DESK_PET_HOME: '/b' }, '/h'), '/b');
    assert.equal(claudePetHome({}, '/h'), join('/h', '.desk-pet'));
  });
});
