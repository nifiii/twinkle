import assert from 'node:assert/strict';
import test from 'node:test';
import { asrTranscript, browserTextQuery, eventText } from '../src/services/liveTutorGateway.js';

test('extracts the first streaming ASR result for the user transcript', () => {
  assert.equal(eventText({
    results: [{ text: 'Please explain gravity.', is_interim: true }],
  }), 'Please explain gravity.');
});

test('preserves the ASR interim marker for browser message reconciliation', () => {
  assert.deepEqual(asrTranscript({
    results: [{ text: '你好', is_interim: true }],
  }), { text: '你好', isInterim: true });
  assert.deepEqual(asrTranscript({
    results: [{ text: '你好', is_interim: false }],
  }), { text: '你好', isInterim: false });
});

test('accepts only bounded browser text queries', () => {
  assert.equal(browserTextQuery(Buffer.from('{"type":"text","text":"  请解释分数  "}')), '请解释分数');
  assert.equal(browserTextQuery(Buffer.from('{"type":"text","text":""}')), null);
  assert.equal(browserTextQuery(Buffer.from('{"type":"audio","text":"ignored"}')), null);
  assert.equal(browserTextQuery(Buffer.from('{"type":"text","text":"' + 'a'.repeat(2001) + '"}')), null);
});

test('keeps the existing tutor response text formats', () => {
  assert.equal(eventText({ content: 'Gravity pulls objects together.' }), 'Gravity pulls objects together.');
  assert.equal(eventText({ result: { text: 'It is a force.' } }), 'It is a force.');
});
