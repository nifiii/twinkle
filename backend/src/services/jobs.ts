import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

export type JobType = 'ocr' | 'book' | 'courseware';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type ModelSlotKind = 'vision' | 'text';

export interface JobRecord {
  id: string;
  type: JobType;
  ownerId: string;
  requestKey: string;
  status: JobStatus;
  stage: string;
  payloadRef: string;
  resultRef: string | null;
  errorCode: string | null;
  attempt: number;
  notBefore: number;
  leaseUntil: number | null;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  stageTimingsJson: string;
}

export interface SubmitJobInput {
  type: JobType;
  ownerId: string;
  requestKey: string;
  payloadRef: string;
  stage: string;
}

export interface SubmitJobResult {
  accepted: boolean;
  idempotent: boolean;
  job?: JobRecord;
  queuePosition?: number;
  errorCode?: 'QUEUE_FULL';
}

type StageTiming = { startedAt?: number; completedAt?: number; durationMs?: number };
type StageTimings = Record<string, StageTiming>;

const ACTIVE_STATUSES: JobStatus[] = ['queued', 'running'];
const MAX_ACCEPTED_JOBS = 10;
const MAX_RUNNING_JOBS = 3;
const JOB_LEASE_MS = 30_000;
const JOB_LEASE_RENEWAL_MS = 10_000;

/**
 * Initializes the independent job contract without modifying legacy task tables.
 * Why: OCR/PDF/courseware migrations happen separately; keeping their existing
 * tables untouched lets each migration roll back without losing user results.
 */
export function initJobDatabase(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('ocr', 'book', 'courseware')),
      ownerId TEXT NOT NULL,
      requestKey TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
      stage TEXT NOT NULL,
      payloadRef TEXT NOT NULL,
      resultRef TEXT,
      errorCode TEXT,
      attempt INTEGER NOT NULL DEFAULT 0,
      notBefore INTEGER NOT NULL,
      leaseUntil INTEGER,
      createdAt INTEGER NOT NULL,
      startedAt INTEGER,
      completedAt INTEGER,
      stageTimingsJson TEXT NOT NULL DEFAULT '{}',
      UNIQUE(ownerId, requestKey)
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_dispatch ON jobs(status, notBefore, createdAt);
    CREATE INDEX IF NOT EXISTS idx_jobs_owner_status ON jobs(ownerId, status, createdAt);
  `);
}

function parseTimings(raw: string): StageTimings {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as StageTimings : {};
  } catch {
    return {};
  }
}

function queuePosition(db: Database.Database, id: string): number {
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM jobs AS queued
    JOIN jobs AS target ON target.id = ?
    WHERE queued.status = 'queued'
      AND (queued.createdAt < target.createdAt
        OR (queued.createdAt = target.createdAt AND queued.rowid <= target.rowid))
  `).get(id) as { count: number };
  return row.count;
}

/**
 * SQLite-backed job state transitions. All compare-and-set writes keep duplicate
 * browser submits and repeated scheduler ticks from executing a job twice.
 */
export class JobStore {
  constructor(private readonly db: Database.Database) {}

  submit(input: SubmitJobInput, now = Date.now()): SubmitJobResult {
    const submitTx = this.db.transaction((): SubmitJobResult => {
      const existing = this.getByRequestKey(input.ownerId, input.requestKey);
      if (existing) {
        return {
          accepted: true,
          idempotent: true,
          job: existing,
          queuePosition: existing.status === 'queued' ? queuePosition(this.db, existing.id) : undefined,
        };
      }

      const active = this.db.prepare(`
        SELECT COUNT(*) AS count FROM jobs WHERE status IN ('queued', 'running')
      `).get() as { count: number };
      if (active.count >= MAX_ACCEPTED_JOBS) {
        return { accepted: false, idempotent: false, errorCode: 'QUEUE_FULL' };
      }

      const job: JobRecord = {
        id: randomUUID(),
        type: input.type,
        ownerId: input.ownerId,
        requestKey: input.requestKey,
        status: 'queued',
        stage: input.stage,
        payloadRef: input.payloadRef,
        resultRef: null,
        errorCode: null,
        attempt: 0,
        notBefore: now,
        leaseUntil: null,
        createdAt: now,
        startedAt: null,
        completedAt: null,
        stageTimingsJson: '{}',
      };
      this.db.prepare(`
        INSERT INTO jobs (
          id, type, ownerId, requestKey, status, stage, payloadRef, resultRef,
          errorCode, attempt, notBefore, leaseUntil, createdAt, startedAt,
          completedAt, stageTimingsJson
        ) VALUES (
          @id, @type, @ownerId, @requestKey, @status, @stage, @payloadRef, @resultRef,
          @errorCode, @attempt, @notBefore, @leaseUntil, @createdAt, @startedAt,
          @completedAt, @stageTimingsJson
        )
      `).run(job);
      return { accepted: true, idempotent: false, job, queuePosition: queuePosition(this.db, job.id) };
    });

    return submitTx();
  }

