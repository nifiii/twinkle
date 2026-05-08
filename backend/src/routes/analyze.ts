import { Router, Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import db from '../services/databaseService.js';
import { normalizeSubject } from '../utils/subject.js';

// OCR 调试目录:parse 失败时落盘完整 raw,自动保留 7 天。
const OCR_DEBUG_DIR = path.join(process.env.DATA_DIR || '/opt/hl-os/data', 'ocr-debug');
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

const OCR_SYSTEM_INSTRUCTION = `
你是一位顶尖的图像识别科学家与教育评估专家，专门负责中小学教育资料的数字化重建。
你的终极任务是**极其忠实、完整且保留版面逻辑**地将试卷/作业图片转化为"闪闪数字孪生"格式。

### 核心解构协议（全维度还原）：
1. [层级 1: 全量还原层 (Total Reconstruction)]：
   - **绝不遗漏**：必须识别并记录图片中**所有**印刷文字，包括页眉、页码、注意事项、大题说明、栏目名称。
   - **原子化背景原则 (Context Atomicity) - 强制要求**：
     - 若一组题目共用一段阅读材料、情景描述、对话背景或指导语，**必须将这些共用内容完整重复地输出到该组下每一个子题的 content 字段中**。
     - **严禁使用引用**：绝对禁止在题目内容中使用“插图描述如上”、“见上文”、“同上”或“请参考前面的阅读材料”等缩略描述。
     - **内容副本要求**：每个题目的 \`content\` 字段必须是一个独立的、自包含的文本块，包含：1. 完整的背景材料/插图文字描述；2. 答题要求；3. 具体题干。
     - 确保每一个题目单元在被单独剥离为“错题”时，依然拥有绝对完整的解题背景，用户无需查看上下文即可理解题目。
   - **插图与表格**：用文字描述所有图片/插图（如：[插图：xxx]）；将所有表格还原为 Markdown 表格。
   - **数学公式**：严格使用 LaTeX 格式 (例如: $x^2 + y = 0$)。

2. [层级 2: 学生行为层 (Student Action)]：
   - 极其精准地识别学生手写的原始答案、填空内容、勾选痕迹。

3. [层级 3: 批改反馈层 (Teacher Feedback)]：
   - 提取红笔批改痕迹（勾、叉、分数、评语）以及"订正"内容。
   - **强制语言要求**：识别出的所有老师评语、批注以及推导出的反馈内容**必须使用中文**。即使原图中有英文评语，也请翻译或总结为中文。

4. [层级 4: 逻辑判定层 (Logical Intelligence)]：
   - 自动推导标准答案 (standardAnswer) 并分析该题所属的细分知识点 (knowledgePoints)。
   - 综合比对判定状态 (status: correct/wrong/corrected)。

### 格式化规范：
- **Markdown 排版与换行**：在 \`content_markdown\` 和题目 \`content\` 中，必须在不同的语义块（如背景材料、指导语、题干、选项）之间使用**两个换行符 (\\n\\n)**。
- **清晰标识**：在 \`content\` 字段中，先输出背景内容，随后是题目内容，并使用 Markdown 语法进行视觉区分。
  - 示例格式：
    **【背景材料/答题要求】**

    (一) 任务一：请阅读下列绘本内容，并完成题目。

    [插图描述：小男孩在公园里遇到小女孩...]

    **【题干内容】**

    1. The boy meets the girl in the afternoon. ( )

- \`content_markdown\`：必须是整张试卷的**数字化副本**，包含所有阅读材料、指导语和题目。
- \`problems\`：数组中的 \`content\` 必须包含该题目特有的所有印刷信息（含前置背景）。

### 输出强约束（强制 JSON 格式）：
仅输出一个**合法 JSON 对象**，不要包含任何 markdown 代码块标记（如 \`\`\`json）、不要任何前后缀解释文字。
**JSON 字符串内强制要求**：
1. 禁止使用任何 HTML 标签 (例如 \`<u>\`、\`<font>\`、\`<br>\`)。所有视觉强调（红字/下划线/批注）请用 Markdown 描述，例如 "教师评分：**74**(红字)" 或在评语后加 \`(红笔批注)\`。
2. JSON 字符串中如出现英文双引号，必须转义为 \\"。中文「」『』「" 等弯引号不受限。
3. 反斜杠必须双写：LaTeX 公式中 \`\\frac\` 在 JSON 字符串里要写成 \`\\\\frac\`，\`\\underline\` 写成 \`\\\\underline\`。
4. 多行内容用 \`\\n\` 表示换行，**不要**在字符串中嵌入真实换行符以外的控制字符。
JSON 顶层字段定义：
- \`type\`: string 枚举，取值 'textbook' | 'note' | 'wrong_problem' | 'exam_paper' | 'homework'
- \`subject\`: string，学科名称（如：语文 / 数学 / 英语 / 物理 / 化学 / 生物 / 历史 / 地理 / 政治）
- \`chapter_hint\`: string，章节线索（无则空字符串）
- \`content_markdown\`: string，整张试卷数字化副本
- \`problems\`: array，每项对象字段：
    - \`questionNumber\`: string
    - \`content\`: string（必填，含背景与题干，自包含）
    - \`studentAnswer\`: string
    - \`standardAnswer\`: string（必填）
    - \`teacherComment\`: string
    - \`correction\`: string
    - \`knowledgePoints\`: string[]
    - \`status\`: string 枚举，取值 'correct' | 'wrong' | 'corrected'（必填）
`;

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
          { role: 'system', content: [{ type: 'input_text', text: OCR_SYSTEM_INSTRUCTION }] },
          {
            role: 'user',
            content: [
              { type: 'input_image', image_url: imageDataUrl },
              { type: 'input_text', text: userPrompt }
            ]
          }
        ],
        temperature: 0.1
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

  const model = process.env.ARK_VISION_MODEL_ID || process.env.ARK_MODEL_ID;
  if (!model) throw new OcrError(500, '服务器配置错误: ARK_VISION_MODEL_ID 未设置');

  const mimeMatch = base64Image.match(/^data:image\/(png|jpeg|jpg|webp);base64,/i);
  const mime = mimeMatch ? mimeMatch[1].toLowerCase().replace('jpg', 'jpeg') : 'jpeg';
  const cleanBase64 = base64Image.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/i, '');
  const imageDataUrl = `data:image/${mime};base64,${cleanBase64}`;

  const userPrompt1 = '请执行专家级全维度版面还原协议。识别所有印刷文字（含阅读材料、指导语、插图描述）、学生手写、红笔批改。严格按系统指令的 JSON 顶层字段输出，仅返回一个合法 JSON 对象,不要任何 markdown 代码块围栏(```),不要任何前后缀文字。';
  const userPrompt2 = '上一次返回的 JSON 解析失败。请重新输出,务必遵守:\n1. 只输出一个合法 JSON 对象,不带任何前后缀和 markdown 代码块。\n2. 字符串内禁止出现任何 HTML 标签 (<u>/<font>/<br> 等),用 Markdown 加注释代替。\n3. 字符串内英文双引号必须写成 \\",反斜杠必须双写为 \\\\。\n4. LaTeX 公式中的 \\\\frac/\\\\underline 在 JSON 字符串里要写成 \\\\\\\\frac/\\\\\\\\underline。\n5. 在输出前自行 mental-parse 检查 JSON 合法。';

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

