import assert from 'node:assert/strict';
import test from 'node:test';
import { requireArkContent } from '../src/services/arkModelPolicy.js';

test('accepts complete JSON arrays and Markdown without changing their contract', () => {
  for (const content of ['[{"question":"1 + 1 = ?"}]', '# Lesson\nA complete explanation.']) {
    assert.equal(requireArkContent({ choices: [{ finish_reason: 'stop', message: { content } }] }), content);
  }
});

test('rejects truncated but syntactically valid JSON and empty or filtered responses', () => {
  for (const finish_reason of ['length', 'content_filter', 'tool_calls', null, undefined]) {
    assert.throws(() => requireArkContent({ choices: [{ finish_reason, message: { content: '[]' } }] }), /未完整/);
  }
  assert.throws(() => requireArkContent({ choices: [] }), /未完整/);
  for (const content of [null, '', '   ']) {
    assert.throws(() => requireArkContent({ choices: [{ finish_reason: 'stop', message: { content } }] }), /空内容/);
  }
});
