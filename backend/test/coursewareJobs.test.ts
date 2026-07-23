import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import db, { initDatabase } from '../src/services/databaseService.js';
import { mergeCoursewareExtension, normalizeCoreSlides, saveCoreCourseware } from '../src/services/coursewareJobs.js';

const coreSlides = Array.from({ length: 5 }, (_, index) => ({
  index: index + 1,
  chapter: '文明有礼貌',
  title: index === 4 ? '课程小结' : `核心知识 ${index + 1}`,
  content: '核心内容'.repeat(24),
  notes: '',
}));

test('keeps the saved core readable when extension generation fails, then updates the same courseware', () => {
  initDatabase();
  const ownerId = `courseware-test-${randomUUID()}`;
  const coursewareId = randomUUID();
  try {
    saveCoreCourseware({
      bookTitle: '体育与健康', chapter: '文明有礼貌', studentName: '测试学生', subject: '体育', ownerId,
    }, coreSlides, coursewareId);

    const core = db.prepare('SELECT contentJson FROM classroom_items WHERE id = ? AND ownerId = ?').get(coursewareId, ownerId) as { contentJson: string };
    assert.equal(JSON.parse(core.contentJson).length, 5);
    assert.throws(() => mergeCoursewareExtension(coursewareId, ownerId, [{ index: 1, extension: '缺少其余节' }]));
    assert.deepEqual(JSON.parse((db.prepare('SELECT contentJson FROM classroom_items WHERE id = ?').get(coursewareId) as { contentJson: string }).contentJson), coreSlides);

    const extended = mergeCoursewareExtension(coursewareId, ownerId, coreSlides.map(slide => ({
      index: slide.index, extension: `针对第 ${slide.index} 节的详细解释和错题例子`, notes: `第 ${slide.index} 节讲稿`,
    })));
    assert.equal(extended.length, 5);
    assert.match(extended[0].content, /延伸讲解/);
    assert.equal(extended[0].notes, '第 1 节讲稿');
  } finally {
    db.prepare('DELETE FROM classroom_items WHERE id = ?').run(coursewareId);
  }
});

test('pads only near-boundary core text and still rejects incomplete output', () => {
  const payload = { bookTitle: '体育与健康', chapter: '文明有礼貌', studentName: '测试学生', ownerId: 'test-owner' };
  const nearBoundary = coreSlides.map((slide, index) => ({ ...slide, content: '核心内容'.repeat(index === 0 ? 28 : 30) }));
  const normalized = normalizeCoreSlides(payload, nearBoundary);
  assert.ok(normalized[0].content.length >= 120);
  assert.ok(normalized.every(slide => slide.content.length <= 180));
  assert.throws(() => normalizeCoreSlides(payload, nearBoundary.map(slide => ({ ...slide, content: '过短' }))));
});