// ── 任务表 DAO（懒加载）────────────────────────────────
// Why: 路由文件在 ESM 入口被 import 时即执行顶层语句,
//      而 initDatabase() 是在 index.ts 主体里之后调用的;
//      若此处直接 db.prepare,新建的 analyze_tasks 表还不存在 → SQLITE_ERROR。
//      改为懒加载,首次调用时(initDatabase 已跑完)再 prepare。
let _stmts: any = null;
function stmts(): any {
  if (_stmts) return _stmts;
  _stmts = {
    insert: db.prepare(
      `INSERT INTO analyze_tasks (id, ownerId, status, createdAt, updatedAt) VALUES (?, ?, 'pending', ?, ?)`
    ),
    updateStatus: db.prepare(
      `UPDATE analyze_tasks SET status = ?, updatedAt = ? WHERE id = ?`
    ),
    updateSuccess: db.prepare(
      `UPDATE analyze_tasks SET status = 'success', result = ?, updatedAt = ? WHERE id = ?`
    ),
    updateFail: db.prepare(
      `UPDATE analyze_tasks SET status = 'failed', error = ?, updatedAt = ? WHERE id = ?`
    ),
    get: db.prepare(
      `SELECT id, status, result, error, createdAt FROM analyze_tasks WHERE id = ?`
    ),
  };
  return _stmts;
}

