export const REALTIME_MESSAGE_TYPE = {
  CLIENT_JSON: 0b0001,
  CLIENT_AUDIO: 0b0010,
  SERVER_JSON: 0b1001,
  SERVER_ACK: 0b1010,
  SERVER_AUDIO: 0b1011,
  ERROR: 0b1111,
} as const;

const HEADER_SIZE = 4;
const PROTOCOL_VERSION = 1;
const EVENT_FLAG = 0b0100;
const JSON_SERIALIZATION = 1;

export interface RealtimeFrame {
  messageType: number;
  event?: number;
  sessionId?: string;
  payload: Buffer;
  serialization: number;
}

export type RealtimeWireData = Buffer | ArrayBuffer | Buffer[];

export function toRealtimeBuffer(data: RealtimeWireData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(new Uint8Array(data));
}

// ACK 仅确认传输顺序，不带业务 sessionId，不能走完整业务帧解码。
export function isRealtimeAck(data: Buffer): boolean {
  return data.length >= HEADER_SIZE && (data[1] >> 4) === REALTIME_MESSAGE_TYPE.SERVER_ACK;
}

function appendUint32(parts: Buffer[], value: number) {
  const field = Buffer.allocUnsafe(4);
  field.writeUInt32BE(value);
  parts.push(field);
}

/**
 * 豆包实时协议在 event 后固定携带 sessionId。
 * 统一编码在这里可避免网关和测试分别处理字节序而产生兼容性偏差。
 */
export function encodeRealtimeFrame(frame: RealtimeFrame): Buffer {
  const sessionId = Buffer.from(frame.sessionId || '', 'utf8');
  const payload = Buffer.from(frame.payload);
  const header = Buffer.from([
    (PROTOCOL_VERSION << 4) | HEADER_SIZE,
    (frame.messageType << 4) | (frame.event === undefined ? 0 : EVENT_FLAG),
    (frame.serialization << 4),
    0,
  ]);
  const parts = [header];

  if (frame.event !== undefined) appendUint32(parts, frame.event);
  appendUint32(parts, sessionId.length);
  parts.push(sessionId);
  appendUint32(parts, payload.length);
  parts.push(payload);
  return Buffer.concat(parts);
}

export function encodeRealtimeJson(event: number, sessionId: string, body: unknown): Buffer {
  return encodeRealtimeFrame({
    messageType: REALTIME_MESSAGE_TYPE.CLIENT_JSON,
    event,
    sessionId,
    payload: Buffer.from(JSON.stringify(body)),
    serialization: JSON_SERIALIZATION,
  });
}

export function encodeRealtimeAudio(sessionId: string, audio: Buffer): Buffer {
  return encodeRealtimeFrame({
    messageType: REALTIME_MESSAGE_TYPE.CLIENT_AUDIO,
    event: 200,
    sessionId,
    payload: audio,
    serialization: 0,
  });
}

export function decodeRealtimeFrame(data: Buffer): RealtimeFrame {
  if (data.length < HEADER_SIZE + 8) throw new Error('Realtime frame is too short');
  const version = data[0] >> 4;
  const headerSize = data[0] & 0x0f;
  if (version !== PROTOCOL_VERSION || headerSize !== HEADER_SIZE) {
    throw new Error('Unsupported realtime protocol header');
  }

  const messageType = data[1] >> 4;
  const hasEvent = (data[1] & EVENT_FLAG) !== 0;
  const serialization = data[2] >> 4;
  let offset = HEADER_SIZE;
  if (messageType === REALTIME_MESSAGE_TYPE.ERROR) {
    const errorCode = data.readUInt32BE(offset);
    offset += 4;
    const payloadSize = data.readUInt32BE(offset);
    offset += 4;
    if (data.length !== offset + payloadSize) throw new Error('Realtime error payload is invalid');
    return { messageType, event: errorCode, payload: data.subarray(offset), serialization };
  }
  let event: number | undefined;
  if (hasEvent) {
    if (data.length < offset + 4) throw new Error('Realtime frame event is incomplete');
    event = data.readUInt32BE(offset);
    offset += 4;
  }
  if (data.length < offset + 4) throw new Error('Realtime frame session id is incomplete');
  const sessionIdSize = data.readUInt32BE(offset);
  offset += 4;
  if (data.length < offset + sessionIdSize + 4) throw new Error('Realtime frame session id is invalid');
  const sessionId = data.subarray(offset, offset + sessionIdSize).toString('utf8');
  offset += sessionIdSize;
  const payloadSize = data.readUInt32BE(offset);
  offset += 4;
  if (data.length !== offset + payloadSize) throw new Error('Realtime frame payload is invalid');

  return { messageType, event, sessionId, payload: data.subarray(offset), serialization };
}

export function parseRealtimeJson(frame: RealtimeFrame): Record<string, unknown> {
  if (frame.serialization !== JSON_SERIALIZATION) return {};
  try {
    return JSON.parse(frame.payload.toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}
