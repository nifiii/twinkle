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

export interface AttemptItemResult {
  questionId: string;
  score: number;
  maxScore: number;
  rubric: { points: Array<{ id: string; score: number; description: string; dimension?: 'process' | 'result' | 'expression' | 'knowledge' }>; reason: string };
  evidence: Array<{ id?: string; earnedScore?: number; evidence?: string; reason?: string; studentAnswer?: string; matched?: boolean }>;
  confidence: number;
  verdict: 'mastered' | 'review';
}

export interface AttemptDiagnosis {
  id: string;
  paperId: string;
  ownerId: string;
  status: 'submitted';
  diagnosticScore: number | null;
  submittedAt: number | null;
  items: AttemptItemResult[];
  events: Array<{ id: string; questionId: string; actorType: 'student' | 'parent'; action: 'request' | 'override'; reason: string; beforeJson: string; afterJson: string; createdAt: number }>;
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

export const getAttemptDiagnosis = (id: string, ownerId: string) =>
  request<AttemptDiagnosis>(`/paper-attempts/${encodeURIComponent(id)}/diagnosis?ownerId=${encodeURIComponent(ownerId)}`);

export const submitAttemptReview = (id: string, body: { ownerId: string; questionId: string; action: 'request' | 'override'; reason: string; score?: number }) =>
  request<AttemptDiagnosis>(`/paper-attempts/${encodeURIComponent(id)}/reviews`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
