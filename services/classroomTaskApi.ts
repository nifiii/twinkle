export interface ClassroomTaskLink {
  entityType: string;
  entityId: string;
  role: string;
  createdAt: number;
}

export interface ClassroomTaskSummary {
  id: string;
  source: 'task' | 'legacy';
  taskType: string;
  title: string;
  subject: string;
  grade: string | null;
  book: { id: string; title: string } | null;
  chapterTitles: string[];
  generationStatus: string;
  learningStatus: string;
  createdAt: number;
  updatedAt: number;
  primaryLink: ClassroomTaskLink | null;
}

export interface ClassroomTaskDetail extends ClassroomTaskSummary {
  errorCode: string | null;
  errorMessage: string | null;
  links: ClassroomTaskLink[];
  videoResource: { id: string; title: string; durationSeconds: number; ageLabel: string; embedUrl: string } | null;
}

export interface ClassroomTaskPage {
  items: ClassroomTaskSummary[];
  nextCursor: string | null;
}

export interface LegacyClassroomContent {
  id: string;
  type: 'courseware' | 'quiz';
  bookTitle: string;
  chapter: string;
  subject: string;
  ownerId: string;
  userName: string;
  createdAt: number;
  content: unknown[];
}

export interface LegacyQuizResult {
  id: string;
  quizId: string;
  bookTitle: string;
  chapter: string;
  subject: string;
  ownerId: string;
  userName: string;
  correctCount: number;
  total: number;
  percentage: number;
  suggestions: string;
  status: 'grading' | 'completed' | 'failed';
  createdAt: number;
  results: Array<{ id: string; type: string; question: string; studentAnswer: string; correctAnswer: string; isCorrect: boolean | null; explanation: string }>;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json();
  if (!response.ok || !body.success) throw new Error(body.error || '智慧课堂读取失败，请稍后重试');
  return body.data as T;
}

export function fetchClassroomTasks(input: {
  ownerId: string;
  status?: string;
  subject?: string;
  type?: string;
  bookId?: string;
  cursor?: string;
  limit?: number;
}): Promise<ClassroomTaskPage> {
  const query = new URLSearchParams({ ownerId: input.ownerId, limit: String(input.limit || 20) });
  if (input.status) query.set('status', input.status);
  if (input.subject) query.set('subject', input.subject);
  if (input.type) query.set('type', input.type);
  if (input.bookId) query.set('bookId', input.bookId);
  if (input.cursor) query.set('cursor', input.cursor);
  return request<ClassroomTaskPage>(`/api/learning-tasks?${query}`);
}

export function fetchClassroomTask(id: string, ownerId: string): Promise<ClassroomTaskDetail> {
  return request<ClassroomTaskDetail>(`/api/learning-tasks/${encodeURIComponent(id)}?${new URLSearchParams({ ownerId })}`);
}

export function retryClassroomTask(id: string, ownerId: string): Promise<ClassroomTaskSummary> {
  return request<ClassroomTaskSummary>(`/api/learning-tasks/${encodeURIComponent(id)}/retry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerId }),
  });
}

export function fetchLegacyClassroomContent(id: string): Promise<LegacyClassroomContent> {
  return request<LegacyClassroomContent>(`/api/classroom/${encodeURIComponent(id)}`);
}

export function fetchLegacyQuizResult(id: string): Promise<LegacyQuizResult> {
  return request<LegacyQuizResult>(`/api/quiz-results/${encodeURIComponent(id)}`);
}

export async function overrideLegacyQuizResult(resultId: string, questionId: string, isCorrect: boolean): Promise<Pick<LegacyQuizResult, 'correctCount' | 'percentage'>> {
  const response = await fetch(`/api/quiz-results/${encodeURIComponent(resultId)}/override`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ questionId, isCorrect }),
  });
  const body = await response.json();
  if (!response.ok || !body.success) throw new Error(body.error || '改判失败，请稍后重试');
  return body.data;
}
