// Pin releases so provider-side weekly aliases cannot change learning output silently.
export const ARK_PRO_MODEL = 'doubao-seed-2-1-pro-260915';
export const ARK_OCR_LITE_MODEL = 'doubao-seed-2-1-lite-260915';

// Seed 2.1 defaults to high reasoning and 4k output. Explicit budgets keep the
// existing generation timeouts useful and leave room for a complete exam paper.
export const ARK_GENERATION_OPTIONS = {
  reasoning_effort: 'low',
  max_tokens: 16_384,
} as const;

export const ARK_EXTRACTION_OPTIONS = {
  thinking: { type: 'disabled' },
  max_tokens: 16_384,
} as const;

export function requireArkContent(response: {
  choices: Array<{ finish_reason?: string | null; message: { content: string | null } }>;
}): string {
  const choice = response.choices[0];
  // A syntactically valid JSON prefix can still be a truncated paper; parsing
  // alone must never authorize saving it as a complete learning resource.
  if (choice?.finish_reason !== 'stop') {
    throw new Error('模型未完整生成内容，请重试');
  }
  if (!choice.message.content?.trim()) throw new Error('模型返回空内容，请重试');
  return choice.message.content;
}
