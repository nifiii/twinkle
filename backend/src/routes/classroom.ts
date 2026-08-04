import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import OpenAI from 'openai';
import db from '../services/databaseService.js';
import { isRetiredLearningContent } from '../services/retiredLearningContentService.js';

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

interface GradeResult {
  id: string;
  type: string;
  question: string;
  studentAnswer: string;
  correctAnswer: string;
  isCorrect: boolean | null;
  explanation: string;
}

// 异步批改：在后台执行，完成后写回 quiz_results
async function gradeQuizAsync(
  resultId: string,
  questions: any[],
  answers: Record<string, string>
): Promise<void> {
  try {
    const results: GradeResult[] = [];
    let correctCount = 0;
    const essayQuestions: any[] = [];

    for (const q of questions) {
      const studentAns = (answers[q.id] || '').trim();
      if (q.type === 'choice') {
        const studentLetter = studentAns.charAt(0).toUpperCase();
        const correctLetter = (q.answer || '').charAt(0).toUpperCase();
        const isCorrect = studentLetter === correctLetter;
        if (isCorrect) correctCount++;
        results.push({
          id: q.id, type: q.type, question: q.question,
          studentAnswer: studentAns, correctAnswer: q.answer,
          isCorrect, explanation: q.explanation,
        });
      } else if (q.type === 'fill') {
        const refAns = (q.answer || '').trim();
        const isCorrect = !!studentAns && (
          studentAns === refAns ||
          studentAns.includes(refAns) ||
          (refAns.length > 0 && refAns.includes(studentAns))
        );
        if (isCorrect) correctCount++;
        results.push({
          id: q.id, type: q.type, question: q.question,
          studentAnswer: studentAns, correctAnswer: q.answer,
          isCorrect, explanation: q.explanation,
        });
      } else {
        essayQuestions.push(q);
      }
    }

    // AI 批改解答题
    if (essayQuestions.length > 0) {
      try {
        const { client, model } = getDoubaoClient();
        const essayPrompt = essayQuestions.map((q: any) => {
          const studentAns = answers[q.id] || '（未作答）';
          return `题号：${q.id}\n题目：${q.question}\n参考答案：${q.answer}\n学生答案：${studentAns}`;
        }).join('\n\n---\n\n');

        const gradingCompletion = await client.chat.completions.create({
          model,
          temperature: 0.3,
          messages: [
            {
              role: 'system',
              content: '你是一位严格但公正的阅卷老师。请对学生的解答题进行批改，给出 isCorrect (true/false) 和详细错误讲解（comment 字段）。错误讲解须包含：学生答错原因 + 正确思路 + 知识点提醒，80-150 字。以 JSON 数组返回：[{"id":"q3","isCorrect":true,"comment":"..."}]'
            },
            { role: 'user', content: essayPrompt },
          ],
        } as any);

        const gradingRaw = (gradingCompletion.choices[0]?.message?.content || '[]')
          .replace(/^```json\n?|\n?```$/g, '').trim();
        const gradingResults = JSON.parse(gradingRaw);

        for (const gr of gradingResults) {
          const q = essayQuestions.find((eq: any) => eq.id === gr.id);
          if (q) {
            if (gr.isCorrect) correctCount++;
            results.push({
              id: q.id, type: q.type, question: q.question,
              studentAnswer: answers[q.id] || '',
              correctAnswer: q.answer,
              isCorrect: gr.isCorrect,
              explanation: gr.comment || q.explanation,
            });
          }
        }
      } catch (essayErr: any) {
        console.error('[GradeAsync] 解答题批改失败:', essayErr.message);
        for (const q of essayQuestions) {
          results.push({
            id: q.id, type: q.type, question: q.question,
            studentAnswer: answers[q.id] || '',
            correctAnswer: q.answer,
            isCorrect: null,
            explanation: q.explanation || '批改服务暂时不可用',
          });
        }
      }
    }

    // 学习建议
    let suggestions = '';
    const wrong = results.filter(r => r.isCorrect === false);
    if (wrong.length > 0) {
      try {
        const { client, model } = getDoubaoClient();
        const wrongSummary = wrong.slice(0, 3).map(r => r.question).join('；');
        const sugg = await client.chat.completions.create({
          model,
          temperature: 0.5,
          messages: [
            { role: 'system', content: '你是一位学习顾问，根据学生答错的题目给出简洁的学习建议，200字以内。' },
            { role: 'user', content: `学生在以下题目上出错：${wrongSummary}\n\n请给出针对性学习建议。` },
          ],
        } as any);
        suggestions = sugg.choices[0]?.message?.content || '';
      } catch {
        suggestions = '';
      }
    }

    const total = questions.length;
    const percentage = total > 0 ? Math.round((correctCount / total) * 100) : 0;

    db.prepare(`
      UPDATE quiz_results
      SET correctCount = ?, total = ?, percentage = ?, resultsJson = ?,
          suggestions = ?, status = 'completed', gradedAt = ?
      WHERE id = ?
    `).run(correctCount, total, percentage, JSON.stringify(results), suggestions, Date.now(), resultId);

    console.log(`[GradeAsync] 批改完成 ${resultId}: ${correctCount}/${total}`);
  } catch (err: any) {
    console.error(`[GradeAsync] 批改失败 ${resultId}:`, err.message);
    db.prepare(`UPDATE quiz_results SET status = 'failed', gradedAt = ? WHERE id = ?`)
      .run(Date.now(), resultId);
  }
}

