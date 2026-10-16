import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import Database from 'better-sqlite3';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const value = name => process.argv[process.argv.indexOf(name) + 1];
dotenv.config({ path: process.argv.includes('--env-file') ? value('--env-file') : path.join(root, '.env') });
assert.ok(process.env.ARK_API_KEY && process.env.ARK_MODEL_ID, 'Ark configuration is required');
// Services import their default database at module initialization. Keep even
// that unused default away from the real application data directory.
process.env.DATA_DIR = path.join(root, 'tmp/ark-learning-synthetic');
const { initLearningDomainDatabase } = await import('../dist/services/learningDomain.js');
const { createTextbookTask } = await import('../dist/services/textbookTaskService.js');
const { createAssessmentBlueprint, createAssessmentPaper } = await import('../dist/services/assessmentPaperService.js');
const { generateOriginalEnglishListening, requireEnglishListeningGradeProfile } = await import('../dist/services/learningPackageService.js');
const database = new Database(':memory:');
database.exec(`
  CREATE TABLE books (id TEXT PRIMARY KEY, title TEXT, subject TEXT, grade TEXT, ownerId TEXT, status TEXT, mdPath TEXT, tableOfContents TEXT, category TEXT, tags TEXT);
  CREATE TABLE classroom_items (id TEXT PRIMARY KEY, type TEXT, bookTitle TEXT, chapter TEXT, subject TEXT, ownerId TEXT, userName TEXT, contentJson TEXT, slideCount INTEGER, questionCount INTEGER, createdAt INTEGER);
`);
initLearningDomainDatabase(database);
database.prepare('INSERT INTO books (id, title, subject, grade, ownerId, status, mdPath, tableOfContents) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  .run('synthetic-math', 'Synthetic arithmetic', '数学', '四年级', 'shared', 'completed', 'synthetic.md', JSON.stringify([{ id: 'unit-1', title: '大数的认识' }]));
const readMarkdown = async () => '# 大数的认识\n这是人工构造的验证素材，不来自任何教材或学生资料。学习目标为理解万、十万、百万的计数单位，按数位读写多位整数，比较两个多位数的大小，并对指定数位进行四舍五入。可以通过生活中的虚构数量练习读数、写数和大小比较。';
const report = { timestamp: new Date().toISOString(), syntheticDataOnly: true, checks: [] };
const sdkCalls = [];
const original = OpenAI.Chat.Completions.prototype.create;
// Observe the real transport without replacing the model or the service prompt.
OpenAI.Chat.Completions.prototype.create = async function (...args) {
  const start = Date.now();
  const response = await original.apply(this, args);
  const raw = response.choices[0]?.message?.content || '';
  let jsonParseable = true;
  try { JSON.parse(raw.replace(/^```json\s*|\s*```$/g, '').trim()); } catch { jsonParseable = false; }
  sdkCalls.push({ model: response.model, elapsedMs: Date.now() - start, finishReason: response.choices[0]?.finish_reason, jsonParseable, usage: response.usage });
  return response;
};
async function check(name, action) {
  const start = Date.now();
  const callStart = sdkCalls.length;
  try {
    report.checks.push({ name, status: 'passed', ...await action(), elapsedMs: Date.now() - start, calls: sdkCalls.slice(callStart) });
  } catch (error) {
    report.checks.push({ name, status: 'failed', elapsedMs: Date.now() - start, code: error instanceof OpenAI.APIConnectionTimeoutError ? 'api_timeout' : error.code || error.name, httpStatus: error.status || null, calls: sdkCalls.slice(callStart) });
    process.exitCode = 1;
  }
  console.log(JSON.stringify(report.checks.at(-1)));
  const output = path.join(root, 'tmp/ark-learning-verification.json');
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(report, null, 2));
}
try {
  await check('student-courseware-and-linked-quiz', async () => {
    const task = await createTextbookTask({ ownerId: 'child_1', requestKey: 'synthetic-courseware', taskType: 'courseware', source: { kind: 'chapter', bookId: 'synthetic-math', chapterIds: ['unit-1'] } }, { database, readMarkdown });
    assert.equal(task.generationStatus, 'ready');
    const links = database.prepare('SELECT entityType FROM learning_task_links WHERE taskId = ? ORDER BY entityType').all(task.id);
    assert.deepEqual(links.map(link => link.entityType), ['classroom_courseware', 'classroom_quiz']);
    const courseware = JSON.parse(database.prepare("SELECT contentJson FROM classroom_items WHERE type = 'courseware'").get().contentJson);
    return { steps: courseware.steps.length, audience: courseware.audience, linkedEntities: links.length };
  });
  await check('challenge-paper-real-ten-question-blueprint', async () => {
    const blueprint = await createAssessmentBlueprint({ ownerId: 'child_1', bookId: 'synthetic-math', chapterIds: ['unit-1'], examType: 'final', difficulty: 'challenge' }, { database });
    const paper = await createAssessmentPaper({ ownerId: 'child_1', blueprintId: blueprint.id }, { database, readMarkdown });
    assert.equal(paper.status, 'completed');
    assert.deepEqual(paper.content.sections.map(section => section.questions.length), [4, 3, 3]);
    return { sections: 3, questions: 10, contentCharacters: JSON.stringify(paper.content).length };
  });
  await check('fourth-grade-five-question-listening', async () => {
    const listening = await generateOriginalEnglishListening({ textbookGrade: '四年级上册', gradeProfile: requireEnglishListeningGradeProfile('四年级上册'), chapterTitles: ['School life'], chapterExcerpt: 'Synthetic learning objectives: familiar school rooms, times, simple daily routines and short present-tense conversations. No textbook or student content is supplied.' });
    assert.equal(listening.questions.length, 5);
    return { questions: listening.questions.length, scriptWords: listening.script.match(/[A-Za-z]+(?:\x27[A-Za-z]+)?/g)?.length };
  });
} finally {
  OpenAI.Chat.Completions.prototype.create = original;
  database.close();
}
