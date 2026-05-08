import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import OpenAI from 'openai';
import db from '../services/databaseService.js';
import { normalizeSubject } from '../utils/subject.js';

const router = Router();

const getDoubaoClient = () => {
  const apiKey = process.env.ARK_API_KEY;
  const model = process.env.ARK_MODEL_ID;
  if (!apiKey || !model) throw new Error('ARK_API_KEY 或 ARK_MODEL_ID 未配置');
  return {
    client: new OpenAI({ apiKey, baseURL: 'https://ark.cn-beijing.volces.com/api/v3' }),
    model,
  };
};

interface WrongProblemItem {
  scannedItemId: string;
  problemIndex: number;
  ownerId: string;
  userName: string;
  subject: string;
  timestamp: number;
  snippet: string;
  content: string;
  standardAnswer: string;
  studentAnswer: string;
  teacherComment: string;
  correction: string;
  explanation: string;
  knowledgePoints: string[];
  hasAnswer: boolean;
  alreadyGenerated: boolean;
}

interface ResolvedProblem {
  scannedItemId: string;
  problemIndex: number;
  subject: string;
  content: string;
  standardAnswer: string;
  studentAnswer: string;
  teacherComment: string;
  knowledgePoints: string[];
}

// 取出 (scannedItemId, problemIndex) 对应的题目 + 学科，做基础校验
function resolveProblem(scannedItemId: string, problemIndex: number): ResolvedProblem {
  const row = db.prepare(
    `SELECT id, subject, problemsJson FROM scanned_items WHERE id = ? AND type = 'wrong_problem'`
  ).get(scannedItemId) as any;
  if (!row) throw new Error('错题不存在');
  let problems: any[] = [];
  try { problems = JSON.parse(row.problemsJson || '[]'); } catch { /* */ }
  const p = problems[problemIndex];
  if (!p) throw new Error('题目下标越界');
  const content: string = p.content || p.question || '';
  const standardAnswer: string = p.standardAnswer || p.answer || '';
  if (!content.trim()) throw new Error('题干为空');
  if (!standardAnswer.trim()) throw new Error('原题缺标准答案，无法生成讲解');
  return {
    scannedItemId,
    problemIndex,
    subject: normalizeSubject(row.subject),
    content,
    standardAnswer,
    studentAnswer: p.studentAnswer || '',
    teacherComment: p.teacherComment || '',
    knowledgePoints: Array.isArray(p.knowledgePoints) ? p.knowledgePoints : [],
  };
}

async function generateCoursewareSlides(
  client: OpenAI, model: string, p: ResolvedProblem
): Promise<any[]> {
  const kpStr = p.knowledgePoints.join('、') || '未标注';
  const cwSystem = `你是一位资深学科教师，擅长针对错题进行讲解。
请严格按指定 JSON 数组格式输出，不要输出任何其他文字。`;
  const cwUser = `请为以下错题生成一份"错题讲解"课件（结构与课程讲义等价，1-2 节即可）：
- 学科：${p.subject}
- 知识点：${kpStr}
- 题目：${p.content}
- 学生作答：${p.studentAnswer || '（未记录）'}
- 标准答案：${p.standardAnswer}
- 教师批注：${p.teacherComment || '（无）'}

讲解要求：
1. 第 1 节："错在哪里"——剖析学生答错原因（针对学生作答；若未记录则讲常见易错点），200-300 字。
2. 第 2 节："正确思路"——给出正确解题步骤与依据知识点，250-400 字。可以不输出此节，则总数为 1 节。
3. 每节的 notes 字段：以「老师」和「小明」对话形式自问自答，120-200 字。
4. content 字段用流畅的文章段落，不要使用 markdown 标题。

请以纯 JSON 数组格式返回：
[
  {"index":1,"chapter":"错题讲解","title":"错在哪里","content":"...","notes":"老师：...？\\n小明：..."},
  {"index":2,"chapter":"错题讲解","title":"正确思路","content":"...","notes":"老师：...？\\n小明：..."}
]
只返回 JSON 数组，不要其他文字。`;

  const completion = await client.chat.completions.create({
    model,
    temperature: 0.6,
    messages: [
      { role: 'system', content: cwSystem },
      { role: 'user', content: cwUser },
    ],
  } as any);
  const raw = (completion.choices[0]?.message?.content || '[]')
    .replace(/^```json\n?|\n?```$/g, '').trim();
  let slides: any[] = JSON.parse(raw);
  if (!Array.isArray(slides) || slides.length === 0) throw new Error('讲解返回格式异常');
  return slides.map((s, i) => ({
    index: s.index || i + 1,
    chapter: s.chapter || '错题讲解',
    title: s.title || `第${i + 1}节`,
    content: s.content || '',
    notes: s.notes || '',
  }));
}

