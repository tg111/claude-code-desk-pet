/**
 * Claude Code hook → 插件会话事件的翻译层（纯逻辑 + 一条路由，零业务分支）。
 *
 * 为什么是「翻译」而不是直接在这里算档位：宿主半边（`host/work-status.ts`）只认一种
 * `session/event` 形状，并带着会话聚合、终态过期、任务详情文案这些细节。这里只把 hook 载荷
 * 改写成那种形状，经伪 ctx 的事件总线（`./context` 的 `emit`）投进去，聚合逻辑只有一份。
 *
 * 对应关系（左 = Claude Code hook_event_name，右 = 插件消费的 session/event）：
 *   UserPromptSubmit                  → turn/start                 思考
 *   PreToolUse                        → tool/call                  工作
 *     · AskUserQuestion               → tool/call ask_user_question 等待（选择题）
 *     · TodoWrite                     → todo/write + tool/call     任务详情文案
 *   PostToolUse / PostToolUseFailure  → tool/result                整理
 *   Notification permission_prompt    → approval/asked             等待（权限确认）
 *   Notification elicitation_dialog   → approval/asked             等待（MCP 征询）
 *   Notification idle_prompt          → turn/end aborted           回空闲（等你输入了）
 *   Stop                              → turn/end completed         成功
 *   StopFailure                       → turn/end error             出错
 *   SessionEnd                        → turn/end aborted           回空闲
 * 其余（SessionStart / SubagentStop / PreCompact …）不切动画：SessionStart 只用来拉起本服务
 * （见插件的 hook 转发脚本），子代理的工具调用照常走 PreToolUse，父对话的回合由 Stop 收尾。
 *
 * 子代理的工具调用同样带父对话的 session_id，照常记成「工作」—— 父对话确实还在干活。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { RegisteredRoute, StandaloneLogger } from './context';

/** hook 转发脚本 POST 的路径（不在插件路由前缀下：它是 Claude Code 模式自己的入口） */
export const CLAUDE_HOOK_PATH = '/claude-code/hook';

/** 单条 hook 载荷的大小上限：tool_input / tool_response 可能很大（整份文件内容），只读够用的部分 */
const MAX_BODY_BYTES = 1024 * 1024;

/** 序列化后的工具参数上限（没必要把整份文件内容搬进事件） */
const MAX_ARGUMENTS_CHARS = 64 * 1024;

/** 宿主里的「问用户选择题」工具名（`host/work-status.ts` 按它判 waiting） */
const USER_QUESTION_TOOL = 'ask_user_question';

/** Claude Code hook 载荷里本模块读取的字段（其余原样忽略；全部宽松读取） */
export interface ClaudeHookPayload {
  hook_event_name?: unknown;
  session_id?: unknown;
  tool_name?: unknown;
  tool_input?: unknown;
  notification_type?: unknown;
  message?: unknown;
  error?: unknown;
  error_details?: unknown;
  [key: string]: unknown;
}

/** 插件 `ctx.on('session/event', (session, event) => …)` 的两个实参 */
export interface TranslatedSessionEvent {
  session: { id: string; header: { id: string } };
  event: { type: string; seq: number; data?: Record<string, unknown> };
}

