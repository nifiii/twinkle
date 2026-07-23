import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { JobStore, ModelSlotPool, initJobDatabase, jobLimits } from '../src/services/jobs.js';

function createStore(): JobStore {
  const db = new Database(':memory:');
  initJobDatabase(db);
  return new JobStore(db);
}

function submit(store: JobStore, requestKey: string, now = 100): string {
  const result = store.submit({
    type: 'ocr', ownerId: 'owner-a', requestKey, payloadRef: `/files/${requestKey}`, stage: 'model',
  }, now);
  assert.equal(result.accepted, true);
  assert.ok(result.job);
  return result.job.id;
}

test('accepts ten jobs and rejects the eleventh atomically', () => {
  const store = createStore();
  const positions: number[] = [];
  for (let index = 0; index < jobLimits.maxAccepted; index++) {
    const result = store.submit({
      type: 'ocr', ownerId: 'owner-a', requestKey: `request-${index}`, payloadRef: `/files/request-${index}`, stage: 'model',
    }, 1);
    assert.equal(result.accepted, true);
    positions.push(result.queuePosition!);
  }
  assert.deepEqual(positions.sort((left, right) => left - right), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const overflow = store.submit({ type: 'ocr', ownerId: 'owner-a', requestKey: 'overflow', payloadRef: '/files/overflow', stage: 'model' }, 20);
  assert.deepEqual(overflow, { accepted: false, idempotent: false, errorCode: 'QUEUE_FULL' });
});

test('returns the original job for duplicate submits and preserves FIFO claim order', () => {
  const store = createStore();
  const firstId = submit(store, 'first', 1);
  const secondId = submit(store, 'second', 2);
  const thirdId = submit(store, 'third', 3);
  const duplicate = store.submit({ type: 'ocr', ownerId: 'owner-a', requestKey: 'first', payloadRef: '/files/changed', stage: 'model' }, 4);

  assert.equal(duplicate.idempotent, true);
  assert.equal(duplicate.job?.id, firstId);
  assert.deepEqual([store.claimNext('worker', 10)?.id, store.claimNext('worker', 10)?.id, store.claimNext('worker', 10)?.id], [firstId, secondId, thirdId]);
  assert.equal(store.claimNext('worker', 10), null);
});

test('recovers expired leases and retries only a failed stage for its owner', () => {
  const store = createStore();
  const id = submit(store, 'lease', 1);
  assert.equal(store.claimNext('worker', 10, 5)?.id, id);
  assert.equal(store.recoverExpiredLeases(15), 1);
  assert.equal(store.claimNext('worker', 16)?.id, id);
  assert.equal(store.fail(id, 'MODEL_TIMEOUT', 20), true);
  assert.equal(store.retryFailedStage(id, 'owner-b', 21), false);
  assert.equal(store.retryFailedStage(id, 'owner-a', 21), true);

  const retried = store.getForOwner(id, 'owner-a')!;
  assert.equal(retried.status, 'queued');
  assert.equal(retried.stage, 'model');
  assert.equal(retried.attempt, 1);
  assert.equal(store.getForOwner(id, 'owner-b'), null);
});

test('keeps a running lease alive until its handler finishes', () => {
  const store = createStore();
  const id = submit(store, 'renewed-lease', 1);
  assert.equal(store.claimNext('worker', 10, 30_000)?.id, id);
  assert.equal(store.renewLease(id, 20_000, 30_000), true);
  assert.equal(store.recoverExpiredLeases(30_001), 0);
  assert.equal(store.get(id)?.status, 'running');
});

test('records stage timing and does not over-allocate model permits', () => {
  const store = createStore();
  const id = submit(store, 'timing', 10);
  store.claimNext('worker', 15);
  store.complete(id, 'result://timing', 35);
  const timings = JSON.parse(store.get(id)!.stageTimingsJson);
  assert.deepEqual(timings.model, { startedAt: 15, completedAt: 35, durationMs: 20 });

  const slots = new ModelSlotPool({ vision: 1, text: 1 });
  assert.equal(slots.tryAcquire('vision'), true);
  assert.equal(slots.tryAcquire('vision'), false);
  slots.release('vision');
  assert.deepEqual(slots.snapshot(), { vision: 0, text: 0 });
});

test('does not claim types whose workers have not been migrated', () => {
  const store = createStore();
  const id = store.submit({ type: 'book', ownerId: 'owner-a', requestKey: 'book', payloadRef: '/files/book', stage: 'parse' }, 1).job!.id;
  assert.equal(store.claimNext('worker', 2, 30_000, ['ocr']), null);
  assert.equal(store.get(id)?.status, 'queued');
});
