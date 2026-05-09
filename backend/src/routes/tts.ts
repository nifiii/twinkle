import { Router, Request, Response, NextFunction } from 'express';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

const router = Router();

// TTS 磁盘缓存目录，挂载在持久化数据卷内
// Why: 课件 ID + 分段索引唯一确定文本内容，生成一次即可永久复用
const DATA_DIR = process.env.DATA_DIR || '/opt/twinkle/data';
const TTS_CACHE_DIR = path.join(DATA_DIR, 'tts_cache');

/**
 * 确保缓存目录存在（首次调用时创建）
 */
function ensureCacheDir(coursewareId: string): string {
  const dir = path.join(TTS_CACHE_DIR, coursewareId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * 从磁盘读取缓存 MP3（返回 base64 或 null）
 */
function readCachedAudio(coursewareId: string, chunkIdx: number): string | null {
  try {
    const filePath = path.join(TTS_CACHE_DIR, coursewareId, `${chunkIdx}.mp3`);
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath).toString('base64');
  } catch {
    return null;
  }
}

/**
 * 将合成的 MP3 Buffer 写入磁盘缓存
 */
function writeCachedAudio(coursewareId: string, chunkIdx: number, buf: Buffer): void {
  try {
    const dir = ensureCacheDir(coursewareId);
    fs.writeFileSync(path.join(dir, `${chunkIdx}.mp3`), buf);
  } catch (e: any) {
    // 写入失败不阻断响应（磁盘空间不足等情况）
    console.warn(`[TTS] 缓存写入失败 coursewareId=${coursewareId} chunkIdx=${chunkIdx}:`, e.message);
  }
}

// 按花括号深度扫描，把多个顺序拼接的 JSON 对象切成独立帧。
// 必须正确处理字符串内的 { } 与转义，否则 base64 中含 } 会被误判。
// 容错：单帧 parse 失败时跳过并打印，避免一帧坏掉拖垮整段音频。
function parseJsonFrames(input: string): any[] {
  const frames: any[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        const slice = input.slice(start, i + 1);
        try {
          frames.push(JSON.parse(slice));
        } catch (e: any) {
          console.warn('[TTS] 跳过损坏帧:', e.message, 'len=', slice.length);
        }
        start = -1;
      }
    }
  }
  return frames;
}

