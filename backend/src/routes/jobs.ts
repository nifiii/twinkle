import { Router, Request, Response } from 'express';
import db from '../services/databaseService.js';
import { JobRecord, JobStore, JobType } from '../services/jobs.js';

const router = Router();
const jobs = new JobStore(db);
const jobTypes = new Set<JobType>(['ocr', 'book', 'courseware']);

function toResponse(job: JobRecord) {
  return {
    id: job.id, type: job.type, status: job.status, stage: job.stage,
    attempt: job.attempt, errorCode: job.errorCode, resultRef: job.resultRef,
    createdAt: job.createdAt, startedAt: job.startedAt, completedAt: job.completedAt,
    stageTimings: JSON.parse(job.stageTimingsJson), queuePosition: jobs.getQueuePosition(job.id),
  };
}

function ownerIdFrom(request: Request): string | null {
  const value = request.body?.ownerId || request.query.ownerId;
  return typeof value === 'string' && value.trim() ? value : null;
}

router.post('/jobs', (request: Request, response: Response) => {
  const ownerId = ownerIdFrom(request);
  const { type, requestKey, payloadRef, stage } = request.body || {};
  if (!ownerId || !jobTypes.has(type) || ![requestKey, payloadRef, stage].every((value: unknown) => typeof value === 'string' && value.trim())) {
    return response.status(400).json({ success: false, error: '任务参数无效' });
  }
  const result = jobs.submit({ type, ownerId, requestKey, payloadRef, stage });
  if (!result.accepted) return response.status(429).json({ success: false, error: '当前任务队列已满，请稍后重试', errorCode: result.errorCode });
  return response.status(result.idempotent ? 200 : 202).json({ success: true, data: { ...toResponse(result.job!), idempotent: result.idempotent } });
});

router.get('/jobs', (request: Request, response: Response) => {
  const ownerId = ownerIdFrom(request);
  if (!ownerId) return response.status(400).json({ success: false, error: '缺少 ownerId' });
  return response.json({ success: true, data: jobs.listForOwner(ownerId).map(toResponse) });
});

router.get('/jobs/:id', (request: Request, response: Response) => {
  const ownerId = ownerIdFrom(request);
  if (!ownerId) return response.status(400).json({ success: false, error: '缺少 ownerId' });
  const job = jobs.getForOwner(request.params.id, ownerId);
  if (!job) return response.status(404).json({ success: false, error: '任务不存在' });
  return response.json({ success: true, data: toResponse(job) });
});

router.post('/jobs/:id/retry', (request: Request, response: Response) => {
  const ownerId = ownerIdFrom(request);
  if (!ownerId) return response.status(400).json({ success: false, error: '缺少 ownerId' });
  if (!jobs.retryFailedStage(request.params.id, ownerId)) return response.status(409).json({ success: false, error: '仅可重试自己的失败任务' });
  return response.status(202).json({ success: true, data: toResponse(jobs.getForOwner(request.params.id, ownerId)!) });
});

export default router;
