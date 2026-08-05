import { Router, Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import db from '../services/databaseService.js';
import {
  CONTROLLED_RATE_SPEEDS,
  ControlledRateSpeed,
  ControlledRateTtsAdapter,
  ControlledRateTtsError,
} from '../services/controlledRateTtsAdapter.js';

const DATA_DIR = process.env.DATA_DIR || '/opt/twinkle/data';
const TTS_CACHE_DIR = path.join(DATA_DIR, 'tts_cache');

function ensureCacheDir(coursewareId: string): string {
  const dir = path.join(TTS_CACHE_DIR, coursewareId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readCachedAudio(coursewareId: string, chunkIdx: number): string | null {
  try {
    const filePath = path.join(TTS_CACHE_DIR, coursewareId, `${chunkIdx}.mp3`);
    return fs.existsSync(filePath) ? fs.readFileSync(filePath).toString('base64') : null;
  } catch {
    return null;
  }
}

function writeCachedAudio(coursewareId: string, chunkIdx: number, audio: Buffer): void {
  try {
    fs.writeFileSync(path.join(ensureCacheDir(coursewareId), `${chunkIdx}.mp3`), audio);
  } catch (error: any) {
    console.warn(`[TTS] 缓存写入失败 coursewareId=${coursewareId} chunkIdx=${chunkIdx}:`, error.message);
  }
}

// V3 returns adjacent JSON frames. Braces inside base64/string data must not split a frame.
export function parseJsonFrames(input: string): any[] {
  const frames: any[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let index = 0; index < input.length; index++) {
    const character = input[index];
    if (inString) {
      if (escape) escape = false;
      else if (character === '\\') escape = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{') {
      if (depth === 0) start = index;
      depth++;
    } else if (character === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          frames.push(JSON.parse(input.slice(start, index + 1)));
        } catch (error: any) {
          console.warn('[TTS] 跳过损坏帧:', error.message);
        }
        start = -1;
      }
    }
  }
  return frames;
}

class TtsProviderError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'TtsProviderError';
  }
}

function configuredVoiceProfile(): { resourceId: string; cluster: string; voiceType: string; fingerprint: string } {
  const resourceId = process.env.VOLCANO_TTS_RESOURCE_ID || 'seed-tts-2.0';
  const cluster = process.env.VOLCANO_TTS_CLUSTER || 'volcano_mega';
  const voiceType = process.env.VOLCANO_TTS_VOICE_TYPE || 'zh_female_shuangkuai_emo_bigtts';
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ resourceId, cluster, voiceType, apiVersion: 'v3' }))
    .digest('hex');
  return { resourceId, cluster, voiceType, fingerprint };
}

export async function synthesizeVolcanoTtsAudio(text: string): Promise<Buffer> {
  const apiKey = process.env.VOLCANO_TTS_API_KEY;
  if (!apiKey) throw new TtsProviderError(503, 'TTS 服务未配置，请在 .env 中设置 VOLCANO_TTS_API_KEY');
  const voice = configuredVoiceProfile();
  try {
    const response = await axios.post(
      'https://openspeech.bytedance.com/api/v3/tts/unidirectional',
      {
        user: { uid: 'twinkle_user' },
        namespace: 'BidirectionalTTS',
        req_params: {
          text: text.substring(0, 1000),
          speaker: voice.voiceType,
          audio_params: { format: 'mp3', sample_rate: 24000 },
        },
      },
      {
        headers: {
          'X-Api-Key': apiKey,
          'X-Api-Resource-Id': voice.resourceId,
          'Content-Type': 'application/json',
        },
        responseType: 'arraybuffer',
        timeout: 30_000,
      },
    );
    const frames = parseJsonFrames(Buffer.from(response.data).toString('utf8'));
    if (frames.length === 0) throw new TtsProviderError(500, 'TTS 服务返回空响应');
    const errorFrame = frames.find(frame => frame && frame.code !== 0 && frame.code !== 20000000);
    if (errorFrame) throw new TtsProviderError(500, `TTS 服务错误: ${errorFrame.message || `code=${errorFrame.code}`}`);
    const audio = Buffer.concat(frames
      .filter(frame => typeof frame?.data === 'string' && frame.data.length > 0)
      .map(frame => Buffer.from(frame.data, 'base64')));
    if (!audio.length) throw new TtsProviderError(500, 'TTS 服务未返回音频数据');
    return audio;
  } catch (error: any) {
    if (error instanceof TtsProviderError) throw error;
    if (error.response) {
      if (error.response.status === 401 || error.response.status === 403) {
        throw new TtsProviderError(403, 'TTS 认证失败，请检查 VOLCANO_TTS_API_KEY');
      }
      const frames = parseJsonFrames(Buffer.from(error.response.data).toString('utf8'));
      const message = frames.find(frame => frame?.message)?.message || `HTTP ${error.response.status}`;
      throw new TtsProviderError(500, `TTS 服务错误: ${message}`);
    }
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') throw new TtsProviderError(504, 'TTS 请求超时，请重试');
    throw error;
  }
}

function isControlledRateSpeed(value: unknown): value is ControlledRateSpeed {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CONTROLLED_RATE_SPEEDS, value);
}

