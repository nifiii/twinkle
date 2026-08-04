export type UnifiedWrongBookSource = 'all' | 'scanned_item' | 'quiz_result';

export interface UnifiedWrongBookItem {
  id: string;
  source: Exclude<UnifiedWrongBookSource, 'all'>;
  reference: { scannedItemId: string; problemIndex: number } | { quizResultId: string; problemIndex: number };
  subject: string;
  contentExcerpt: string;
  knowledgePoints: string[];
  createdAt: number;
  detailTarget: { kind: 'scanned_item' | 'quiz_result'; id: string; problemIndex: number };
  capabilities: { view: true; edit: boolean; delete: boolean };
}

export interface UnifiedWrongBookSourceStatus {
  status: 'ok' | 'unavailable';
  count: number;
  skippedCount: number;
  errorCode?: string;
}

export interface UnifiedWrongBookPage {
  items: UnifiedWrongBookItem[];
  nextCursor: string | null;
  sources: Record<Exclude<UnifiedWrongBookSource, 'all'>, UnifiedWrongBookSourceStatus>;
}

export class UnifiedWrongBookApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly errorCode?: string) {
    super(message);
  }
}

export function fetchUnifiedWrongBook(input: {
  ownerId: string;
  source: UnifiedWrongBookSource;
  subject?: string;
  from?: string;
  to?: string;
  query?: string;
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
}): Promise<UnifiedWrongBookPage> {
  const query = new URLSearchParams({ ownerId: input.ownerId, source: input.source, limit: String(input.limit || 50) });
  if (input.subject) query.set('subject', input.subject);
  if (input.from) query.set('from', input.from);
  if (input.to) query.set('to', input.to);
  if (input.query) query.set('query', input.query);
  if (input.cursor) query.set('cursor', input.cursor);
  return fetch(`/api/wrong-book?${query}`, { signal: input.signal }).then(async response => {
    const body = await response.json();
    if (!response.ok || !body.success) throw new UnifiedWrongBookApiError(body.error || '错题本读取失败，请稍后重试', response.status, body.errorCode);
    return body.data as UnifiedWrongBookPage;
  });
}
