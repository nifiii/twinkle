import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeRealtimeFrame,
  encodeRealtimeAudio,
  encodeRealtimeJson,
  parseRealtimeJson,
  REALTIME_MESSAGE_TYPE,
} from '../src/services/doubaoRealtimeProtocol.js';

test('encodes and decodes realtime JSON frames with event and session id', () => {
  const encoded = encodeRealtimeJson(100, 'session-1', { dialog: { bot_name: '家庭导师' } });
  const decoded = decodeRealtimeFrame(encoded);
  assert.equal(decoded.messageType, REALTIME_MESSAGE_TYPE.CLIENT_JSON);
  assert.equal(decoded.event, 100);
  assert.equal(decoded.sessionId, 'session-1');
  assert.deepEqual(parseRealtimeJson(decoded), { dialog: { bot_name: '家庭导师' } });
});

test('encodes audio as a TaskRequest without changing PCM bytes', () => {
  const audio = Buffer.from([0x00, 0x80, 0xff, 0x7f]);
  const decoded = decodeRealtimeFrame(encodeRealtimeAudio('session-1', audio));
  assert.equal(decoded.messageType, REALTIME_MESSAGE_TYPE.CLIENT_AUDIO);
  assert.equal(decoded.event, 200);
  assert.deepEqual(decoded.payload, audio);
});

test('decodes server error frames without expecting a session id', () => {
  const payload = Buffer.from('{"message":"invalid credential"}');
  const frame = Buffer.alloc(12 + payload.length);
  frame.set([0x14, 0xf0, 0x10, 0x00]);
  frame.writeUInt32BE(401, 4);
  frame.writeUInt32BE(payload.length, 8);
  payload.copy(frame, 12);
  const decoded = decodeRealtimeFrame(frame);
  assert.equal(decoded.messageType, REALTIME_MESSAGE_TYPE.ERROR);
  assert.equal(decoded.event, 401);
  assert.deepEqual(decoded.payload, payload);
});
