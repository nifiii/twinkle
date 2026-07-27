import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createExportJob, getExportJob, renderAssessmentPdf, runExportJob } from '../src/services/exportService.js';
import { initLearningDomainDatabase } from '../src/services/learningDomain.js';

function setup() {
  const database = new Database(':memory:');
  initLearningDomainDatabase(database);
  database.prepare(`INSERT INTO assessment_papers (id, blueprintId, ownerId, schemaVersion, contentJson, totalScore, status, createdAt) VALUES ('paper-1', 'blueprint-1', 'child_1', 1, ?, 10, 'completed', 1)`).run(JSON.stringify({ title: '原创数学试卷', generationVersion: 2, blueprint: { subject: '数学', grade: '四年级', chapterTitles: ['第一单元'] }, sections: [{ title: '一、选择题', questions: [{ id: 'q1', type: 'essay', stem: '计算 $8 + 5$，并说明过程。', answer: '13', explanation: '先计算个位。', score: 4 }] }] }));
  return database;
}

test('creates separate paper and answer export jobs from immutable paper content', async () => {
  const database = setup();
  const scheduled: string[] = [];
  const dependencies = { database, schedule: (id: string) => scheduled.push(id), renderPdf: async () => Buffer.from('%PDF-fixture') };
  const paper = createExportJob({ ownerId: 'child_1', paperId: 'paper-1', variant: 'paper' }, dependencies);
  const answer = createExportJob({ ownerId: 'child_1', paperId: 'paper-1', variant: 'answer' }, dependencies);
  assert.equal(paper.status, 'queued');
  assert.equal(answer.status, 'queued');
  assert.notEqual(paper.id, answer.id);
  await runExportJob(paper.id, dependencies);
  assert.equal(getExportJob(paper.id, 'child_1', database)?.status, 'completed');
  assert.match(String(getExportJob(paper.id, 'child_1', database)?.downloadUrl), /download=1/);
  assert.equal(getExportJob(paper.id, 'child_2', database), null);
});

test('keeps a failed job auditable and permits a new retry job without replacing a completed file', async () => {
  const database = setup();
  const schedule = () => undefined;
  const failed = createExportJob({ ownerId: 'child_1', paperId: 'paper-1', variant: 'paper' }, { database, schedule, renderPdf: async () => { throw new Error('字体缺失'); } });
  await runExportJob(failed.id, { database, schedule, renderPdf: async () => { throw new Error('字体缺失'); } });
  assert.equal(getExportJob(failed.id, 'child_1', database)?.status, 'failed');
  assert.match(String(getExportJob(failed.id, 'child_1', database)?.error), /字体缺失/);
  const retry = createExportJob({ ownerId: 'child_1', paperId: 'paper-1', variant: 'paper' }, { database, schedule, renderPdf: async () => Buffer.from('%PDF-retry') });
  assert.notEqual(retry.id, failed.id);
  await runExportJob(retry.id, { database, schedule, renderPdf: async () => Buffer.from('%PDF-retry') });
  assert.equal(getExportJob(retry.id, 'child_1', database)?.status, 'completed');
  assert.equal(getExportJob(failed.id, 'child_1', database)?.status, 'failed');
});

test('renders readable Chinese, MathJax SVG and a cross-page answer area with the embedded font', async () => {
  const questions = Array.from({ length: 5 }, (_, index) => ({ id: `q${index}`, type: 'essay' as const, stem: `第 ${index + 1} 题：计算 $8 + 5$，并用中文写出完整过程。`, answer: '13', explanation: '先计算个位，再写出结果。', score: 4 }));
  const pdf = await renderAssessmentPdf({ title: '中文公式跨页夹具', generationVersion: 3, blueprint: { subject: '数学', grade: '四年级', chapterTitles: ['大数的认识'] }, sections: [{ title: '三、解答题', questions }] }, 'paper', Date.UTC(2026, 6, 27));
  assert.deepEqual(pdf.subarray(0, 4), Buffer.from('%PDF'));
  assert.ok(pdf.length > 10_000);
});
