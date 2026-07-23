import { Router, Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import db from '../services/databaseService.js';
import { normalizeSubject } from '../utils/subject.js';
import { JobExecutionError, JobRecord } from '../services/jobs.js';
import { jobStore, modelSlots, registerJobHandler } from '../services/jobRuntime.js';

// OCR 调试目录:parse 失败时落盘完整 raw,自动保留 7 天。
const OCR_DEBUG_DIR = path.join(process.env.DATA_DIR || '/opt/twinkle/data', 'ocr-debug');
function dumpFailedRaw(taskId: string, raw: string, mainErr: string, fallbackErr: string): void {
  try {
    if (!fs.existsSync(OCR_DEBUG_DIR)) fs.mkdirSync(OCR_DEBUG_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(OCR_DEBUG_DIR, `${ts}_${taskId}.txt`);
    fs.writeFileSync(
      file,
      `# main parse error: ${mainErr}\n# sanitized parse error: ${fallbackErr}\n\n${raw}`,
      'utf8'
    );
    console.error(`[Doubao][analyze-image] raw 已落盘: ${file}`);
    // 7 天清理
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const f of fs.readdirSync(OCR_DEBUG_DIR)) {
      const p = path.join(OCR_DEBUG_DIR, f);
      try {
        if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
      } catch {/* ignore */}
    }
  } catch (e: any) {
    console.error(`[Doubao][analyze-image] raw 落盘失败: ${e?.message || e}`);
  }
}

const router = Router();

const ARK_RESPONSES_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3/responses';

// Why: a compact structural contract retains saveable questions while removing
// page furniture and narration that caused the previous 222 second response.
const COMPACT_OCR_SYSTEM_INSTRUCTION = `将试卷输出为合法 JSON 对象，不要 Markdown 围栏。顶层必须有 type、subject、chapter_hint、content_markdown、problems。problems 必须逐题输出，每题包含 questionNumber、content、studentAnswer、standardAnswer、teacherComment、knowledgePoints、status。content 必须自包含解题所需材料、题干和选项；不重复页眉、页码、装饰、非必要插图描述或相同指导语。缺失内容用空字符串或空数组，不省略字段。studentAnswer 和 teacherComment 仅保留可见内容；standardAnswer 只给结论；knowledgePoints 只保留一个关键点；status 只能为 correct、wrong、corrected。content_markdown 只列题号，不重复题干。`;

function extractResponsesText(data: any): string {
  if (!data) return '';
  if (typeof data.output_text === 'string' && data.output_text.trim()) {
    return data.output_text;
  }
  const out = data.output;
  if (!Array.isArray(out)) return '';
  const parts: string[] = [];
  for (const item of out) {
    const content = item?.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (typeof c?.text === 'string') parts.push(c.text);
    }
  }
  return parts.join('');
}

function stripMarkdownFence(raw: string): string {
  if (!raw) return raw;
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) return fenceMatch[1].trim();
  return trimmed;
}

/**
 * 修复 LLM 输出 JSON 中的非法转义。
 * Why: 系统 prompt 要求 LaTeX 公式(如 $\underline{}$),但模型常常忘记把
 *      字符串内的 `\` 双写为 `\\`。其中 `\u` 后非 4 位 hex 会让 JSON.parse
 *      直接抛 "Bad Unicode escape"。这里把所有非法 `\X` 还原为 `\\X`。
 *      合法 JSON 转义: \" \\ \/ \b \f \n \r \t \uXXXX。
 */