  claimNext(workerId: string, now = Date.now(), leaseMs = 30_000, allowedTypes?: readonly JobType[]): JobRecord | null {
    const claimTx = this.db.transaction((): JobRecord | null => {
      if (allowedTypes && allowedTypes.length === 0) return null;
      const running = this.db.prepare(`
        SELECT COUNT(*) AS count FROM jobs WHERE status = 'running'
      `).get() as { count: number };
      if (running.count >= MAX_RUNNING_JOBS) return null;

      const typeFilter = allowedTypes
        ? ` AND type IN (${allowedTypes.map(() => '?').join(', ')})`
        : '';

      const candidate = this.db.prepare(`
        SELECT id FROM jobs
        WHERE status = 'queued' AND notBefore <= ?${typeFilter}
        ORDER BY createdAt ASC, rowid ASC
        LIMIT 1
      `).get(now, ...(allowedTypes || [])) as { id: string } | undefined;
      if (!candidate) return null;

      const claimed = this.db.prepare(`
        UPDATE jobs
        SET status = 'running', leaseUntil = ?, startedAt = COALESCE(startedAt, ?), errorCode = NULL
        WHERE id = ? AND status = 'queued'
      `).run(now + leaseMs, now, candidate.id);
      if (claimed.changes !== 1) return null;

      const job = this.get(candidate.id)!;
      this.startStage(job.id, job.stage, now);
      return this.get(job.id)!;
    });

    return claimTx();
  }

  renewLease(id: string, now = Date.now(), leaseMs = 30_000): boolean {
    return this.db.prepare(`
      UPDATE jobs SET leaseUntil = ? WHERE id = ? AND status = 'running'
    `).run(now + leaseMs, id).changes === 1;
  }

  recoverExpiredLeases(now = Date.now()): number {
    return this.db.prepare(`
      UPDATE jobs SET status = 'queued', leaseUntil = NULL
      WHERE status = 'running' AND leaseUntil IS NOT NULL AND leaseUntil <= ?
    `).run(now).changes;
  }

  complete(id: string, resultRef: string, now = Date.now()): boolean {
    const job = this.get(id);
    if (!job || job.status !== 'running') return false;
    this.finishStage(id, job.stage, now);
    return this.db.prepare(`
      UPDATE jobs
      SET status = 'completed', resultRef = ?, completedAt = ?, leaseUntil = NULL, errorCode = NULL
      WHERE id = ? AND status = 'running'
    `).run(resultRef, now, id).changes === 1;
  }

  fail(id: string, errorCode: string, now = Date.now()): boolean {
    const job = this.get(id);
    if (!job || job.status !== 'running') return false;
    this.finishStage(id, job.stage, now);
    return this.db.prepare(`
      UPDATE jobs
      SET status = 'failed', errorCode = ?, completedAt = ?, leaseUntil = NULL
      WHERE id = ? AND status = 'running'
    `).run(errorCode, now, id).changes === 1;
  }

  retryFailedStage(id: string, ownerId: string, notBefore = Date.now()): boolean {
    return this.db.prepare(`
      UPDATE jobs
      SET status = 'queued', attempt = attempt + 1, notBefore = ?, completedAt = NULL, errorCode = NULL
      WHERE id = ? AND ownerId = ? AND status = 'failed'
    `).run(notBefore, id, ownerId).changes === 1;
  }

  setStage(id: string, stage: string, now = Date.now()): boolean {
    const job = this.get(id);
    if (!job || job.status !== 'running' || job.stage === stage) return false;
    this.finishStage(id, job.stage, now);
    this.db.prepare('UPDATE jobs SET stage = ? WHERE id = ? AND status = \'running\'').run(stage, id);
    this.startStage(id, stage, now);
    return true;
  }

  get(id: string): JobRecord | null {
    return (this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRecord | undefined) || null;
  }

  getForOwner(id: string, ownerId: string): JobRecord | null {
    return (this.db.prepare('SELECT * FROM jobs WHERE id = ? AND ownerId = ?').get(id, ownerId) as JobRecord | undefined) || null;
  }

