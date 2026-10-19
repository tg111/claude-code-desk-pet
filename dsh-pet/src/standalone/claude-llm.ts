/**
 * 用 Claude Code 自己（`claude -p`）给碎碎念 / 对话当模型后端 —— Claude Code 模式的 `ctx.llm`。
 *
 * 为什么走 CLI 而不是直连 API：桌宠跟着 Claude Code 用，用户已经在 Claude Code 里登录过
 * （订阅账号 / API key / Bedrock / Vertex 都由它管），再要一份 key 既多余又容易漏配。
 * `claude -p` 的打印模式恰好是「给一段输入、回一段文本」，与插件对 `llm.stream` 的用法吻合。
 *
 * 形状与 DSH 的 llm 服务一致（插件代码不知道后端换了）：
 *   - `stream(options)` 返回 **AsyncIterable**（见 `./context` 里那段 0.3.4 崩溃的注释），
 *     进程跑完后按 dsh-llm 的流协议吐出 `text-delta` + `finish` 两个块，由 BlockAssembler 收集；
 *     失败在首次 `next()` 时抛出，落进调用方已有的 try/catch，变成 `generate-error` 结构化失败。
 *   - `listProviders` / `listModels` 给设置页的下拉框一个「Claude Code + 别名」的清单。
 *
 * 不打扰用户的 Claude Code：
 *   - `--tools ""` 关掉全部工具、`--strict-mcp-config` 不拉起 MCP 服务、`--no-session-persistence`
 *     不往 /resume 列表里塞桌宠的闲聊；
 *   - `--settings {"disableAllHooks": true}` 让这次调用不触发任何 hook（否则用户自己的 Stop 提示音
 *     会跟着每句碎碎念响，桌宠也会看到"自己"的会话而切换工作状态）；
 *   - 再加 `DESK_PET_INTERNAL=1` 环境变量兜底：转发脚本见到它直接退出。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { StandaloneLogger } from './context';

/** 服务商 id（`agentDefaultModel.currentSelection()` 与设置页下拉框里看到的就是它） */
export const CLAUDE_CODE_PROVIDER = 'claude-code';

/** 默认模型：碎碎念只求随口一句，用最快的别名 */
export const DEFAULT_CLAUDE_MODEL = 'haiku';

/** 设置页可选的模型别名（交给 `claude --model`，别名由 Claude Code 解析到当前最新版本） */
const MODEL_ALIASES: Array<{ id: string; name: string }> = [
  { id: 'haiku', name: 'Haiku（快）' },
  { id: 'sonnet', name: 'Sonnet' },
  { id: 'opus', name: 'Opus' },
];

/** stderr 只留尾部（报错文案进气泡，太长没意义） */
const STDERR_TAIL = 400;

/** 吐给 BlockAssembler 的流块（dsh-llm 流协议的子集：正文增量 + 终止原因） */
export type ClaudeStreamChunk =
  { type: 'text-delta'; index: number; text: string } | { type: 'finish'; reason: { kind: 'completed' } };

/** 插件传给 `llm.stream` 的参数里本模块读取的部分 */
interface StreamOptions {
  model?: unknown;
  system?: unknown;
  messages?: unknown;
  signal?: AbortSignal;
}

interface MessageLike {
  role?: unknown;
  content?: unknown;
}

export interface ClaudeCliLlmOptions {
  /** `claude` 可执行文件（缺省读 DESK_PET_CLAUDE_BIN，再缺省 `claude`，走 PATH） */
  command?: string;
  /** 未指定模型时用的别名（缺省 {@link DEFAULT_CLAUDE_MODEL}） */
  model?: string;
  logger: StandaloneLogger;
  /** 测试注入：替换子进程启动（参数与 `child_process.spawn` 一致） */
  spawnImpl?: typeof spawn;
}

/** 消息内容 → 纯文本（插件只放 text 块；其余块类型忽略） */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      const b = block as { type?: unknown; text?: unknown } | null;
      return b?.type === 'text' && typeof b.text === 'string' ? b.text : '';
    })
    .join('');
}

/**
 * 把插件的多轮消息压成一段打印模式的输入：只有一条就原样给；有历史（对话记忆）就写成对话记录，
 * 最后一条是这次要回的话。打印模式没有原生的多轮输入，记录体是最稳的等价物。
 */
export function promptOf(messages: unknown): string {
  const list = (Array.isArray(messages) ? messages : []) as MessageLike[];
  const turns = list
    .map((m) => ({ role: m?.role === 'assistant' ? 'assistant' : 'user', text: contentText(m?.content).trim() }))
    .filter((m) => m.text);
  if (turns.length === 0) return '';
  const last = turns[turns.length - 1];
  if (turns.length === 1) return last.text;
  const history = turns
    .slice(0, -1)
    .map((m) => `${m.role === 'user' ? '主人' : '你'}：${m.text}`)
    .join('\n');
  return `以下是你和主人之前的对话记录：\n${history}\n\n主人现在说：\n${last.text}\n\n请直接给出你这一次的回复（只要回复本身）。`;
}

/** Windows 的 `claude` 是 .cmd 包装，必须经 shell 启动；那时参数要自己加引号 */
function quoteForCmd(arg: string): string {
  return `"${arg.replace(/"/g, '""')}"`;
}

