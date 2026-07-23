export type JobType = 'ocr' | 'book' | 'courseware';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface JobStatusView {
  id: string;
  type: JobType;
  status: JobStatus;
  stage: string;
  attempt: number;
  errorCode: string | null;
  resultRef: string | null;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  stageTimings: Record<string, { startedAt?: number; completedAt?: number; durationMs?: number }>;
  queuePosition?: number;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.success) throw new Error(body.error || '任务请求失败');
  return body.data as T;
}

export function getJob(jobId: string, ownerId: string): Promise<JobStatusView> {
  return request(`/jobs/${encodeURIComponent(jobId)}?ownerId=${encodeURIComponent(ownerId)}`);
}

export function getActiveJobs(ownerId: string): Promise<JobStatusView[]> {
  return request(`/jobs?ownerId=${encodeURIComponent(ownerId)}`);
}

export function retryJob(jobId: string, ownerId: string): Promise<JobStatusView> {
  return request(`/jobs/${encodeURIComponent(jobId)}/retry`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ownerId }),
  });
}
