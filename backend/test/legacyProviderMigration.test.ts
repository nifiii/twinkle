import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import db, { initDatabase } from '../src/services/databaseService.js';

const migrationId = '2026-07-24_normalize_legacy_extraction_method';

test('normalizes the persisted legacy extraction method without changing book data', () => {
  initDatabase();
  const id = randomUUID();
  const oldValue = ['ge', 'mini'].join('');

  try {
    db.prepare('DELETE FROM _migrations WHERE id = ?').run(migrationId);
    db.prepare(`
      INSERT INTO books (id, title, subject, category, grade, ownerId, tags, extractionMethod, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, '历史图书', '数学', '教材', '三年级', 'migration-test', '[]', oldValue, 1);

    initDatabase();

    const migrated = db.prepare('SELECT title, extractionMethod FROM books WHERE id = ?').get(id) as {
      title: string;
      extractionMethod: string;
    };
    assert.deepEqual(migrated, { title: '历史图书', extractionMethod: 'legacy_ai' });
  } finally {
    db.prepare('DELETE FROM books WHERE id = ?').run(id);
    db.prepare('DELETE FROM _migrations WHERE id = ?').run(migrationId);
  }
});