function readListeningScript(packageId: string): string | null {
  const row = db.prepare('SELECT kind, contentJson FROM learning_packages WHERE id = ?').get(packageId) as { kind: string; contentJson: string } | undefined;
  if (!row || row.kind !== 'english-listening') return null;
  try {
    const content = JSON.parse(row.contentJson) as { listening?: { script?: unknown } };
    return typeof content.listening?.script === 'string' ? content.listening.script : null;
  } catch {
    return null;
  }
}

interface TtsRouterDependencies {
  synthesizeAudio?: (text: string) => Promise<Buffer>;
  getListeningScript?: (packageId: string) => string | null;
  controlledRateAdapter?: Pick<ControlledRateTtsAdapter, 'getAudio'>;
}

function sendProviderError(res: Response, error: unknown, next: NextFunction): void {
  if (error instanceof TtsProviderError) {
    res.status(error.status).json({ success: false, error: error.message });
    return;
  }
  next(error);
}

/**
 * The no-speed branch deliberately retains the established courseware cache
 * identity. Only a listening package that explicitly requests a fixed speed
 * enters the server-side renderer.
 */
export function createTtsRouter(dependencies: TtsRouterDependencies = {}): Router {
  const router = Router();
  const synthesizeAudio = dependencies.synthesizeAudio || synthesizeVolcanoTtsAudio;
  const getListeningScript = dependencies.getListeningScript || readListeningScript;
  const controlledRateAdapter = dependencies.controlledRateAdapter || new ControlledRateTtsAdapter({
    cacheDirectory: path.join(TTS_CACHE_DIR, 'english-listening'),
    voiceProfileFingerprint: configuredVoiceProfile().fingerprint,
    synthesizeBaseAudio: synthesizeAudio,
  });

  router.post('/tts', async (req: Request, res: Response, next: NextFunction) => {
    const { text, coursewareId, chunkIdx, speed } = req.body || {};
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ success: false, error: '缺少 text 参数' });
    }

    if (speed !== undefined) {
      if (!isControlledRateSpeed(speed)) {
        return res.status(400).json({ success: false, errorCode: 'invalid_audio_speed', error: '仅支持慢速、标准、加快三档语速' });
      }
      if (typeof coursewareId !== 'string' || !coursewareId.trim()) {
        return res.status(400).json({ success: false, errorCode: 'invalid_audio_speed', error: '受控速度只支持英语听力包' });
      }
      const script = getListeningScript(coursewareId);
      if (!script || script.trim() !== text.trim()) {
        return res.status(400).json({ success: false, errorCode: 'invalid_audio_speed', error: '受控速度只支持当前英语听力原稿' });
      }
      try {
        const result = await controlledRateAdapter.getAudio({ packageId: coursewareId, script, speed });
        return res.json({
          success: true,
          audio: result.audio.toString('base64'),
          encoding: 'mp3',
          cached: result.cached,
          speed: result.speed,
          renderer: result.renderer,
          cacheKeyVersion: result.cacheKeyVersion,
        });
      } catch (error) {
        if (error instanceof ControlledRateTtsError) {
          console.error(`[TTS] 受控速度失败 speed=${speed}:`, error.message);
          return res.status(502).json({ success: false, errorCode: 'tts_speed_unavailable', error: '当前语速音频暂不可用，请稍后重试' });
        }
        return sendProviderError(res, error, next);
      }
    }

    const hasCacheKey = typeof coursewareId === 'string' && typeof chunkIdx === 'number';
    if (hasCacheKey) {
      const cached = readCachedAudio(coursewareId, chunkIdx);
      if (cached) return res.json({ success: true, audio: cached, encoding: 'mp3', cached: true });
    }
    if (!process.env.VOLCANO_TTS_API_KEY) {
      return res.status(200).json({ success: false, fallback: true, error: 'TTS 服务未配置，请在 .env 中设置 VOLCANO_TTS_API_KEY', text });
    }
    try {
      const audio = await synthesizeAudio(text);
      if (hasCacheKey) writeCachedAudio(coursewareId, chunkIdx, audio);
      return res.json({ success: true, audio: audio.toString('base64'), encoding: 'mp3' });
    } catch (error) {
      return sendProviderError(res, error, next);
    }
  });

  router.post('/tts/merge', (req: Request, res: Response) => {
    const { coursewareId, totalChunks } = req.body || {};
    if (!coursewareId || typeof coursewareId !== 'string' || typeof totalChunks !== 'number' || totalChunks <= 0) {
      return res.status(400).json({ success: false, error: '参数错误：需要 coursewareId 和 totalChunks' });
    }
    const cacheDir = path.join(TTS_CACHE_DIR, coursewareId);
    const completeFile = path.join(cacheDir, 'complete.mp3');
    if (fs.existsSync(completeFile)) return res.json({ success: true, alreadyExists: true });
    const chunks: Buffer[] = [];
    for (let index = 0; index < totalChunks; index++) {
      const chunkFile = path.join(cacheDir, `${index}.mp3`);
      if (!fs.existsSync(chunkFile)) return res.status(409).json({ success: false, error: `分片 ${index} 尚未缓存，合并中止`, missingChunk: index });
      chunks.push(fs.readFileSync(chunkFile));
    }
    try {
      fs.writeFileSync(completeFile, Buffer.concat(chunks));
      return res.json({ success: true });
    } catch (error) {
      console.error('[TTS] 合并写入失败:', error);
      return res.status(500).json({ success: false, error: '合并写入失败' });
    }
  });

  return router;
}

export default createTtsRouter();
