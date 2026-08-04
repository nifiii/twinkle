const API_BASE = '/api';

export type AssessmentDifficulty = 'basic' | 'standard' | 'challenge';
export type AssessmentExamType = 'unit' | 'midterm' | 'final';

export interface AssessmentSection {
  id: string;
  type: 'choice' | 'fill' | 'essay';
  questionCount: number;
  scorePerQuestion: number;
  score: number;
}

export interface AssessmentBlueprint {
  id: string;
  ownerId: string;
  bookId: string;
  subject: string;
  grade: string;
  chapterIds: string[];
  chapterTitles: string[];
  examType: AssessmentExamType;
  difficulty: AssessmentDifficulty;
  sections: AssessmentSection[];
  totalScore: number;
  generationVersion: number;
  style: { id: string; sourceType: string } | null;
}

export interface AssessmentQuestion {
  id: string;
  type: 'choice' | 'fill' | 'essay';
  stem: string;
  options?: string[];
  answer: string;
  explanation: string;
  score: number;
  rubric?: Array<{ id: string; score: number; description?: string }>;
}

export interface AssessmentPaper {
  id: string;
  blueprintId: string;
  ownerId: string;
  generationVersion: number;
  totalScore: number;
  status: string;
  content: {
    title: string;
    original: true;
    totalScore: number;
    sections: Array<{ id: string; type: AssessmentQuestion['type']; title: string; questions: AssessmentQuestion[] }>;
  };
}

export interface PaperAttempt {
  id: string;
  paperId: string;
  ownerId: string;
  answers: Record<string, string>;
  status: 'draft' | 'submitted';
  submittedAt: number | null;
  updatedAt: number;
}

export type PaperExportVariant = 'paper' | 'answer';
export interface PaperExportJob {
  id: string;
  paperId: string;
  variant: PaperExportVariant;
  status: 'queued' | 'running' | 'completed' | 'failed';
  error: string | null;
  downloadUrl: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AnswerReviewItem {
  questionId: string;
  type: string;
  question: string;
  studentAnswer: string;
  referenceAnswer: string;
  explanation: string;
  needsReinforcement: boolean;
}

export interface PaperAttemptReview {
  id: string;
  paperId: string;
  ownerId: string;
  status: 'submitted';
  submittedAt: number | null;
  items: AnswerReviewItem[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.error || '请求失败');
  return data.data as T;
}

export const createAssessmentBlueprint = (body: { ownerId: string; bookId: string; chapterIds: string[]; examType: AssessmentExamType; difficulty?: AssessmentDifficulty; styleProfileId?: string }) =>
  request<AssessmentBlueprint>('/assessment-blueprints', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const createAssessmentPaper = (body: { ownerId: string; blueprintId: string }) =>
  request<AssessmentPaper>('/assessment-papers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const getAssessmentPaper = (id: string, ownerId: string) =>
  request<AssessmentPaper>(`/assessment-papers/${encodeURIComponent(id)}?ownerId=${encodeURIComponent(ownerId)}`);

export const createPaperExport = (paperId: string, body: { ownerId: string; variant: PaperExportVariant }) =>
  request<PaperExportJob>(`/assessment-papers/${encodeURIComponent(paperId)}/exports`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const getPaperExport = (id: string, ownerId: string) =>
  request<PaperExportJob>(`/exports/${encodeURIComponent(id)}?ownerId=${encodeURIComponent(ownerId)}`);

export const createPaperAttempt = (body: { ownerId: string; paperId: string }) =>
  request<PaperAttempt>('/paper-attempts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const savePaperAttempt = (id: string, body: { ownerId: string; action: 'save' | 'submit'; answers: Record<string, string> }) =>
  request<PaperAttempt>(`/paper-attempts/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const getPaperAttemptReview = (id: string, ownerId: string) =>
  request<PaperAttemptReview>(`/paper-attempts/${encodeURIComponent(id)}/review?ownerId=${encodeURIComponent(ownerId)}`);

export const setPaperAttemptReinforcement = (id: string, questionId: string, body: { ownerId: string; needsReinforcement: boolean }) =>
  request<{ questionId: string; needsReinforcement: boolean }>(`/paper-attempts/${encodeURIComponent(id)}/review-items/${encodeURIComponent(questionId)}/reinforcement`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
