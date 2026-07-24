import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeRealtimeFrame,
  encodeRealtimeAudio,
  encodeRealtimeJson,
  parseRealtimeJson,
  REALTIME_MESSAGE_TYPE,
  isRealtimeAck,
  toRealtimeBuffer,
} from '../src/services/doubaoRealtimeProtocol.js';

test('encodes connection frames without a binary id', () => {
  const encoded = encodeRealtimeJson(1, {});
  assert.deepEqual(encoded.subarray(0, 4), Buffer.from([0x11, 0x14, 0x10, 0x00]));
  assert.deepEqual(encoded, Buffer.from([0x11, 0x14, 0x10, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x02, 0x7b, 0x7d]));
  assert.equal(encoded.readUInt32BE(8), encoded.length - 12);
  const decoded = decodeRealtimeFrame(encoded);
  assert.equal(decoded.messageType, REALTIME_MESSAGE_TYPE.CLIENT_JSON);
  assert.equal(decoded.event, 1);
  assert.deepEqual(parseRealtimeJson(decoded), {});
});

test('encodes and decodes session JSON frames with a binary session id', () => {
  const encoded = encodeRealtimeJson(100, { dialog: { bot_name: '家庭导师' } }, 'session-1');
  const decoded = decodeRealtimeFrame(encoded);
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
  frame.set([0x11, 0xf0, 0x10, 0x00]);
  frame.writeUInt32BE(401, 4);
  frame.writeUInt32BE(payload.length, 8);
  payload.copy(frame, 12);
  const decoded = decodeRealtimeFrame(frame);
  assert.equal(decoded.messageType, REALTIME_MESSAGE_TYPE.ERROR);
  assert.equal(decoded.event, 401);
  assert.deepEqual(decoded.payload, payload);
});

test('normalizes every ws RawData representation before decoding', () => {
  const bytes = Buffer.from([0x11, 0x22, 0x33, 0x44]);
  assert.deepEqual(toRealtimeBuffer(bytes), bytes);
  assert.deepEqual(toRealtimeBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), bytes);
  assert.deepEqual(toRealtimeBuffer([bytes.subarray(0, 2), bytes.subarray(2)]), bytes);
});

test('identifies server acknowledgements before business-frame decoding', () => {
  assert.equal(isRealtimeAck(Buffer.from([0x11, 0xa0, 0x00, 0x00])), true);
  assert.equal(isRealtimeAck(Buffer.from([0x11, 0x90, 0x10, 0x00])), false);
});

test('decodes server session-start frames with a binary session id', () => {
  const payload = Buffer.from('{}');
  const sessionId = Buffer.from('12345678-1234-1234-1234-123456789012');
  const frame = Buffer.alloc(16 + sessionId.length + payload.length);
  frame.set([0x11, 0x94, 0x10, 0x00]);
  frame.writeUInt32BE(150, 4);
  frame.writeUInt32BE(sessionId.length, 8);
  sessionId.copy(frame, 12);
  frame.writeUInt32BE(payload.length, 12 + sessionId.length);
  payload.copy(frame, 16 + sessionId.length);
  const decoded = decodeRealtimeFrame(frame);
  assert.equal(decoded.messageType, REALTIME_MESSAGE_TYPE.SERVER_JSON);
  assert.equal(decoded.event, 150);
  assert.equal(decoded.sessionId, sessionId.toString('utf8'));
  assert.deepEqual(decoded.payload, payload);
});

test('decodes a ConnectionStarted frame that includes the optional connect id', () => {
  const payload = Buffer.from('{}');
  const connectId = Buffer.from('12345678-1234-1234-1234-123456789012');
  const frame = Buffer.alloc(16 + connectId.length + payload.length);
  frame.set([0x11, 0x94, 0x10, 0x00]);
  frame.writeUInt32BE(50, 4);
  frame.writeUInt32BE(connectId.length, 8);
  connectId.copy(frame, 12);
  frame.writeUInt32BE(payload.length, 12 + connectId.length);
  payload.copy(frame, 16 + connectId.length);

  const decoded = decodeRealtimeFrame(frame);
  assert.equal(frame.length, 54);
  assert.equal(decoded.event, 50);
  assert.equal(decoded.connectId, connectId.toString('utf8'));
  assert.deepEqual(parseRealtimeJson(decoded), {});
});
