/**
 * 碎碎念 / 对话用到的消息构造与流式文本拼装（host 半侧，零依赖）。
 *
 * 形状沿用插件对 `ctx.llm.stream` 的约定（`../standalone/claude-llm` 实现它）：
 *   - 请求里的 messages = `{ role, content: [{ type: 'text', text }], source }`；
 *   - 流里的块 = `text-delta`（正文增量）+ `finish`（终止原因），由 {@link BlockAssembler} 收集。
 */

/** 一条消息（角色 + 内容块 + 来源标记） */
export interface LlmMessage {
  role: 'user' | 'assistant';
  content: unknown;
  source: unknown;
}

/** 用户消息（`whisper.ts` / `chat.ts` 的入参形状） */
export function createUserMessage(input: { content: unknown; source: unknown }): LlmMessage {
  return { role: 'user', content: input.content, source: input.source };
}

/** 助手消息（`chat.ts` 回放历史用） */
export function createAssistantMessage(input: { content: unknown; source: unknown }): LlmMessage {
  return { role: 'assistant', content: input.content, source: input.source };
}

/** 文本块（`BlockAssembler.blocks()` 的元素形状） */
export interface TextBlock {
  type: 'text';
  text: string;
}

/**
 * 流式文本拼装：只收集文本（与调用方 `blocks().filter(b => b.type === 'text')` 的用法一致）。
 * 认 `text-delta`（`../standalone/claude-llm` 吐的就是它）与 `finish`；
 * 也收整块的 `{ type: 'text' }`。其余块（推理、工具调用、用量）忽略。
 */
export class BlockAssembler {
  private readonly chunks: string[] = [];
  /** 终止原因（`finish` 块带来；调用方在没有正文时读它报失败原因） */
  finish: unknown = undefined;

  /** 收集一个块 */
  push(chunk: unknown): void {
    if (chunk === null || typeof chunk !== 'object') return;
    const { type, text, reason } = chunk as { type?: unknown; text?: unknown; reason?: unknown };
    if ((type === 'text' || type === 'text-delta') && typeof text === 'string') this.chunks.push(text);
    else if (type === 'finish') this.finish = reason;
  }

  /** 当前已拼装的块列表 */
  blocks(): TextBlock[] {
    const text = this.chunks.join('');
    return text === '' ? [] : [{ type: 'text', text }];
  }
}