function sanitizeLooseJsonEscapes(raw: string): string {
  return raw.replace(
    /\\(u(?![0-9a-fA-F]{4})|[^"\\/bfnrtu])/g,
    '\\\\$1'
  );
}

interface OcrResult {
  text: string;
  meta: {
    type: string;
    subject: string;
    chapter_hint: string;
    knowledge_status: string;
    problems: any[];
  };
}

class OcrError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

/**
 * 单次调用豆包 ARK 并尝试 parse;失败时返回 {ok:false, raw, errors} 供上层决策。
 * Why: 抽出最内层一次"调用→parse"原子动作,便于上层在 parse 失败时整体 retry 一次,
 *      不必把 600s 的网络调用与 parse 容错耦合。
 */
async function arkOcrAttempt(
  apiKey: string,
  model: string,
  imageDataUrl: string,
  userPrompt: string,
  attemptLabel: string
): Promise<{ ok: true; json: any } | { ok: false; raw: string; mainErr: string; fallbackErr: string }> {
  const t0 = Date.now();
  console.log(`[Doubao][analyze-image][${attemptLabel}] >>> 请求 model=${model}`);

  let arkResp: globalThis.Response;
  try {
    arkResp = await fetch(ARK_RESPONSES_ENDPOINT, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(600000),
      body: JSON.stringify({
        model,
        input: [
          { role: 'system', content: [{ type: 'input_text', text: COMPACT_OCR_SYSTEM_INSTRUCTION }] },
          {
            role: 'user',
            content: [
              { type: 'input_image', image_url: imageDataUrl },
              { type: 'input_text', text: userPrompt }
            ]
          }
        ],
        temperature: 0,
        max_output_tokens: Number(process.env.ARK_OCR_MAX_OUTPUT_TOKENS || 3000)
      })
    });
  } catch (err: any) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new OcrError(503, '识别超时（600s），请重试或更换更清晰的图片。');
    }
    throw new OcrError(503, `网络层调用失败: ${err.message || err.name}`);
  }

  const elapsed = Date.now() - t0;

  if (!arkResp.ok) {
    const errText = await arkResp.text().catch(() => '');
    console.error(`[Doubao][analyze-image][${attemptLabel}] !!! HTTP ${arkResp.status} 耗时=${elapsed}ms body=${errText.slice(0, 500)}`);
    if (arkResp.status === 401 || arkResp.status === 403) throw new OcrError(403, '认证层解构失败：API Key 无效或额度不足。');
    if (arkResp.status === 429) throw new OcrError(429, '调用频率超限，请稍后重试。');
    if (arkResp.status >= 500) throw new OcrError(503, '上游模型服务异常，请稍后重试。');
    throw new OcrError(arkResp.status, `豆包 API 返回错误：HTTP ${arkResp.status}`);
  }

  const data: any = await arkResp.json();
  const usage = data?.usage;
  console.log(`[Doubao][analyze-image][${attemptLabel}] <<< 完成 耗时=${elapsed}ms input_tokens=${usage?.input_tokens} output_tokens=${usage?.output_tokens}`);

  const rawText = extractResponsesText(data);
  if (!rawText) {
    console.error(`[Doubao][analyze-image][${attemptLabel}] !!! 响应内容为空`, JSON.stringify(data).slice(0, 500));
    throw new OcrError(502, '豆包返回空内容，请重试。');
  }

  const cleaned = stripMarkdownFence(rawText);
  try {
    return { ok: true, json: JSON.parse(cleaned) };
  } catch (parseErr: any) {
    try {
      const j = JSON.parse(sanitizeLooseJsonEscapes(cleaned));
      console.warn(`[Doubao][analyze-image][${attemptLabel}] JSON 通过 sanitize 兜底解析成功`);
      return { ok: true, json: j };
    } catch (parseErr2: any) {
      return { ok: false, raw: cleaned, mainErr: parseErr.message, fallbackErr: parseErr2.message };
    }
  }
}

/**
 * 调用豆包 ARK Responses API 完成单图 OCR。
 * Why: 抽离为纯函数,worker 复用。parse 失败时自动重试一次(用更严格的 user prompt),
 *      仍失败则把完整 raw 落盘,抛 OcrError 让 worker 把任务标记为 failed。
 */
async function callDoubaoOcr(base64Image: string, taskId: string = 'no-task'): Promise<OcrResult> {
  const apiKey = process.env.ARK_API_KEY;
  if (!apiKey) throw new OcrError(500, '服务器配置错误: ARK_API_KEY 未设置');

  const model = process.env.ARK_VISION_MODEL_ID || 'doubao-seed-2-0-lite-260428';

  const mimeMatch = base64Image.match(/^data:image\/(png|jpeg|jpg|webp);base64,/i);
  const mime = mimeMatch ? mimeMatch[1].toLowerCase().replace('jpg', 'jpeg') : 'jpeg';
  const cleanBase64 = base64Image.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/i, '');
  const imageDataUrl = `data:image/${mime};base64,${cleanBase64}`;

  const userPrompt1 = '严格输出紧凑 JSON，保留可保存错题所需的完整题目字段。';
  const userPrompt2 = '上一次 JSON 解析失败。只输出一个合法 JSON 对象：所有必填字段必须存在，字符串中的双引号和反斜杠必须正确转义，不要 Markdown 围栏。';

  let json: any;
  const first = await arkOcrAttempt(apiKey, model, imageDataUrl, userPrompt1, 'attempt-1');
  if (first.ok) {
    json = first.json;
  } else {
    console.error(`[Doubao][analyze-image][attempt-1] JSON 解析失败: main=${first.mainErr} | sanitized=${first.fallbackErr} raw_head=${first.raw.slice(0, 300)}`);
    dumpFailedRaw(`${taskId}_attempt1`, first.raw, first.mainErr, first.fallbackErr);
    console.warn(`[Doubao][analyze-image][attempt-1] parse 失败,自动重试一次`);
    const second = await arkOcrAttempt(apiKey, model, imageDataUrl, userPrompt2, 'attempt-2');
    if (second.ok) {
      json = second.json;
    } else {
      console.error(`[Doubao][analyze-image][attempt-2] JSON 解析仍失败: main=${second.mainErr} | sanitized=${second.fallbackErr} raw_head=${second.raw.slice(0, 300)}`);
      dumpFailedRaw(`${taskId}_attempt2`, second.raw, second.mainErr, second.fallbackErr);
      throw new OcrError(502, '豆包返回非 JSON 格式（已重试一次仍失败），请重试或更换图片。');
    }
  }

  const hasIssues = json.problems?.some((p: any) => p.status === 'wrong' || p.status === 'corrected');

  return {
    text: json.content_markdown || '',
    meta: {
      type: json.type || 'exam_paper',
      subject: normalizeSubject(json.subject),
      chapter_hint: json.chapter_hint || '',
      knowledge_status: hasIssues ? 'unmastered' : 'mastered',
      problems: json.problems
    }
  };
}