async function generateQuizQuestions(
  client: OpenAI, model: string, p: ResolvedProblem
): Promise<any[]> {
  const kpStr = p.knowledgePoints.join('、') || '未标注';
  const quizSystem = `你是一位资深命题专家，请围绕指定错题的知识点出 3 道同类型测验题。
请严格按 JSON 数组格式输出，不要输出任何其他文字。`;
  const quizUser = `请围绕以下错题，出 3 道同类型测验题（用于巩固该知识点）：
- 学科：${p.subject}
- 知识点：${kpStr}
- 原错题：${p.content}
- 标准答案：${p.standardAnswer}

出题要求：
1. 共 3 道题，题型与原错题保持一致（若原题为客观题则均为选择题；若为主观题则 1 道选择题 + 1 道填空题 + 1 道解答题）。
2. 难度由易到难，最后一题与原错题难度相当。
3. 每道题必须有详细解析（explanation）。
4. 选择题选项用 A/B/C/D 格式。

请以纯 JSON 数组格式返回：
[
  {"id":"q1","type":"choice","question":"...","options":["A. ...","B. ...","C. ...","D. ..."],"answer":"A","explanation":"..."},
  {"id":"q2","type":"fill","question":"...","answer":"...","explanation":"..."},
  {"id":"q3","type":"essay","question":"...","answer":"...","explanation":"..."}
]
只返回 JSON 数组，不要其他文字。`;

  const completion = await client.chat.completions.create({
    model,
    temperature: 0.7,
    messages: [
      { role: 'system', content: quizSystem },
      { role: 'user', content: quizUser },
    ],
  } as any);
  const raw = (completion.choices[0]?.message?.content || '[]')
    .replace(/^```json\n?|\n?```$/g, '').trim();
  let questions: any[] = JSON.parse(raw);
  if (!Array.isArray(questions) || questions.length === 0) throw new Error('测验返回格式异常');
  return questions.map((q, i) => ({ ...q, id: q.id || `q${i + 1}` }));
}

