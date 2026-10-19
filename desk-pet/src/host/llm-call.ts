/**
 * 碎碎念 / 对话「没有正文」时的原因解析。
 */

/**
 * 没有正文时，按流终止原因给出要展示的原因。
 * @param finish - `BlockAssembler.finish`（流的终止块带来的原因）
 * @returns 上层拼在「对话失败：」之后的文案
 */
export function noTextReason(finish: unknown): string {
  const { kind, failure } = (finish ?? {}) as { kind?: unknown; failure?: unknown };
  if (kind === 'aborted') return '生成已取消';
  if (kind === 'max-tokens') return '输出达到上限，未产出正文';
  if (kind !== 'error') return '模型未返回文本';
  const { message, code } = (failure ?? {}) as { message?: unknown; code?: unknown };
  if (typeof message === 'string' && message.trim() !== '') return message;
  if (typeof code === 'string' && code.trim() !== '') return code;
  return '未提供失败原因';
}
