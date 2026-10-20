import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { isSourcePaperMaterial } from '../src/utils/materialClassification.js';

test('explicit exam categories and tags distinguish papers from textbooks and Olympiad sources', () => {
  for (const tags of [['期中测试', '五年级上册'], ['期中真题', '四年级下册'], ['期末试卷'], ['期中试卷']]) {
    assert.equal(isSourcePaperMaterial({ category: '考试真题', tags }), true, tags.join(','));
    assert.equal(isSourcePaperMaterial({ category: '考试真题', tags: JSON.stringify(tags) }), true);
  }
  for (const tag of ['期中测试', '期末测试', '期中真题', '期末真题']) {
    assert.equal(isSourcePaperMaterial({ tags: [tag] }), true, tag);
  }
  assert.equal(isSourcePaperMaterial({ category: '考试真题' }), true);
  for (const tags of [['奥数', '期中试卷'], ['数学竞赛']]) {
    assert.equal(isSourcePaperMaterial({ category: '考试真题', tags }), false);
  }
  assert.equal(isSourcePaperMaterial({ category: '教材', tags: ['四年级', '英语'] }), false);
  assert.equal(isSourcePaperMaterial({ category: '教材', tags: 'invalid-json' }), false);
});

test('profile API persists explicitly selected current grade, automatic mode and China academic-year boundary', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'twinkle-grade-http-'));
  process.env.DATA_DIR = directory;
  process.env.LEARNING_TASKS_ENABLED = 'true';
  const { default: db, initDatabase } = await import('../src/services/databaseService.js');
  const { default: router } = await import('../src/routes/users.js');
  const { default: taskRouter } = await import('../src/routes/learningTasks.js');
  initDatabase();
  const app = express(); app.use(express.json()); app.use('/api', router); app.use('/api', taskRouter);
  const server = app.listen(0); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/users`;
  const call = async (route = '', body?: unknown, method = 'PATCH') => {
    const response = await fetch(base + route, body === undefined ? undefined : {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, ...await response.json() as any };
  };
  const current = async () => (await call()).data.find((u: any) => u.id === 'child_1');
  try {
    await t.test('reselecting existing base grade resets current grade; name-only PATCH preserves anchor', async t => {
      t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-19T02:00:00Z').getTime() });
      db.prepare("UPDATE users SET baseGrade=4,baseGradeSetAt='2026-07' WHERE id='child_1'").run();
      assert.equal((await current()).gradeNum, 5);
      const saved = await call('/child_1', { baseGrade: 4 });
      assert.equal(saved.status, 200); assert.equal(saved.data.gradeNum, 4);
      assert.equal((await current()).gradeNum, 4);
      assert.equal(saved.data.baseGradeSetAt, '2026-10');
      await call('/child_1', { name: '只改姓名' });
      assert.equal((await current()).baseGradeSetAt, '2026-10');
    });
    await t.test('null clears manual grade and birth date, and invalid grade never persists', async () => {
      const saved = await call('/child_1', { baseGrade: null, birthDate: '2017-02' });
      assert.equal(saved.status, 200); assert.equal(saved.data.baseGrade, undefined);
      assert.equal(saved.data.baseGradeSetAt, undefined);
      assert.equal(db.prepare("SELECT baseGradeSetAt FROM users WHERE id='child_1'").get().baseGradeSetAt, null);
      for (const baseGrade of [0, 13, 4.5, '4']) {
        assert.equal((await call('/child_1', { baseGrade })).status, 400);
        assert.equal((await call('', { name: '非法年级', baseGrade }, 'POST')).status, 400);
      }
      await call('/child_1', { birthDate: null });
      assert.equal((await current()).birthDate, undefined);
      assert.equal((await call('/not-found', { baseGrade: 4 })).status, 404);
    });
    await t.test('China September boundary and newly created grade do not follow host timezone', async t => {
      t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-08-31T15:59:59Z').getTime() });
      db.prepare("UPDATE users SET baseGrade=4,baseGradeSetAt='2025-09' WHERE id='child_1'").run();
      assert.equal((await current()).gradeNum, 4);
      t.mock.timers.setTime(new Date('2026-08-31T16:00:00Z').getTime());
      assert.equal((await current()).gradeNum, 5);
      const saved = await call('/child_1', { baseGrade: 4 });
      assert.equal(saved.data.gradeNum, 4); assert.equal(saved.data.baseGradeSetAt, '2026-09');
      const created = await call('', { name: '边界样本', baseGrade: 4 }, 'POST');
      assert.equal(created.data.gradeNum, 4); assert.equal(created.data.baseGradeSetAt, '2026-09');
      t.mock.timers.setTime(new Date('2027-08-31T16:00:00Z').getTime());
      assert.equal((await current()).gradeNum, 5);
    });
    await t.test('real candidate API includes exam labels and textbook API rejects the same sources', async () => {
      const insert = db.prepare('INSERT INTO books (id,title,subject,ownerId,category,tags,status,mdPath,tableOfContents) VALUES (?,?,?,?,?,?,?,?,?)');
      for (const [id, tag] of [['english-5', '期中测试'], ['chinese-4', '期中真题'], ['english-4', '期末试卷'], ['math-4', '期中试卷']]) {
        insert.run(id, '合成试卷', '英语', 'child_1', '考试真题', JSON.stringify([tag]), 'completed', 'synthetic.md', '[]');
      }
      insert.run('textbook', '期末复习教材', '英语', 'child_1', '教材', '[]', 'completed', 'textbook.md', '[]');
      insert.run('olympiad', '奥数资料', '数学', 'child_1', '考试真题', '["奥数"]', 'completed', 'olympiad.md', '[]');
      const candidates = await fetch(base.replace('/users', '/assistant/source-papers?ownerId=child_1')).then(r => r.json()) as any;
      assert.equal(candidates.success, true);
      assert.deepEqual(candidates.data.map((x: any) => x.id).sort(), ['chinese-4', 'english-4', 'english-5', 'math-4']);
      for (const paper of candidates.data) {
        const response = await fetch(base.replace('/users', `/assistant/books/${paper.id}/chapters/c1/actions?ownerId=child_1`));
        assert.equal(response.status, 400);
        assert.match((await response.json() as any).error, /母卷出题/);
      }
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    db.close(); await rm(directory, { recursive: true, force: true });
  }
});
