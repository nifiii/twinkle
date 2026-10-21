import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyzeSourcePaperVision, assertEvidenceGeneratable, SourcePaperVisionError } from '../src/services/sourcePaperVisionService.js';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'twinkle-source-paper-test-'));
  const pdf = path.join(root, 'originals', 'papers', 'paper.pdf');
  await fs.mkdir(path.dirname(pdf), { recursive: true });
  await fs.writeFile(pdf, 'fixture');
  return { root, pdf };
}

test('rejects a source-paper path outside the configured data volume', async () => {
  const { root } = await fixture();
  await assert.rejects(() => analyzeSourcePaperVision(path.join(os.tmpdir(), 'outside.pdf'), {
    dataDir: root,
    renderPages: async () => ['p1.jpg'],
    analyzePage: async () => ({ sections: [] }),
  }), (error: unknown) => error instanceof SourcePaperVisionError && error.code === 'unsafe_path');
});

test('merges page-level visual evidence and removes temporary rendered pages', async () => {
  const { root, pdf } = await fixture();
  const seen: string[] = [];
  const evidence = await analyzeSourcePaperVision(pdf, {
    dataDir: root,
    renderPages: async (source, output) => {
      assert.equal(source, pdf);
      await fs.writeFile(path.join(output, 'p1.jpg'), 'image');
      await fs.writeFile(path.join(output, 'p2.jpg'), 'image');
      return ['p1.jpg', 'p2.jpg'];
    },
    analyzePage: async input => {
      seen.push(input.imagePath);
      return input.page === 1
        ? { sections: [{ title: '听力', questionRange: '1-5', responseType: 'listening', requiresMaterial: true, requiresVisual: false, requiresAudio: true, requiresDrawing: false }], issues: [] }
        : { assets: [{ type: 'diagram', page: 2, bbox: [1, 2, 30, 40], questionNumbers: ['21'], description: '原创分析用图形证据', confidence: 0.95 }], issues: [] };
    },
  });
  assert.equal(evidence.pages, 2);
  assert.equal(evidence.sections[0].requiresAudio, true);
  assert.equal(evidence.assets[0].page, 2);
  assert.equal(seen.length, 2);
  await assert.rejects(() => fs.access(path.dirname(seen[0])));
});

test('blocks incomplete drawing/audio evidence before generation', () => {
  assert.throws(() => assertEvidenceGeneratable({
    pages: 1,
    sections: [{ title: '阅读', questionRange: '1-2', responseType: 'essay', requiresMaterial: true, requiresVisual: true, requiresAudio: false, requiresDrawing: true }],
    assets: [],
    issues: [],
  }), (error: unknown) => error instanceof SourcePaperVisionError && error.code === 'invalid_evidence');
});
