import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';
import Database from 'better-sqlite3';
import {
  analyzeMetadataWithDoubao, extractMetadataFromPDFWithDoubao,
  convertPDFToMarkdownWithDoubaoOCR, convertToMarkdownWithDoubao, extractTOCFromMarkdown,
} from '../src/services/doubaoService.js';
import { initLearningDomainDatabase } from '../src/services/learningDomain.js';
import { createTextbookTask } from '../src/services/textbookTaskService.js';

function configureModels(t: test.TestContext) {
  for (const [key, value] of Object.entries({ ARK_API_KEY: 'synthetic-test-key', ARK_MODEL_ID: 'ep-test-text', ARK_VISION_MODEL_ID: 'ep-test-vision' })) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
}

test('routes cover and scanned PDF to vision, text extraction to text, and preserves vision fallback', async t => {
  configureModels(t);
  const calls: any[] = [];
  let body = '';
  t.mock.method(OpenAI.Chat.Completions.prototype, 'create', async (request: any) => {
    calls.push(request);
    return { choices: [{ finish_reason: 'stop', message: { content: body } }] };
  });
  const pages = { directory: fileURLToPath(new URL('./fixtures/', import.meta.url)), fileNames: ['ark-arithmetic.png'] };
  const metadata = { title: 'Synthetic arithmetic', subject: '数学', category: '教材', grade: '四年级', tags: [], tableOfContents: [] };
  body = JSON.stringify(metadata);
  assert.equal((await analyzeMetadataWithDoubao('24 plus 18', 'synthetic.txt')).title, metadata.title);
  assert.equal((await extractMetadataFromPDFWithDoubao('unused.pdf', 'synthetic.pdf', pages)).title, metadata.title);
  body = '# Synthetic arithmetic\n24 + 18 = 42';
  assert.match(await convertPDFToMarkdownWithDoubaoOCR('unused.pdf', 'synthetic.pdf', pages), /24 \+ 18 = 42/);
  assert.equal(await convertToMarkdownWithDoubao('24 + 18 = 42'), body);
  body = JSON.stringify([{ id: 'chapter-1', title: 'Synthetic arithmetic', level: 1 }]);
  assert.equal((await extractTOCFromMarkdown('# Contents\nSynthetic arithmetic', 'Synthetic')).length, 1);
  delete process.env.ARK_VISION_MODEL_ID;
  body = JSON.stringify(metadata);
  assert.equal((await extractMetadataFromPDFWithDoubao('unused.pdf', 'synthetic.pdf', pages)).title, metadata.title);
  body = '# Synthetic arithmetic\n24 + 18 = 42';
  assert.match(await convertPDFToMarkdownWithDoubaoOCR('unused.pdf', 'synthetic.pdf', pages), /24 \+ 18 = 42/);
  assert.deepEqual(calls.map(call => call.model), ['ep-test-text', 'ep-test-vision', 'ep-test-vision', 'ep-test-text', 'ep-test-text', 'ep-test-text', 'ep-test-text']);
  assert.ok(calls.every(call => call.thinking.type === 'disabled'));
  assert.equal(calls[3].max_tokens, 8192);
});

test('SDK failures and incomplete JSON leave a failed task with no generated artifacts', async t => {
  configureModels(t);
  const database = new Database(':memory:');
  t.after(() => database.close());
  database.exec(`
    CREATE TABLE books (id TEXT PRIMARY KEY, title TEXT, subject TEXT, grade TEXT, ownerId TEXT, status TEXT, mdPath TEXT, tableOfContents TEXT, category TEXT, tags TEXT);
    CREATE TABLE classroom_items (id TEXT PRIMARY KEY, type TEXT, bookTitle TEXT, chapter TEXT, subject TEXT, ownerId TEXT, userName TEXT, contentJson TEXT, slideCount INTEGER, questionCount INTEGER, createdAt INTEGER);
  `);
  initLearningDomainDatabase(database);
  database.prepare('INSERT INTO books (id, title, subject, grade, ownerId, status, mdPath, tableOfContents) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('synthetic-book', '数学四年级上册', '数学', '四年级', 'shared', 'completed', path.resolve('synthetic.md'), JSON.stringify([{ id: 'chapter-1', title: '大数的认识' }]));
  const failures = [
    ...[401, 403, 404, 429].map(status => Object.assign(new Error(`Synthetic HTTP ${status}`), { status })),
    new OpenAI.APIConnectionTimeoutError(),
    { finishReason: 'length', content: '[{"type":"choice","question":"24+18=?","options":["42","43"],"answer":"42","explanation":"Add"}]' },
    { finishReason: 'stop', content: '' },
    { finishReason: 'stop', content: '{invalid-json' },
  ];
  const calls: any[] = [];
  let failure: typeof failures[number];
  t.mock.method(OpenAI.Chat.Completions.prototype, 'create', async (request: any, options: any) => {
    calls.push(request);
    if (failure instanceof Error) throw failure;
    return { choices: [{ finish_reason: failure.finishReason, message: { content: failure.content } }] };
  });
  for (const [index, value] of failures.entries()) {
    failure = value;
    await assert.rejects(createTextbookTask({
      ownerId: 'child_1', requestKey: `sdk-failure-${index}`, taskType: 'math_thinking',
      source: { kind: 'chapter', bookId: 'synthetic-book', chapterIds: ['chapter-1'] },
    }, { database, readMarkdown: async () => '# 大数的认识\nSynthetic arithmetic textbook content. '.repeat(5) }));
  }
  assert.equal(calls.length, failures.length, 'no service-level retries or silent model fallback');
  assert.ok(calls.every(call => call.model === 'ep-test-text' && call.reasoning_effort === 'low'));
  assert.equal((database.prepare('SELECT COUNT(*) AS n FROM learning_tasks WHERE generationStatus = ?').get('failed') as any).n, failures.length);
  assert.equal((database.prepare('SELECT COUNT(*) AS n FROM classroom_items').get() as any).n, 0);
  assert.equal((database.prepare('SELECT COUNT(*) AS n FROM learning_task_links').get() as any).n, 0);
});
