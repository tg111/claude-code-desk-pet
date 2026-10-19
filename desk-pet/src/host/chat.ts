/**
 * 对话生成（host 半侧）：经 `ctx.llm`（Claude Code 模式下 = `claude -p`）按条目配置的 chatModel
 * （留空 = 默认模型）生成一句回复。与碎碎念（generateWhisper）同构，区别是：
 *  - 输入带历史对话（memory.json 截取的最近 N 轮），历史以 user/assistant 消息进入请求；
 *  - user 消息 = 用户刚输入的话（不是"随便叨叨"指令）；
 *  - 超时放宽到 60s。
 *
 * 设计：
 *  - provider/model：条目配置的 chatModel 优先（留空 = 不指定），失败回落到
 *    agentDefaultModel.currentSelection()（默认模型）重试一次——候选链见 model-selection.ts；
 *  - system = 用户配置的 whisperPrompt（人设：碎碎念与对话共用同一人设）；
 *  - 无正文时读 BlockAssembler.finish 报失败原因；生成失败显式返回结构化原因，不伪造文案。
 *
 * 配图（可选，pool 非空时）：与碎碎念「随机抽」不同——对话有真实上下文（用户输入 + 历史），
 * 故把整张表情包清单交给模型由它**按语境选**一张；模型在末尾附标记 [图:名称]，
 * host 解析并**只在池内命中时**采纳（防幻觉出池外名称），未选/选错则不配图
 * （对话配图是点缀，不强制每句都带）。
 */

import { BlockAssembler, createAssistantMessage, createUserMessage } from './llm-messages';
import { noTextReason } from './llm-call';
import { extractChatImage, memeCatalog, type MemeEntry } from './memes';
import { modelCandidates, modelLabel, type ModelRef } from './model-selection';

/** 生成失败原因（与 shared/whisper.ts 的 WhisperState 失败分支同构） */
export type ChatGenerateResult =
  | { ok: true; text: string; image?: string }
  | { ok: false; reason: 'provider-missing' | 'generate-error'; message?: string };

/** 记忆中的一条消息（与 shared/chat.ts 的 ChatMessage 同构） */
export interface ChatMemoryMessage {
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

/** 单次生成超时（ms）：对话等 LLM 回复，60s 足够 */
const TIMEOUT_MS = 60_000;

/** 配图指令：附在 user 正文之后（紧邻回答位置，模型更容易遵守） */
function imageInstruction(pool: MemeEntry[]): string {
  return (
    '\n\n[配图] 回复结尾可选附一张表情包给用户看，从下列清单里挑最贴合当前语境的：\n' +
    memeCatalog(pool) +
    '\n挑中就在回复最后另起一行写 [图:名称]（名称原样照抄）；没有合适的就完全不要写这个标记。'
  );
}

/**
 * 生成一句对话回复。
 * @param ctx 宿主上下文（注入 agentDefaultModel / llm）
 * @param system 人设提示词（whisperPrompt）
 * @param history 最近记忆（按时间正序；user/assistant 交替）
 * @param userText 用户刚输入的话
 * @param pool 表情包候选池（开启对话配图时传入；空/缺省 = 纯文本，指令与解析都不介入）
 * @param preferred 条目配置单独指定的模型（chatModel）；缺省 / 留空 = 只用当前对话的模型
 * @returns 回复文本（+ 命中池内的配图名），或结构化失败（provider 缺失 / 生成错误）
 */
export async function generateChat(
  ctx: { agentDefaultModel: { currentSelection(): { provider: string; model: string } }; llm?: unknown },
  system: string,
  history: ChatMemoryMessage[],
  userText: string,
  pool: MemeEntry[] = [],
  preferred?: ModelRef,
): Promise<ChatGenerateResult> {
  // 候选链：配置的模型优先 → 当前对话的模型兜底（chatModel 留空时链上只有后者，与旧版逐字一致）
  const candidates = modelCandidates(ctx, preferred);
  if (candidates.length === 0) {
    return { ok: false, reason: 'provider-missing', message: '当前对话未配置模型' };
  }
  const llm = (ctx as { llm?: { stream(o: unknown): AsyncIterable<unknown> } }).llm;
  if (!llm || typeof llm.stream !== 'function') {
    return { ok: false, reason: 'generate-error', message: 'LLM 服务不可用' };
  }
  // 依次尝试：配置的模型失败（凭据被删 / 模型下架 / 该服务商没配 key）时**回落到当前对话的模型
  // 重试一次**，仍失败才抛出失败原因——最后一次是用户当前真正在用的模型，报错更有意义。
  // 兜底文案与失败分支同源，避免两处字面量漂移
  let last: ChatGenerateResult = { ok: false, reason: 'generate-error', message: noTextReason(undefined) };
  for (const [i, sel] of candidates.entries()) {
    const result = await generateWith(llm, sel, system, history, userText, pool);
    if (result.ok) return result;
    last = result;
    // 回落要留痕：配的模型没生效时能在日志里看到原因（否则"我明明配了 A，怎么还是用 B"没法查）
    if (i + 1 < candidates.length) {
      console.warn(
        `desk-pet: 对话用 ${modelLabel(sel)} 生成失败（${result.message ?? result.reason}），回落到 ${modelLabel(candidates[i + 1])}`,
      );
    }
  }
  return last;
}

/** 用**一个**确定的 provider/model 跑一次对话生成（候选链的一环；失败原样返回结构化原因，不吞） */
async function generateWith(
  llm: { stream(o: unknown): AsyncIterable<unknown> },
  sel: ModelRef,
  system: string,
  history: ChatMemoryMessage[],
  userText: string,
  pool: MemeEntry[],
): Promise<ChatGenerateResult> {
  // 历史 → 消息：user 经 createUserMessage，assistant 经 createAssistantMessage
  const historyMessages = history.map((m) =>
    m.role === 'user'
      ? createUserMessage({
          content: [{ type: 'text', text: m.content }],
          source: { kind: 'user' },
        })
      : createAssistantMessage({
          content: [{ type: 'text', text: m.content }],
          source: { provider: sel.provider, model: sel.model },
        }),
  );

  const deadline = AbortSignal.timeout(TIMEOUT_MS);
  // 配图：池非空才把清单与指令附进 user 正文（空池 = 关闭配图，正文与旧行为逐字一致）
  const wantImage = pool.length > 0;
  const options = {
    provider: sel.provider,
    model: sel.model,
    messages: [
      ...historyMessages,
      createUserMessage({
        content: [{ type: 'text', text: wantImage ? userText + imageInstruction(pool) : userText }],
        source: { kind: 'user' },
      }),
    ],
    system,
    temperature: 1,
    signal: deadline,
  };

  const assembler = new BlockAssembler();
  try {
    for await (const chunk of llm.stream(options)) {
      assembler.push(chunk as Parameters<BlockAssembler['push']>[0]);
    }
  } catch (e) {
    return {
      ok: false,
      reason: 'generate-error',
      message: e instanceof Error ? e.message : String(e),
    };
  }
  const text = assembler
    .blocks()
    .filter((b) => b.type === 'text')
    .map((b) => ('text' in b ? (b as { text: string }).text : ''))
    .join('')
    .trim();
  if (!text) return { ok: false, reason: 'generate-error', message: noTextReason(assembler.finish) };
  // 配图解析：命中池内才采纳并剥离标记；未选/幻觉名称 → 原样返回纯文本
  if (!wantImage) return { ok: true, text };
  const picked = extractChatImage(text, pool);
  return picked.image ? { ok: true, text: picked.text, image: picked.image } : { ok: true, text: picked.text };
}
