export type WrongProblemRef = { source: 'scanned_item'; scannedItemId: string; problemIndex: number } | { source: 'quiz_result'; quizResultId: string; problemIndex: number };

export type TextbookTaskAction = 'courseware' | 'classroom_quiz' | 'english_listening' | 'math_thinking' | 'assessment';

export interface ChapterAction {
  action: TextbookTaskAction;
  available: boolean;
  reasonCode?: string;
}

export interface OlympiadMaterialOption {
  id: string;
  title: string;
  grade: string;
}

export type WrongProblemCandidate = WrongProblemRef & {
  subject: string;
  title: string;
  contentExcerpt: string;
  knowledgePoints: string[];
  createdAt: number;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json();
  if (!response.ok || !body.success) throw new Error(body.error || '请求失败，请稍后重试');
  return body.data as T;
}

export function fetchWrongProblemCandidates(ownerId: string, subject?: string): Promise<WrongProblemCandidate[]> {
  const query = new URLSearchParams({ ownerId });
  if (subject) query.set('subject', subject);
  return request<WrongProblemCandidate[]>(`/api/assistant/wrong-problems?${query}`);
}

export function createWrongReviewTask(input: { ownerId: string; userName: string; grade: string; subject: string; problems: WrongProblemRef[] }) {
  return request<{ id: string; title: string; generationStatus: string }>('/api/learning-tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ownerId: input.ownerId,
      userName: input.userName,
      requestKey: crypto.randomUUID(),
      taskType: 'wrong_review',
      source: { kind: 'wrong_problems', subject: input.subject, grade: input.grade, problems: input.problems },
    }),
  });
}

export function fetchChapterActions(input: { ownerId: string; bookId: string; chapterId: string }): Promise<ChapterAction[]> {
  const query = new URLSearchParams({ ownerId: input.ownerId });
  return request<ChapterAction[]>(`/api/assistant/books/${encodeURIComponent(input.bookId)}/chapters/${encodeURIComponent(input.chapterId)}/actions?${query}`);
}

export function fetchOlympiadMaterials(ownerId: string): Promise<OlympiadMaterialOption[]> {
  return request<OlympiadMaterialOption[]>(`/api/assistant/olympiad-materials?${new URLSearchParams({ ownerId })}`);
}

export function createTextbookTask(input: {
  ownerId: string;
  userName: string;
  taskType: TextbookTaskAction;
  bookId: string;
  chapterIds: string[];
  options?: Record<string, string>;
}) {
  return request<{ id: string; title: string; generationStatus: string }>('/api/learning-tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ownerId: input.ownerId,
      userName: input.userName,
      requestKey: crypto.randomUUID(),
      taskType: input.taskType,
      source: {
        kind: 'chapter',
        bookId: input.bookId,
        chapterIds: input.chapterIds,
        options: input.options,
      },
    }),
  });
}

export function createOlympiadAssessmentTask(input: {
  ownerId: string;
  userName: string;
  olympiadBookId: string;
  examType: string;
  difficulty: string;
}) {
  return request<{ id: string; title: string; generationStatus: string }>('/api/learning-tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ownerId: input.ownerId,
      userName: input.userName,
      requestKey: crypto.randomUUID(),
      taskType: 'assessment',
      source: {
        kind: 'olympiad',
        olympiadBookId: input.olympiadBookId,
        options: { examType: input.examType, difficulty: input.difficulty },
      },
    }),
  });
}