  listByStatus(status: JobStatus): JobRecord[] {
    return this.db.prepare('SELECT * FROM jobs WHERE status = ? ORDER BY createdAt ASC, id ASC').all(status) as JobRecord[];
  }

  listForOwner(ownerId: string): JobRecord[] {
    return this.db.prepare('SELECT * FROM jobs WHERE ownerId = ? ORDER BY createdAt DESC, rowid DESC').all(ownerId) as JobRecord[];
  }

  getQueuePosition(id: string): number | undefined {
    const job = this.get(id);
    return job?.status === 'queued' ? queuePosition(this.db, id) : undefined;
  }

  private getByRequestKey(ownerId: string, requestKey: string): JobRecord | null {
    return (this.db.prepare('SELECT * FROM jobs WHERE ownerId = ? AND requestKey = ?').get(ownerId, requestKey) as JobRecord | undefined) || null;
  }

  private startStage(id: string, stage: string, now: number): void {
    const job = this.get(id);
    if (!job) return;
    const timings = parseTimings(job.stageTimingsJson);
    timings[stage] = { ...timings[stage], startedAt: timings[stage]?.startedAt ?? now };
    this.db.prepare('UPDATE jobs SET stageTimingsJson = ? WHERE id = ?').run(JSON.stringify(timings), id);
  }

  private finishStage(id: string, stage: string, now: number): void {
    const job = this.get(id);
    if (!job) return;
    const timings = parseTimings(job.stageTimingsJson);
    const timing = timings[stage] || { startedAt: now };
    timings[stage] = { ...timing, completedAt: now, durationMs: Math.max(0, now - (timing.startedAt || now)) };
    this.db.prepare('UPDATE jobs SET stageTimingsJson = ? WHERE id = ?').run(JSON.stringify(timings), id);
  }
}

export type JobHandler = (job: JobRecord) => Promise<string>;

export class JobExecutionError extends Error {
  constructor(public readonly errorCode: string, message: string) {
    super(message);
  }
}

/**
 * Runs at most three jobs at a time. Handlers are registered by T-004 through
 * T-006, so introducing this scheduler does not alter legacy request handling.
 */
export class JobScheduler {
  private readonly handlers = new Map<JobType, JobHandler>();
  private active = 0;

  constructor(private readonly store: JobStore, private readonly workerId = `worker-${randomUUID()}`) {}

  register(type: JobType, handler: JobHandler): void {
    this.handlers.set(type, handler);
  }

  async tick(now = Date.now()): Promise<void> {
    this.store.recoverExpiredLeases(now);
    while (this.active < MAX_RUNNING_JOBS) {
      const job = this.store.claimNext(this.workerId, now, JOB_LEASE_MS, [...this.handlers.keys()]);
      if (!job) return;
      const handler = this.handlers.get(job.type);
      if (!handler) {
        return;
      }

      this.active++;
      // Why: model calls can legitimately exceed the 30s crash-recovery lease.
      // Renewing while the promise is live avoids re-dispatching healthy work.
      const renewLease = setInterval(() => this.store.renewLease(job.id, Date.now(), JOB_LEASE_MS), JOB_LEASE_RENEWAL_MS);
      void handler(job)
        .then(resultRef => this.store.complete(job.id, resultRef))
        .catch((error: unknown) => this.store.fail(
          job.id,
          error instanceof JobExecutionError ? error.errorCode : 'JOB_EXECUTION_FAILED',
        ))
        .finally(() => {
          clearInterval(renewLease);
          this.active--;
        });
    }
  }
}

/**
 * Model permits are deliberately separate from task permits: one PDF can make
 * several model calls, but it may not exceed its verified provider budget.
 */
export class ModelSlotPool {
  private readonly inUse: Record<ModelSlotKind, number> = { vision: 0, text: 0 };

  constructor(private readonly capacity: Record<ModelSlotKind, number> = { vision: 3, text: 3 }) {}

  tryAcquire(kind: ModelSlotKind): boolean {
    if (this.inUse[kind] >= this.capacity[kind]) return false;
    this.inUse[kind]++;
    return true;
  }

  release(kind: ModelSlotKind): void {
    if (this.inUse[kind] === 0) throw new Error(`Model slot ${kind} was released without being acquired.`);
    this.inUse[kind]--;
  }

  async acquire(kind: ModelSlotKind): Promise<() => void> {
    while (!this.tryAcquire(kind)) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return () => this.release(kind);
  }

  snapshot(): Readonly<Record<ModelSlotKind, number>> {
    return { ...this.inUse };
  }
}

export const jobLimits = { maxAccepted: MAX_ACCEPTED_JOBS, maxRunning: MAX_RUNNING_JOBS } as const;
