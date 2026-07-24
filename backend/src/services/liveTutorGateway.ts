import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import db from './databaseService.js';
import {
  decodeRealtimeFrame,
  encodeRealtimeAudio,
  encodeRealtimeJson,
  parseRealtimeJson,
  REALTIME_MESSAGE_TYPE,
  isRealtimeAck,
  toRealtimeBuffer,
} from './doubaoRealtimeProtocol.js';

const REALTIME_URL = 'wss://openspeech.bytedance.com/api/v3/realtime/dialogue';
const START_CONNECTION = 1;
const START_SESSION = 100;
const FINISH_SESSION = 102;
const CLIENT_INTERRUPT = 515;
const ASR_INFO = 450;
const ASR_RESPONSE = 451;
const ASR_ENDED = 459;
const CHAT_RESPONSE = 550;
const TTS_RESPONSE = 352;

interface RealtimeConfig {
  appId: string;
  accessToken: string;
  appKey: string;
  resourceId: string;
  model: string;
  maxSessions: number;
  maxSessionMs: number;
  maxFramesPerSecond: number;
  vadEndSmoothWindowMs: number;
}

interface BrowserEvent {
  type: 'session_started' | 'audio' | 'transcript' | 'interrupted' | 'vad_ended' | 'error' | 'closed';
  side?: 'user' | 'tutor';
  text?: string;
  data?: string;
  code?: string;
}

function readPositiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function getRealtimeConfig(): RealtimeConfig | null {
  if (process.env.LIVE_TUTOR_DOUBAO_ENABLED !== 'true') return null;
  const appId = process.env.DOUBAO_REALTIME_APP_ID || '';
  const accessToken = process.env.DOUBAO_REALTIME_ACCESS_TOKEN || '';
  const appKey = process.env.DOUBAO_REALTIME_APP_KEY || '';
  const resourceId = process.env.DOUBAO_REALTIME_RESOURCE_ID || '';
  if (!appId || !accessToken || !appKey || !resourceId) return null;
  return {
    appId,
    accessToken,
    appKey,
    resourceId,
    model: process.env.DOUBAO_REALTIME_MODEL || '1.2.1.1',
    maxSessions: readPositiveInteger('DOUBAO_REALTIME_MAX_SESSIONS', 3),
    maxSessionMs: readPositiveInteger('DOUBAO_REALTIME_MAX_SESSION_MS', 20 * 60 * 1000),
    maxFramesPerSecond: readPositiveInteger('DOUBAO_REALTIME_MAX_FRAMES_PER_SECOND', 80),
    vadEndSmoothWindowMs: readPositiveInteger('DOUBAO_REALTIME_VAD_END_SMOOTH_WINDOW_MS', 700),
  };
}

function isExistingUser(ownerId: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM users WHERE id = ?').get(ownerId));
}

function tutorRole(ownerName: string, grade: string | null): string {
  return `你是一位全能 AI 家庭导师，正在为${ownerName}（${grade || '当前年级'}）提供辅导。语气热情、专业、有启发性。遇到题目时通过引导思考帮助学生，不直接给答案。保持简短有力的语音反馈。`;
}

function eventText(payload: Record<string, unknown>): string {
  const result = payload.result as Record<string, unknown> | undefined;
  return String(payload.text || payload.content || result?.text || result?.content || '');
}

function sendBrowser(socket: WebSocket, event: BrowserEvent) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
}

/**
 * 后端代理让供应商凭据始终留在服务端；ownerId 仅是用户已确认的内网临时识别，
 * 因此仍校验 users 表存在并限制会话与帧率，避免任意连接消耗语音额度。
 */