// GET /api/classroom?type=courseware&ownerId=xxx[&source=manual|wrong_problem]
// 返回当前用户的课件或测验列表（不含 contentJson，避免数据量过大）
// source 过滤语义：
//   - 省略：仅返回 source IS NULL 或 'manual'（默认教材方案，向后兼容）
//   - 'wrong_problem'：仅返回错题来源的条目
//   - 'all'：不限制
router.get('/classroom', (req: Request, res: Response) => {
  const { type, ownerId, source } = req.query;

  if (!type || !ownerId) {
    return res.status(400).json({ success: false, error: '缺少参数: type, ownerId' });
  }
  if (type !== 'courseware' && type !== 'quiz') {
    return res.status(400).json({ success: false, error: 'type 必须为 courseware 或 quiz' });
  }

  try {
    let sourceClause = " AND (source IS NULL OR source = 'manual') ";
    if (source === 'wrong_problem') sourceClause = " AND source = 'wrong_problem' ";
    else if (source === 'all') sourceClause = '';

    const rows = db.prepare(`
      SELECT id, type, bookTitle, chapter, subject, ownerId, userName,
             slideCount, questionCount, lastStudiedAt, source, sourceProblemId, createdAt
      FROM classroom_items
      WHERE type = ? AND (ownerId = ? OR ownerId = 'shared') ${sourceClause}
      ORDER BY createdAt DESC
    `).all(type, ownerId as string);

    return res.json({ success: true, data: rows });
  } catch (err: any) {
    console.error('[Classroom] 查询列表失败:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/classroom/:id
// 返回单条记录完整内容（含 contentJson 解析后的数组）
router.get('/classroom/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const row = db.prepare('SELECT * FROM classroom_items WHERE id = ?').get(id) as any;
    if (!row) {
      if (isRetiredLearningContent(db, req.query.ownerId, id, ['classroom_courseware', 'classroom_quiz'])) {
        return res.status(410).json({ success: false, errorCode: 'learning_content_retired', error: '该学习内容已下线' });
      }
      return res.status(404).json({ success: false, error: '记录不存在' });
    }

    let content: any;
    try {
      content = JSON.parse(row.contentJson);
    } catch {
      content = [];
    }

    return res.json({
      success: true,
      data: {
        id: row.id,
        type: row.type,
        bookTitle: row.bookTitle,
        chapter: row.chapter,
        subject: row.subject,
        ownerId: row.ownerId,
        userName: row.userName,
        slideCount: row.slideCount,
        questionCount: row.questionCount,
        createdAt: row.createdAt,
        content  // slides[] 或 questions[]
      }
    });
  } catch (err: any) {
    console.error('[Classroom] 查询详情失败:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/classroom/:id/mark-studied
// 阶段 B：课件全文连播任意一段成功后由前端调用，写入 lastStudiedAt（覆盖式）。
// 仅对 type=courseware 有意义，但不强制校验类型——type=quiz 调用属客户端 bug，写了也无害。
router.post('/classroom/:id/mark-studied', (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const row = db.prepare('SELECT id, lastStudiedAt FROM classroom_items WHERE id = ?').get(id) as any;
    if (!row) {
      return res.status(404).json({ success: false, error: '记录不存在' });
    }
    const now = Date.now();
    db.prepare('UPDATE classroom_items SET lastStudiedAt = ? WHERE id = ?').run(now, id);
    return res.json({ success: true, data: { id, lastStudiedAt: now } });
  } catch (err: any) {
    console.error('[Classroom] mark-studied 失败:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/classroom/:id
// 删除单条课件或测验记录
router.delete('/classroom/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const row = db.prepare('SELECT id FROM classroom_items WHERE id = ?').get(id);
    if (!row) {
      return res.status(404).json({ success: false, error: '记录不存在' });
    }
    db.prepare('DELETE FROM classroom_items WHERE id = ?').run(id);
    console.log(`[Classroom] 已删除记录: ${id}`);
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Classroom] 删除失败:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});


// POST /api/quiz-result/start
// 提交答卷 → 立即落库 status=grading → 后台异步批改 → 返回 resultId
router.post('/quiz-result/start', (req: Request, res: Response) => {
  const {
    quizId, questions, answers,
    bookTitle, chapter, subject, ownerId, userName,
  } = req.body;

  if (!quizId || !Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ success: false, error: '缺少必需参数: quizId, questions' });
  }
  if (!bookTitle || !ownerId) {
    return res.status(400).json({ success: false, error: '缺少必需参数: bookTitle, ownerId' });
  }

  try {
    const id = uuidv4();
    db.prepare(`
      INSERT INTO quiz_results
        (id, quizId, bookTitle, chapter, subject, ownerId, userName,
         correctCount, total, percentage, resultsJson, suggestions, status, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, quizId, bookTitle, chapter || '', subject || '', ownerId, userName || '',
      0, questions.length, 0, JSON.stringify([]), '', 'grading', Date.now()
    );

    // 立即删除原测验记录
    db.prepare('DELETE FROM classroom_items WHERE id = ?').run(quizId);

    // 后台异步批改（不阻塞响应）
    setImmediate(() => {
      gradeQuizAsync(id, questions, answers || {}).catch(err => {
        console.error('[QuizResult/start] async error:', err);
      });
    });

    return res.json({ success: true, id, status: 'grading' });
  } catch (err: any) {
    console.error('[QuizResult/start] 失败:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/quiz-results/:id/override
// 用户对单题进行二次批改（修改 isCorrect），重算 correctCount/percentage
router.patch('/quiz-results/:id/override', (req: Request, res: Response) => {
  const { id } = req.params;
  const { questionId, isCorrect } = req.body;

  if (!questionId || typeof isCorrect !== 'boolean') {
    return res.status(400).json({ success: false, error: 'questionId 与 isCorrect 必填' });
  }

  try {
    const row = db.prepare('SELECT * FROM quiz_results WHERE id = ?').get(id) as any;
    if (!row) return res.status(404).json({ success: false, error: '记录不存在' });
    if (row.status !== 'completed') {
      return res.status(400).json({ success: false, error: '批改未完成，无法二次批改' });
    }

    const results: GradeResult[] = JSON.parse(row.resultsJson || '[]');
    const target = results.find(r => r.id === questionId);
    if (!target) return res.status(404).json({ success: false, error: '题目不存在' });

    target.isCorrect = isCorrect;

    // 累加 overrides
    const overrides = row.userOverridesJson ? JSON.parse(row.userOverridesJson) : {};
    overrides[questionId] = { isCorrect, overriddenAt: Date.now() };

    const correctCount = results.filter(r => r.isCorrect === true).length;
    const total = row.total || results.length;
    const percentage = total > 0 ? Math.round((correctCount / total) * 100) : 0;

    db.prepare(`
      UPDATE quiz_results
      SET resultsJson = ?, userOverridesJson = ?,
          correctCount = ?, percentage = ?
      WHERE id = ?
    `).run(JSON.stringify(results), JSON.stringify(overrides), correctCount, percentage, id);

    return res.json({
      success: true,
      data: { correctCount, total, percentage, results, overrides }
    });
  } catch (err: any) {
    console.error('[QuizResult/override] 失败:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});


// GET /api/quiz-results?ownerId=xxx
// 查询用户的测验结果历史列表
router.get('/quiz-results', (req: Request, res: Response) => {
  const { ownerId } = req.query;
  if (!ownerId) {
    return res.status(400).json({ success: false, error: '缺少参数: ownerId' });
  }
  try {
    const rows = db.prepare(`
      SELECT id, quizId, bookTitle, chapter, subject, ownerId, userName,
             correctCount, total, percentage, suggestions, status, gradedAt, createdAt
      FROM quiz_results
      WHERE ownerId = ?
      ORDER BY createdAt DESC
    `).all(ownerId as string);
    return res.json({ success: true, data: rows });
  } catch (err: any) {
    console.error('[QuizResults] 查询失败:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/quiz-results/:id
// 查询单条测验结果（含 resultsJson 详情）
router.get('/quiz-results/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const row = db.prepare('SELECT * FROM quiz_results WHERE id = ?').get(id) as any;
    if (!row) return res.status(404).json({ success: false, error: '记录不存在' });
    let results: any[] = [];
    try { results = JSON.parse(row.resultsJson); } catch {}
    return res.json({ success: true, data: { ...row, results } });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
