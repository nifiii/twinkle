import assert from 'node:assert/strict';
import test from 'node:test';
import { eventText } from '../src/services/liveTutorGateway.js';

test('extracts the first streaming ASR result for the user transcript', () => {
  assert.equal(eventText({
    results: [{ text: 'Please explain gravity.', is_interim: true }],
  }), 'Please explain gravity.');
});

test('keeps the existing tutor response text formats', () => {
  assert.equal(eventText({ content: 'Gravity pulls objects together.' }), 'Gravity pulls objects together.');
  assert.equal(eventText({ result: { text: 'It is a force.' } }), 'It is a force.');
});