export function attachLiveTutorGateway(server: HttpServer) {
  const gateway = new WebSocketServer({ noServer: true });
  let activeSessions = 0;
  const owners = new Set<string>();

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (url.pathname !== '/api/live-tutor') return;
    gateway.handleUpgrade(request, socket, head, client => gateway.emit('connection', client, request));
  });

  gateway.on('connection', (client: WebSocket, request: IncomingMessage) => {
    const config = getRealtimeConfig();
    const ownerId = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`).searchParams.get('ownerId') || '';
    if (!config) {
      sendBrowser(client, { type: 'error', code: 'live_tutor_unavailable', text: '实时导师尚未配置或未启用' });
      client.close(1013);
      return;
    }
    if (!ownerId || !isExistingUser(ownerId)) {
      sendBrowser(client, { type: 'error', code: 'invalid_owner', text: '当前用户不存在，请刷新后重试' });
      client.close(1008);
      return;
    }
    if (activeSessions >= config.maxSessions || owners.has(ownerId)) {
      sendBrowser(client, { type: 'error', code: 'session_limit', text: '导师正在服务其他会话，请稍后重试' });
      client.close(1013);
      return;
    }

    const owner = db.prepare('SELECT name, baseGrade FROM users WHERE id = ?').get(ownerId) as { name: string; baseGrade: number | null };
    const sessionId = randomUUID();
    const ownerHash = createHash('sha256').update(ownerId).digest('hex').slice(0, 12);
    activeSessions++;
    owners.add(ownerId);
    let closed = false;
    let frameWindowStartedAt = Date.now();
    let framesInWindow = 0;
    const startedAt = Date.now();
    const timeout = setTimeout(() => finish('session_timeout', '本次辅导已达到时长上限，请重新开始'), config.maxSessionMs);
    const upstream = new WebSocket(REALTIME_URL, {
      headers: {
        'X-Api-App-ID': config.appId,
        'X-Api-Access-Key': config.accessToken,
        'X-Api-Resource-Id': config.resourceId,
        'X-Api-App-Key': config.appKey,
        'X-Api-Connect-Id': sessionId,
      },
    });

    function finish(code?: string, text?: string) {
      if (closed) return;
      closed = true;
      clearTimeout(timeout);
      activeSessions--;
      owners.delete(ownerId);
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(encodeRealtimeJson(FINISH_SESSION, sessionId, {}));
        upstream.close();
      }
      if (code) sendBrowser(client, { type: 'error', code, text });
      sendBrowser(client, { type: 'closed' });
      if (client.readyState === WebSocket.OPEN) client.close();
      console.info(`[LiveTutor] session=${sessionId.slice(0, 8)} owner=${ownerHash} durationMs=${Date.now() - startedAt} code=${code || 'closed'}`);
    }

    upstream.on('open', () => {
      upstream.send(encodeRealtimeJson(START_CONNECTION, sessionId, {}));
      upstream.send(encodeRealtimeJson(START_SESSION, sessionId, {
        asr: { extra: { end_smooth_window_ms: config.vadEndSmoothWindowMs } },
        tts: { audio_config: { channel: 1, format: 'pcm_s16le', sample_rate: 24000 } },
        dialog: {
          bot_name: '家庭导师',
          system_role: tutorRole(owner.name, owner.baseGrade ? `${owner.baseGrade} 年级` : null),
          speaking_style: '热情、专业、富有启发性',
          extra: { model: config.model, enable_volc_websearch: false },
        },
      }));
    });
    upstream.on('message', raw => {
      const data = toRealtimeBuffer(raw);
      try {
        if (isRealtimeAck(data)) return;
        const frame = decodeRealtimeFrame(data);
        if (frame.messageType === REALTIME_MESSAGE_TYPE.SERVER_AUDIO && frame.event === TTS_RESPONSE) {
          sendBrowser(client, { type: 'audio', data: frame.payload.toString('base64') });
          return;
        }
        const payload = parseRealtimeJson(frame);
        if (frame.event === ASR_INFO) sendBrowser(client, { type: 'interrupted' });
        if (frame.event === ASR_RESPONSE) sendBrowser(client, { type: 'transcript', side: 'user', text: eventText(payload) });
        if (frame.event === CHAT_RESPONSE) sendBrowser(client, { type: 'transcript', side: 'tutor', text: eventText(payload) });
        if (frame.event === ASR_ENDED) sendBrowser(client, { type: 'vad_ended' });
        if (frame.event === 150) sendBrowser(client, { type: 'session_started' });
        if (frame.messageType === REALTIME_MESSAGE_TYPE.ERROR) {
          const errorPayload = parseRealtimeJson(frame);
          const detail = String(errorPayload.message || errorPayload.error || errorPayload.msg || '')
            .replace(/((?:access[_-]?(?:token|key)|app[_-]?key|authorization|secret|token|api[_-]?key)\s*[:=]\s*)[^,\s"'}]+/gi, '$1[redacted]')
            .slice(0, 300);
          console.warn(`[LiveTutor] upstream rejected request errorCode=${frame.event ?? 'unknown'} payloadLength=${frame.payload.length} detail=${JSON.stringify(detail)}`);
          finish('upstream_error', '实时导师暂时不可用，请稍后重试');
          return;
        }
        if (frame.event === 153 || frame.event === 599) {
          finish('upstream_error', '实时导师暂时不可用，请稍后重试');
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'unknown';
        console.warn(`[LiveTutor] upstream protocol error length=${data.length} header=${data.subarray(0, 4).toString('hex')} reason=${reason}`);
        finish('protocol_error', '实时导师返回了无法处理的数据');
      }
    });
    upstream.on('error', () => finish('upstream_connect_failed', '无法连接实时导师，请稍后重试'));
    upstream.on('close', () => finish());
    client.on('message', (audio, isBinary) => {
      if (!isBinary || closed || upstream.readyState !== WebSocket.OPEN) return;
      const now = Date.now();
      if (now - frameWindowStartedAt >= 1000) {
        frameWindowStartedAt = now;
        framesInWindow = 0;
      }
      if (++framesInWindow > config.maxFramesPerSecond) {
        finish('audio_rate_limited', '音频发送过快，请重新开始辅导');
        return;
      }
      upstream.send(encodeRealtimeAudio(sessionId, Buffer.from(audio as Buffer)));
    });
    client.on('close', () => finish());
    client.on('error', () => finish());
  });

  return gateway;
}