/** 序号源：同一会话同档位按 seq 取最近（`WorkStatusStore.setState`），必须严格递增 */
let lastSeq = 0;
function nextSeq(): number {
  lastSeq = Math.max(lastSeq + 1, Date.now());
  return lastSeq;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** 工具参数 → JSON 字符串（事件里的 arguments 是原始 JSON 串）；过大则截成空对象 */
function argumentsOf(input: unknown): string {
  try {
    const json = JSON.stringify(input ?? {});
    return json.length > MAX_ARGUMENTS_CHARS ? '{}' : json;
  } catch {
    return '{}';
  }
}

/** Notification 的类型：新版带 notification_type；旧版只有 message，按文案兜底判权限申请 */
function notificationKind(payload: ClaudeHookPayload): string {
  const kind = text(payload.notification_type);
  if (kind) return kind;
  const message = text(payload.message).toLowerCase();
  if (message.includes('permission')) return 'permission_prompt';
  if (message.includes('waiting for your input')) return 'idle_prompt';
  return '';
}

/**
 * 翻译一条 hook 载荷。
 * @param payload Claude Code 写进 hook 命令 stdin 的 JSON（转发脚本原样 POST 过来）
 * @returns 要依次投递的 session/event（空数组 = 不关心这类 hook）
 */
export function translateClaudeHook(payload: ClaudeHookPayload): TranslatedSessionEvent[] {
  if (!payload || typeof payload !== 'object') return [];
  const name = text(payload.hook_event_name);
  const sessionId = text(payload.session_id) || 'claude-code';
  const session = { id: sessionId, header: { id: sessionId } };
  const out: TranslatedSessionEvent[] = [];
  const push = (type: string, data?: Record<string, unknown>): void => {
    out.push({ session, event: { type, seq: nextSeq(), ...(data ? { data } : {}) } });
  };
  const turnEnd = (kind: string, message?: string): void => {
    push('turn/end', { reason: message ? { kind, error: { message } } : { kind } });
  };

  switch (name) {
    case 'UserPromptSubmit':
      push('turn/start');
      break;
    case 'PreToolUse': {
      const tool = text(payload.tool_name);
      if (!tool) break;
      if (tool === 'TodoWrite') {
        const todos = (payload.tool_input as { todos?: unknown } | null)?.todos;
        if (Array.isArray(todos)) push('todo/write', { todos });
      }
      push('tool/call', {
        name: tool === 'AskUserQuestion' ? USER_QUESTION_TOOL : tool,
        arguments: argumentsOf(payload.tool_input),
      });
      break;
    }
    case 'PostToolUse':
    case 'PostToolUseFailure':
      push('tool/result', { name: text(payload.tool_name) });
      break;
    case 'Notification': {
      const kind = notificationKind(payload);
      if (kind === 'permission_prompt' || kind === 'elicitation_dialog') {
        push('approval/asked', {
          ...(text(payload.tool_name) ? { toolName: text(payload.tool_name) } : {}),
          ...(text(payload.message) ? { reason: text(payload.message) } : {}),
        });
      } else if (kind === 'idle_prompt') {
        // 等你输入了 = 这一轮早就结束：清掉会话（被 Esc 打断的回合没有 Stop，靠这里兜底回空闲）
        turnEnd('aborted');
      }
      break;
    }
    case 'Stop':
      turnEnd('completed');
      break;
    case 'StopFailure':
      // error 是错误类别（rate_limit 等），error_details 是可读说明：气泡/通知优先用后者
      turnEnd('error', text(payload.error_details) || text(payload.error) || undefined);
      break;
    case 'SessionEnd':
      turnEnd('aborted');
      break;
    default:
      break;
  }
  return out;
}

/** 读请求体（超过上限即停：hook 载荷只要前面的字段，宁可解析失败也不吃下整份大文件） */
function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((accept, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        accept(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function reply(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * 建 hook 接收路由：`POST /claude-code/hook`，body = hook 载荷。
 * 永远尽快应答（转发脚本只等很短的时间，Claude Code 不该被桌宠拖慢）；翻译结果经 `emit` 投递。
 * @param emit 伪 ctx 的事件投递函数
 * @param logger 日志器（debug 级记录每条 hook，排查"宠物没反应"时打开 DSH_PET_STANDALONE_DEBUG=1）
 */
export function createClaudeHookRoute(
  emit: (name: string, ...args: unknown[]) => void,
  logger: StandaloneLogger,
): RegisteredRoute {
  return {
    kind: 'exact',
    path: CLAUDE_HOOK_PATH,
    handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (req.method !== 'POST') {
        reply(res, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      let payload: unknown;
      try {
        payload = await readJson(req);
      } catch (error) {
        reply(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
        return;
      }
      const events = translateClaudeHook(payload as ClaudeHookPayload);
      logger.debug(
        `hook ${text((payload as ClaudeHookPayload)?.hook_event_name) || '?'} → ${events.map((e) => e.event.type).join(', ') || '（忽略）'}`,
      );
      for (const { session, event } of events) emit('session/event', session, event);
      reply(res, 200, { ok: true, events: events.length });
    },
  };
}