// GET /api/wrong-problems?ownerId=xxx&subject=xxx&excludeGenerated=1
// 列出指定用户在指定学科下的错题单题
router.get('/wrong-problems', (req: Request, res: Response) => {
  const { ownerId, subject, excludeGenerated } = req.query;
  if (!ownerId) {
    return res.status(400).json({ success: false, error: '缺少参数: ownerId' });
  }

  try {
    const params: any[] = [ownerId];
    let sql = `
      SELECT id, ownerId, userName, subject, timestamp, problemsJson
      FROM scanned_items
      WHERE type = 'wrong_problem' AND ownerId = ?
    `;
    if (subject && typeof subject === 'string' && subject.trim()) {
      sql += ' AND subject = ?';
      params.push(subject);
    }
    sql += ' ORDER BY timestamp DESC';

    const rows = db.prepare(sql).all(...params) as any[];

    const linkRows = db.prepare(
      `SELECT scannedItemId, problemIndex FROM wrong_problem_quiz_links WHERE ownerId = ?`
    ).all(ownerId) as any[];
    const generatedSet = new Set(linkRows.map(r => `${r.scannedItemId}:${r.problemIndex}`));

    const items: WrongProblemItem[] = [];
    for (const row of rows) {
      let problems: any[] = [];
      try { problems = JSON.parse(row.problemsJson || '[]'); } catch { /* skip */ }
      problems.forEach((p: any, idx: number) => {
        const content: string = p.content || p.question || '';
        const standardAnswer: string = p.standardAnswer || p.answer || '';
        const explanation: string = p.explanation || p.teacherComment || '';
        const hasAnswer = !!(standardAnswer && standardAnswer.trim().length > 0);
        const key = `${row.id}:${idx}`;
        const alreadyGenerated = generatedSet.has(key);
        if (excludeGenerated === '1' && alreadyGenerated) return;
        items.push({
          scannedItemId: row.id,
          problemIndex: idx,
          ownerId: row.ownerId,
          userName: row.userName || '',
          subject: normalizeSubject(row.subject),
          timestamp: row.timestamp,
          snippet: content.slice(0, 50),
          content,
          standardAnswer,
          studentAnswer: p.studentAnswer || '',
          teacherComment: p.teacherComment || '',
          correction: p.correction || '',
          explanation,
          knowledgePoints: Array.isArray(p.knowledgePoints) ? p.knowledgePoints : [],
          hasAnswer,
          alreadyGenerated,
        });
      });
    }

    return res.json({ success: true, data: items, count: items.length });
  } catch (err: any) {
    console.error('[WrongProblems] 查询失败:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/wrong-problem-quiz/generate-courseware
// body: { items: [{scannedItemId, problemIndex}] }
// 仅 LLM 调用，不落库
router.post('/wrong-problem-quiz/generate-courseware', async (req: Request, res: Response) => {
  const { items } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, error: '缺少必需参数: items' });
  }
  if (items.length > 10) {
    return res.status(400).json({ success: false, error: '单次最多 10 道（实际：' + items.length + '）' });
  }
  let client: OpenAI; let model: string;
  try {
    const c = getDoubaoClient(); client = c.client; model = c.model;
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }

  const generated: Array<{ scannedItemId: string; problemIndex: number; subject: string; content: string; slides: any[] }> = [];
  const failed: Array<{ scannedItemId: string; problemIndex: number; error: string }> = [];

  for (const it of items) {
    const { scannedItemId, problemIndex } = it || {};
    if (!scannedItemId || typeof problemIndex !== 'number') {
      failed.push({ scannedItemId: scannedItemId || '', problemIndex, error: '参数格式错误' });
      continue;
    }
    try {
      const p = resolveProblem(scannedItemId, problemIndex);
      const slides = await generateCoursewareSlides(client, model, p);
      generated.push({ scannedItemId, problemIndex, subject: p.subject, content: p.content, slides });
      console.log(`[WrongProblemQuiz] 讲解生成: ${scannedItemId}:${problemIndex} (${slides.length}节)`);
    } catch (err: any) {
      console.error(`[WrongProblemQuiz] 讲解生成失败 ${scannedItemId}:${problemIndex}:`, err.message);
      failed.push({ scannedItemId, problemIndex, error: err.message || '未知错误' });
    }
  }
  return res.json({ success: true, data: { generated, failed, total: items.length, successCount: generated.length, failCount: failed.length } });
});

// POST /api/wrong-problem-quiz/save-courseware
// body: { ownerId, userName, items: [{scannedItemId, problemIndex, slides[]}] }
// 仅写 classroom_items（type=courseware,source=wrong_problem），不写 link 表
router.post('/wrong-problem-quiz/save-courseware', async (req: Request, res: Response) => {
  const { ownerId, userName, items } = req.body || {};
  if (!ownerId || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, error: '缺少必需参数: ownerId, items' });
  }

  const saved: Array<{ scannedItemId: string; problemIndex: number; coursewareId: string }> = [];
  const failed: Array<{ scannedItemId: string; problemIndex: number; error: string }> = [];

  const insertCw = db.prepare(`
    INSERT INTO classroom_items
      (id, type, bookTitle, chapter, subject, ownerId, userName, contentJson,
       slideCount, source, sourceProblemId, createdAt)
    VALUES (?, 'courseware', ?, ?, ?, ?, ?, ?, ?, 'wrong_problem', ?, ?)
  `);

  for (const it of items) {
    const { scannedItemId, problemIndex, slides } = it || {};
    if (!scannedItemId || typeof problemIndex !== 'number' || !Array.isArray(slides) || slides.length === 0) {
      failed.push({ scannedItemId: scannedItemId || '', problemIndex, error: '参数格式错误或讲解为空' });
      continue;
    }
    try {
      const p = resolveProblem(scannedItemId, problemIndex);
      const titleHint = (p.knowledgePoints[0] || p.content.slice(0, 12)) + '·错题讲解';
      const sourceProblemId = `${scannedItemId}:${problemIndex}`;
      const cwId = uuidv4();
      const now = Date.now();
      insertCw.run(
        cwId, titleHint, '错题讲解', p.subject, ownerId, userName || '',
        JSON.stringify(slides), slides.length, sourceProblemId, now
      );
      saved.push({ scannedItemId, problemIndex, coursewareId: cwId });
      console.log(`[WrongProblemQuiz] 讲解保存: ${sourceProblemId} → cw=${cwId}`);
    } catch (err: any) {
      console.error(`[WrongProblemQuiz] 讲解保存失败 ${scannedItemId}:${problemIndex}:`, err.message);
      failed.push({ scannedItemId, problemIndex, error: err.message || '未知错误' });
    }
  }
  return res.json({ success: true, data: { saved, failed, total: items.length, successCount: saved.length, failCount: failed.length } });
});

