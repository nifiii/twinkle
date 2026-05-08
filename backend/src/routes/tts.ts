import { Router, Request, Response, NextFunction } from 'express';
import axios from 'axios';

const router = Router();

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
// 新版控制台 API Key 认证文档: https://www.volcengine.com/docs/6561/2119699
// 认证方式: 新版控制台 API Key，使用 X-Api-Key + X-Api-Resource-Id 两个 Header
// app.appid / app.token 传空字符串（新版不需要 AppID）
router.post('/tts', async (req: Request, res: Response, next: NextFunction) => {
  const { text } = req.body;

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return res.status(400).json({ success: false, error: '缺少 text 参数' });
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
      user: { uid: 'hlos_user' },
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

export default router;
