import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAssessmentIllustration } from '../src/utils/assessmentIllustration.js';
import { createReviewItems } from '../src/services/answerReviewService.js';
import { renderAssessmentPdf } from '../src/services/exportService.js';

const illustration = { description: '三个原创圆形', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 240"><circle cx="80" cy="100" r="20" fill="#2563eb"/><circle cx="160" cy="100" r="20"/><circle cx="240" cy="100" r="20"/></svg>' };

test('only static self contained drawings enter paper snapshots', () => {
  assert.deepEqual(normalizeAssessmentIllustration(illustration), illustration);
  for (const body of ['<script>alert(1)</script>', '<image href="https://example.org/a.png"/>', '<rect onclick="alert(1)"/>', '<path fill="url(#x)"/>', '<g>', '<foreignObject/>']) {
    assert.throws(() => normalizeAssessmentIllustration({ ...illustration, svg: illustration.svg.replace('</svg>', `${body}</svg>`) }));
  }
  const items = createReviewItems([{ id: 'q1', stem: 'How many circles?', illustration, answer: 'Three', explanation: 'Count the circles.' }], { q1: 'Three' });
  assert.deepEqual(items[0].illustration, illustration);
  assert.equal(items[0].studentAnswer, 'Three');
});

test('paper and answer PDFs preserve original SVG visual questions', async () => {
  const paper = { schemaVersion: 2, title: '原创图片题', sections: [{ title: '看图回答', questions: [{ id: 'q1', type: 'fill' as const, stem: 'How many circles?', illustration, answer: 'Three', explanation: 'Count three circles.', score: 0 }] }] };
  for (const variant of ['paper', 'answer'] as const) {
    const pdf = await renderAssessmentPdf(paper, variant, Date.now());
    assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
    assert.ok(pdf.length > 10_000);
  }
});