/**
 * 建一个以 `claude -p` 为后端的 llm 服务替身（形状见文件头）。
 * @returns 交给 `createStandaloneContext({ llm })` 的对象，外加 `dispose` 清临时目录
 */
export function createClaudeCliLlm(options: ClaudeCliLlmOptions): Record<string, unknown> & { dispose(): void } {
  const command = options.command || process.env.DESK_PET_CLAUDE_BIN || 'claude';
  const fallbackModel = options.model || DEFAULT_CLAUDE_MODEL;
  const spawnImpl = options.spawnImpl ?? spawn;
  // 系统提示词与 settings 走文件：避开命令行长度与 Windows shell 的引号问题
  let workDir: string | undefined;
  const ensureWorkDir = (): string => {
    if (!workDir) {
      workDir = mkdtempSync(join(tmpdir(), 'desk-pet-'));
      writeFileSync(join(workDir, 'settings.json'), JSON.stringify({ disableAllHooks: true }), 'utf8');
    }
    return workDir;
  };
  let callNo = 0;

  const run = (opts: StreamOptions): Promise<string> =>
    new Promise<string>((accept, reject) => {
      const prompt = promptOf(opts.messages);
      if (!prompt) {
        reject(new Error('没有可发送的内容'));
        return;
      }
      const dir = ensureWorkDir();
      callNo += 1;
      const systemFile = join(dir, `system-${callNo}.txt`);
      writeFileSync(systemFile, typeof opts.system === 'string' ? opts.system : '', 'utf8');
      const model = typeof opts.model === 'string' && opts.model.trim() ? opts.model.trim() : fallbackModel;
      const args = [
        '-p',
        '--model',
        model,
        '--system-prompt-file',
        systemFile,
        '--tools',
        '',
        '--strict-mcp-config',
        '--no-session-persistence',
        '--settings',
        join(dir, 'settings.json'),
        '--output-format',
        'text',
      ];
      const useShell = process.platform === 'win32';
      const child = spawnImpl(useShell ? quoteForCmd(command) : command, useShell ? args.map(quoteForCmd) : args, {
        cwd: dir,
        env: { ...process.env, DESK_PET_INTERNAL: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: useShell,
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (error: Error | undefined, value?: string): void => {
        if (settled) return;
        settled = true;
        opts.signal?.removeEventListener('abort', onAbort);
        rmSync(systemFile, { force: true });
        if (error) reject(error);
        else accept(value ?? '');
      };
      const onAbort = (): void => {
        child.kill();
        finish(new Error('Claude Code 响应超时'));
      };
      if (opts.signal?.aborted) {
        onAbort();
        return;
      }
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr?.on('data', (chunk: string) => {
        stderr = (stderr + chunk).slice(-STDERR_TAIL * 4);
      });
      child.on('error', (error: NodeJS.ErrnoException) => {
        finish(
          new Error(
            error.code === 'ENOENT'
              ? `找不到 ${command} 命令（装好 Claude Code，或用 DESK_PET_CLAUDE_BIN 指定路径）`
              : error.message,
          ),
        );
      });
      child.on('close', (code) => {
        if (code === 0) {
          finish(undefined, stdout.trim());
          return;
        }
        const detail = stderr.trim().split('\n').pop()?.slice(-STDERR_TAIL) || stdout.trim().slice(-STDERR_TAIL);
        options.logger.warn(`claude -p 退出码 ${String(code)}：${detail || '（无输出）'}`);
        finish(new Error(detail ? `Claude Code：${detail}` : `Claude Code 退出码 ${String(code)}`));
      });
      child.stdin?.on('error', () => {
        /* 进程提前退出时写 stdin 会 EPIPE：错误由 close 分支报 */
      });
      child.stdin?.end(prompt, 'utf8');
    });

  return {
    listProviders: (): Array<{ id: string; name: string }> => [{ id: CLAUDE_CODE_PROVIDER, name: 'Claude Code' }],
    listModels: async (provider: string): Promise<Array<{ id: string; name: string }>> =>
      provider === CLAUDE_CODE_PROVIDER ? MODEL_ALIASES.map((m) => ({ ...m })) : [],
    /** 与 DSH 契约同为异步；不声明 reasoning 元数据 → 插件不传 reasoningEffort */
    resolveModelInfo: async (): Promise<undefined> => undefined,
    stream: (opts: StreamOptions): AsyncIterable<ClaudeStreamChunk> => ({
      [Symbol.asyncIterator](): AsyncIterator<ClaudeStreamChunk> {
        // 打印模式一次性给全文：跑完进程后依次吐出正文与终止块
        let pending: ClaudeStreamChunk[] | undefined;
        return {
          next: async (): Promise<IteratorResult<ClaudeStreamChunk>> => {
            if (!pending) {
              const text = await run(opts ?? {});
              pending = [
                { type: 'text-delta', index: 0, text },
                { type: 'finish', reason: { kind: 'completed' } },
              ];
            }
            const value = pending.shift();
            return value ? { done: false, value } : { done: true, value: undefined };
          },
        };
      },
    }),
    dispose(): void {
      if (workDir) rmSync(workDir, { recursive: true, force: true });
      workDir = undefined;
    },
  };
}