const OCR_JOB_DIR = path.join(process.env.DATA_DIR || '/opt/twinkle/data', 'jobs', 'ocr');

function writeOcrPayload(base64Image: string): string {
  fs.mkdirSync(OCR_JOB_DIR, { recursive: true });
  const payloadPath = path.join(OCR_JOB_DIR, `${randomUUID()}.input.json`);
  fs.writeFileSync(payloadPath, JSON.stringify({ base64Image }), 'utf8');
  return payloadPath;
}

function assertOcrJobPath(filePath: string): string {
  const resolved = path.resolve(filePath);
  const allowedPrefix = `${path.resolve(OCR_JOB_DIR)}${path.sep}`;
  if (!resolved.startsWith(allowedPrefix)) throw new JobExecutionError('INPUT_INVALID', 'OCR 输入引用无效');
  return resolved;
}

async function runOcrJob(job: JobRecord): Promise<string> {
  const payload = JSON.parse(fs.readFileSync(assertOcrJobPath(job.payloadRef), 'utf8')) as { base64Image?: string };
  if (!payload.base64Image) throw new JobExecutionError('INPUT_INVALID', 'OCR 输入缺失');
  const release = await modelSlots.acquire('vision');
  try {
    const result = await callDoubaoOcr(payload.base64Image, job.id);
    const resultPath = path.join(OCR_JOB_DIR, `${job.id}.result.json`);
    fs.writeFileSync(resultPath, JSON.stringify(result), 'utf8');
    return resultPath;
  } catch (error: any) {
    const code = error instanceof OcrError ? `OCR_${error.statusCode}` : 'OCR_FAILED';
    throw new JobExecutionError(code, error?.message || 'OCR 识别失败');
  } finally {
    release();
  }
}

registerJobHandler('ocr', runOcrJob);

router.post('/analyze-image', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { base64Image } = req.body;
    if (!base64Image) {
      return res.status(400).json({ success: false, error: '缺少必需参数: base64Image' });
    }
    if (!process.env.ARK_API_KEY) {
      return res.status(500).json({ success: false, error: '服务器配置错误: ARK_API_KEY 未设置' });
    }
    const ownerId = (req.body.ownerId as string) || 'shared';
    const payloadRef = writeOcrPayload(base64Image);
    const submission = jobStore.submit({
      type: 'ocr', ownerId, requestKey: randomUUID(), payloadRef, stage: 'ocr',
    });
    if (!submission.accepted) {
      fs.unlinkSync(payloadRef);
      return res.status(429).json({ success: false, error: '当前任务队列已满，请稍后重试' });
    }
    return res.status(202).json({ success: true, data: { taskId: submission.job!.id } });
  } catch (error: any) {
    console.error('[analyze-image] 提交失败:', error);
    next(error);
  }
});

router.get('/analyze-task/:id', (req: Request, res: Response) => {
  const job = jobStore.get(req.params.id);
  if (!job) {
    return res.status(404).json({ success: false, error: '任务不存在或已过期' });
  }

  const statusMap: Record<string, string> = { queued: 'pending', running: 'processing', completed: 'success', failed: 'failed', cancelled: 'failed' };
  const payload: any = { status: statusMap[job.status] || 'failed' };
  if (job.status === 'completed' && job.resultRef) {
    try {
      payload.result = JSON.parse(fs.readFileSync(assertOcrJobPath(job.resultRef), 'utf8'));
    } catch {
      payload.status = 'failed';
      payload.error = '任务结果解析失败';
    }
  } else if (job.status === 'failed') {
    payload.error = '识别失败，请重试';
  }

  return res.json({ success: true, data: payload });
});

/**
 * Legacy analyze_tasks records are retained for compatibility only. New OCR work
 * uses renewable jobs leases and is recovered by the shared scheduler instead.
 */
export function initAnalyzeTasks(): void {
  console.log('[analyze-task] 新 OCR 任务由 jobs 调度器恢复');
}

export default router;