// POST /api/tts
// 代理调用火山引擎 TTS V3 接口（HTTP unidirectional），返回 base64 音频
// 支持磁盘持久化缓存：coursewareId + chunkIdx 命中时直接返回，跳过豆包 API 调用
// 认证方式: 新版控制台 API Key，使用 X-Api-Key + X-Api-Resource-Id 两个 Header
router.post('/tts', async (req: Request, res: Response, next: NextFunction) => {
  const { text, coursewareId, chunkIdx } = req.body;

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return res.status(400).json({ success: false, error: '缺少 text 参数' });
  }

  // ── 磁盘缓存命中检查 ──────────────────────────────────────
  // 仅当 coursewareId 和 chunkIdx 都提供时才尝试缓存
  const hasCacheKey = coursewareId && typeof coursewareId === 'string' && typeof chunkIdx === 'number';
  if (hasCacheKey) {
    const cached = readCachedAudio(coursewareId, chunkIdx);
    if (cached) {
      console.log(`[TTS] 缓存命中 coursewareId=${coursewareId} chunkIdx=${chunkIdx}`);
      return res.json({ success: true, audio: cached, encoding: 'mp3', cached: true });
    }
  }

  // 新版控制台 API Key 认证：只需要 API Key，不需要 AppID
  const apiKey = process.env.VOLCANO_TTS_API_KEY;
  // Resource ID 标识使用哪个 TTS 模型版本：语音合成2.0 对应 seed-tts-2.0
  const resourceId = process.env.VOLCANO_TTS_RESOURCE_ID || 'seed-tts-2.0';
  // 语音合成2.0 大模型音色集群是 volcano_mega
  const cluster = process.env.VOLCANO_TTS_CLUSTER || 'volcano_mega';
  // 语音合成2.0 音色必须用 _bigtts 结尾；BV001_streaming 是旧版不兼容
  const voiceType = process.env.VOLCANO_TTS_VOICE_TYPE || 'zh_female_shuangkuai_emo_bigtts';

  // TTS 未配置时降级：返回标记让前端使用 Web Speech API
  if (!apiKey) {
    console.warn('[TTS] 火山引擎 TTS 未配置，降级到前端 Web Speech API');
    return res.status(200).json({
      success: false,
      fallback: true,
      error: 'TTS 服务未配置，请在 .env 中设置 VOLCANO_TTS_API_KEY',
      text  // 返回原文给前端 fallback
    });
  }

  // V3 接口单次文本限制建议 300 字以内，超出增加 badcase 概率
  const limitedText = text.substring(0, 1000);

  try {
    // V3 语音合成 2.0 (seed-tts-2.0) 专属的 JSON Payload 结构
    // 注意：与 V1 接口不同，不再使用 app/audio 嵌套，而是使用 namespace 和 req_params
    const payload = {
      user: { uid: 'twinkle_user' },
      namespace: 'BidirectionalTTS', // V3 接口强制要求的固定 namespace
      req_params: {
        text: limitedText,
        speaker: voiceType, // 音色参数名在 V3 中为 speaker，不是 voice_type
        audio_params: {
          format: 'mp3',
          sample_rate: 24000
        }
      }
    };

    // 新版 API Key 认证 Header：X-Api-Key + X-Api-Resource-Id
    // 不使用 Authorization header
    const resp = await axios.post(
      'https://openspeech.bytedance.com/api/v3/tts/unidirectional',
      payload,
      {
        headers: {
          'X-Api-Key': apiKey,
          'X-Api-Resource-Id': resourceId,
          'Content-Type': 'application/json'
        },
        responseType: 'arraybuffer',  // V3 返回二进制，必须用 arraybuffer
        timeout: 30000
      }
    );

    // V3 unidirectional 实际响应：Content-Type=text/plain，body 为多个 JSON 帧顺序拼接（NDJSON 风格）
    // 帧示例：
    //   {"code":0,"message":"","data":"<base64 mp3 chunk>"}            ← 音频帧（可能多帧）
    //   {"code":0,"data":null,"sentence":{...}}                         ← 句子元数据帧
    //   {"code":20000000,"message":"OK","data":null}                    ← 结束帧
    // 注意 base64 内可能含合法换行/特殊字符，不能按行切，必须按 JSON 花括号深度扫描分帧。
    const bodyText = Buffer.from(resp.data).toString('utf-8');
    const frames = parseJsonFrames(bodyText);

    if (frames.length === 0) {
      console.error('[TTS] V3 响应未解析到任何 JSON 帧，原文前 200 字节:', bodyText.slice(0, 200));
      return res.status(500).json({ success: false, error: 'TTS 服务返回空响应' });
    }

    // 任一帧 code 非 0 且非 20000000(EOF)，视为业务错误
    const errFrame = frames.find(f => f && f.code !== 0 && f.code !== 20000000);
    if (errFrame) {
      const errMsg = errFrame.message || `code=${errFrame.code}`;
      console.error(`[TTS] V3 业务错误 code=${errFrame.code}: ${errMsg}`);
      return res.status(500).json({ success: false, error: `TTS 服务错误: ${errMsg}` });
    }

    // 收集音频帧（data 为非空字符串）。先各自 base64 解码后再 concat，避免 padding 错位。
    const audioBuffers: Buffer[] = [];
    for (const f of frames) {
      if (typeof f?.data === 'string' && f.data.length > 0) {
        audioBuffers.push(Buffer.from(f.data, 'base64'));
      }
    }

    if (audioBuffers.length === 0) {
      console.error('[TTS] V3 响应中未包含音频数据，帧数:', frames.length);
      return res.status(500).json({ success: false, error: 'TTS 服务未返回音频数据' });
    }

    const merged = Buffer.concat(audioBuffers);

    // ── 写入磁盘缓存 ──────────────────────────────────────────
    if (hasCacheKey) {
      writeCachedAudio(coursewareId, chunkIdx, merged);
      console.log(`[TTS] 已缓存 coursewareId=${coursewareId} chunkIdx=${chunkIdx} size=${merged.length}B`);
    }

    return res.json({
      success: true,
      audio: merged.toString('base64'),
      encoding: 'mp3'
    });

  } catch (err: any) {
    console.error('[TTS] V3 调用失败:', err.message);

    // axios 在 4xx/5xx 时若 responseType=arraybuffer，err.response.data 是 Buffer
    if (err.response) {
      const status = err.response.status;
      if (status === 401 || status === 403) {
        return res.status(403).json({ success: false, error: 'TTS 认证失败，请检查 VOLCANO_TTS_API_KEY' });
      }
      // 错误响应同样可能是 NDJSON 多帧，复用 parseJsonFrames
      const errFrames = parseJsonFrames(Buffer.from(err.response.data).toString('utf-8'));
      const errMsg = errFrames.find(f => f?.message)?.message || `HTTP ${status}`;
      return res.status(500).json({ success: false, error: `TTS 服务错误: ${errMsg}` });
    }
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      return res.status(504).json({ success: false, error: 'TTS 请求超时，请重试' });
    }

    next(err);
  }
});

// POST /api/tts/merge
// 将已缓存的所有分片 MP3 合并为单个 complete.mp3，供后续整段播放使用
// MP3 是帧式格式，同码率（24kHz）直接二进制拼接产生合法 MP3 文件
router.post('/tts/merge', (req: Request, res: Response) => {
  const { coursewareId, totalChunks } = req.body;

  if (!coursewareId || typeof coursewareId !== 'string' ||
      typeof totalChunks !== 'number' || totalChunks <= 0) {
    return res.status(400).json({ success: false, error: '参数错误：需要 coursewareId 和 totalChunks' });
  }

  const cacheDir = path.join(TTS_CACHE_DIR, coursewareId);
  const completeFile = path.join(cacheDir, 'complete.mp3');

  // 已合并过，直接返回（幂等）
  if (fs.existsSync(completeFile)) {
    return res.json({ success: true, alreadyExists: true });
  }

  // 检查所有分片是否已到齐
  const buffers: Buffer[] = [];
  for (let i = 0; i < totalChunks; i++) {
    const chunkFile = path.join(cacheDir, `${i}.mp3`);
    if (!fs.existsSync(chunkFile)) {
      return res.status(409).json({
        success: false,
        error: `分片 ${i} 尚未缓存，合并中止`,
        missingChunk: i
      });
    }
    buffers.push(fs.readFileSync(chunkFile));
  }

  try {
    const merged = Buffer.concat(buffers);
    fs.writeFileSync(completeFile, merged);
    console.log(`[TTS] complete.mp3 合并完成 coursewareId=${coursewareId} chunks=${totalChunks} size=${merged.length}B`);
    return res.json({ success: true });
  } catch (e: any) {
    console.error('[TTS] 合并写入失败:', e.message);
    return res.status(500).json({ success: false, error: '合并写入失败' });
  }
});

export default router;