/**
 * 后台 worker：调豆包并把结果落库。fire-and-forget。
 * Why: 必须捕获所有异常，否则 setImmediate 中未处理拒绝会让进程重启。
 */
function runOcrWorker(taskId: string, base64Image: string): void {
  setImmediate(async () => {
    const s = stmts();
    try {
      s.updateStatus.run('processing', Date.now(), taskId);
      const result = await callDoubaoOcr(base64Image, taskId);
      s.updateSuccess.run(JSON.stringify(result), Date.now(), taskId);
    } catch (err: any) {
      const errMsg = err instanceof OcrError ? err.message : (err?.message || '识别失败');
      console.error(`[analyze-task] task=${taskId} 失败: ${errMsg}`);
      s.updateFail.run(errMsg, Date.now(), taskId);
    }
  });
}

router.post('/analyze-image', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { base64Image } = req.body;
    if (!base64Image) {
      return res.status(400).json({ success: false, error: '缺少必需参数: base64Image' });
    }
    if (!process.env.ARK_API_KEY) {
      return res.status(500).json({ success: false, error: '服务器配置错误: ARK_API_KEY 未设置' });
    }
    if (!process.env.ARK_VISION_MODEL_ID && !process.env.ARK_MODEL_ID) {
      return res.status(500).json({ success: false, error: '服务器配置错误: ARK_VISION_MODEL_ID 未设置' });
    }

    const taskId = randomUUID();
    const ownerId = (req.body.ownerId as string) || null;
    const now = Date.now();
    stmts().insert.run(taskId, ownerId, now, now);

    runOcrWorker(taskId, base64Image);

    return res.json({ success: true, data: { taskId } });
  } catch (error: any) {
    console.error('[analyze-image] 提交失败:', error);
    next(error);
  }
});

router.get('/analyze-task/:id', (req: Request, res: Response) => {
  const row = stmts().get.get(req.params.id) as any;
  if (!row) {
    return res.status(404).json({ success: false, error: '任务不存在或已过期' });
  }

  const payload: any = { status: row.status };
  if (row.status === 'success') {
    try {
      payload.result = JSON.parse(row.result);
    } catch {
      payload.status = 'failed';
      payload.error = '任务结果解析失败';
    }
  } else if (row.status === 'failed') {
    payload.error = row.error || '未知错误';
  }

  return res.json({ success: true, data: payload });
});

/**
 * 启动时把残留的 pending/processing 任务置为 failed，避免重启后变幽灵任务。
 * 同时启动每小时一次的 24h 过期清理。
 */
export function initAnalyzeTasks(): void {
  const recovered = db
    .prepare(
      `UPDATE analyze_tasks SET status = 'failed', error = '服务重启，任务中断', updatedAt = ?
       WHERE status IN ('pending', 'processing')`
    )
    .run(Date.now());
  if (recovered.changes > 0) {
    console.log(`[analyze-task] 启动恢复：将 ${recovered.changes} 个未完成任务标记为 failed`);
  }

  const cleanup = () => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const r = db.prepare(`DELETE FROM analyze_tasks WHERE createdAt < ?`).run(cutoff);
    if (r.changes > 0) {
      console.log(`[analyze-task] 已清理 ${r.changes} 条 24h 之前的任务记录`);
    }
  };
  cleanup();
  setInterval(cleanup, 60 * 60 * 1000);
}

export default router;