// POST /api/wrong-problem-quiz/generate-quiz
router.post('/wrong-problem-quiz/generate-quiz', async (req: Request, res: Response) => {
  const { items } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, error: '缺少必需参数: items' });
  }
  if (items.length > 10) {
    return res.status(400).json({ success: false, error: '单次最多 10 道（实际：' + items.length + '）' });
  }
  let client: OpenAI; let model: string;
  try {
    const c = getDoubaoClient(); client = c.client; model = c.model;
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }

  const generated: Array<{ scannedItemId: string; problemIndex: number; subject: string; questions: any[] }> = [];
  const failed: Array<{ scannedItemId: string; problemIndex: number; error: string }> = [];

  for (const it of items) {
    const { scannedItemId, problemIndex } = it || {};
    if (!scannedItemId || typeof problemIndex !== 'number') {
      failed.push({ scannedItemId: scannedItemId || '', problemIndex, error: '参数格式错误' });
      continue;
    }
    try {
      const p = resolveProblem(scannedItemId, problemIndex);
      const questions = await generateQuizQuestions(client, model, p);
      generated.push({ scannedItemId, problemIndex, subject: p.subject, questions });
      console.log(`[WrongProblemQuiz] 测验生成: ${scannedItemId}:${problemIndex} (${questions.length}题)`);
    } catch (err: any) {
      console.error(`[WrongProblemQuiz] 测验生成失败 ${scannedItemId}:${problemIndex}:`, err.message);
      failed.push({ scannedItemId, problemIndex, error: err.message || '未知错误' });
    }
  }
  return res.json({ success: true, data: { generated, failed, total: items.length, successCount: generated.length, failCount: failed.length } });
});

// POST /api/wrong-problem-quiz/save-quiz
// body: { ownerId, userName, items: [{scannedItemId, problemIndex, coursewareId, questions[]}] }
// 事务写 classroom_items(type=quiz) + wrong_problem_quiz_links(coursewareId, quizId)
router.post('/wrong-problem-quiz/save-quiz', async (req: Request, res: Response) => {
  const { ownerId, userName, items } = req.body || {};
  if (!ownerId || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, error: '缺少必需参数: ownerId, items' });
  }

  const saved: Array<{ scannedItemId: string; problemIndex: number; quizId: string; coursewareId: string }> = [];
  const failed: Array<{ scannedItemId: string; problemIndex: number; error: string }> = [];

  const insertQuiz = db.prepare(`
    INSERT INTO classroom_items
      (id, type, bookTitle, chapter, subject, ownerId, userName, contentJson,
       questionCount, source, sourceProblemId, createdAt)
    VALUES (?, 'quiz', ?, ?, ?, ?, ?, ?, ?, 'wrong_problem', ?, ?)
  `);
  const insertLink = db.prepare(`
    INSERT INTO wrong_problem_quiz_links
      (id, scannedItemId, problemIndex, ownerId, coursewareId, quizId, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const it of items) {
    const { scannedItemId, problemIndex, coursewareId, questions } = it || {};
    if (!scannedItemId || typeof problemIndex !== 'number' || !coursewareId
      || !Array.isArray(questions) || questions.length === 0) {
      failed.push({ scannedItemId: scannedItemId || '', problemIndex, error: '参数格式错误或测验为空' });
      continue;
    }
    try {
      const p = resolveProblem(scannedItemId, problemIndex);
      const quizTitleHint = (p.knowledgePoints[0] || p.content.slice(0, 12)) + '·错题测验';
      const sourceProblemId = `${scannedItemId}:${problemIndex}`;
      const quizId = uuidv4();
      const now = Date.now();
      const tx = db.transaction(() => {
        insertQuiz.run(
          quizId, quizTitleHint, '错题测验', p.subject, ownerId, userName || '',
          JSON.stringify(questions), questions.length, sourceProblemId, now
        );
        insertLink.run(uuidv4(), scannedItemId, problemIndex, ownerId, coursewareId, quizId, now);
      });
      tx();
      saved.push({ scannedItemId, problemIndex, quizId, coursewareId });
      console.log(`[WrongProblemQuiz] 测验保存: ${sourceProblemId} → quiz=${quizId} (link cw=${coursewareId})`);
    } catch (err: any) {
      console.error(`[WrongProblemQuiz] 测验保存失败 ${scannedItemId}:${problemIndex}:`, err.message);
      failed.push({ scannedItemId, problemIndex, error: err.message || '未知错误' });
    }
  }
  return res.json({ success: true, data: { saved, failed, total: items.length, successCount: saved.length, failCount: failed.length } });
});


export default router;
