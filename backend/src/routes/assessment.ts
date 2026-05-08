import { Router, Request, Response, NextFunction } from 'express';
import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import db from '../services/databaseService.js';
import { normalizeSubject } from '../utils/subject.js';

const router = Router();

// 获取豆包客户端
const getDoubaoClient = () => {
  const apiKey = process.env.ARK_API_KEY;
  const model = process.env.ARK_MODEL_ID;
  if (!apiKey || !model) throw new Error('ARK_API_KEY 或 ARK_MODEL_ID 未配置');
  return {
    client: new OpenAI({ apiKey, baseURL: 'https://ark.cn-beijing.volces.com/api/v3' }),
    model
  };
};

// 测验题目结构
export interface Question {
  id: string;
  type: 'choice' | 'fill' | 'essay';
  question: string;
  options?: string[];    // 仅 choice 类型
  answer: string;        // 正确答案
  explanation: string;   // 解析
}

// 测验生成接口（保持原 path 向后兼容）
router.post('/generate-assessment', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      bookTitle, subject, chapter, chapters, chapterCount: cliCount,
      studentName,
      wrongProblems, coursewareContent, ownerId,
      difficultyLevel,
      autoSave,
      existingQuestions,
    } = req.body;

    if (!bookTitle || !subject || !chapter || !studentName) {
      return res.status(400).json({
        success: false,
        error: '缺少必需参数: bookTitle, subject, chapter, studentName'
      });
    }

    const chapterList: string[] = Array.isArray(chapters) && chapters.length > 0
      ? chapters
      : String(chapter).split(/[；;、,]/).map(s => s.trim()).filter(Boolean);
    const chapterCount = Math.max(1, Math.min(3, cliCount || chapterList.length || 1));

    // 复用已生成 questions（用户在预览模态点保存）
    if (autoSave === true && Array.isArray(existingQuestions) && existingQuestions.length > 0) {
      const id = uuidv4();
      const resolvedOwnerId = ownerId || 'shared';
      try {
        db.prepare(`
          INSERT INTO classroom_items
            (id, type, bookTitle, chapter, subject, ownerId, userName, contentJson, questionCount, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id, 'quiz', bookTitle, chapterList.join('；'),
          normalizeSubject(subject), resolvedOwnerId, studentName,
          JSON.stringify(existingQuestions), existingQuestions.length, Date.now()
        );
        console.log(`[Assessment] 复用已生成内容保存: ${id} (${existingQuestions.length} 题)`);
        return res.json({
          success: true,
          data: existingQuestions,
          id,
          saved: true,
          questionCount: existingQuestions.length,
        });
      } catch (dbErr: any) {
        console.error('[Assessment] 保存失败:', dbErr);
        return res.status(500).json({ success: false, error: '保存失败：' + dbErr.message });
      }
    }

    // 根据难度星级确定出题规格和描述
    const level = difficultyLevel === 1 ? 1 : difficultyLevel === 3 ? 3 : 2;
    const DIFFICULTY_CONFIG = {
      1: {
        desc: '1星（全基础）',
        rule: '选择题 5 道 + 填空题 4 道 + 解答题 0 道，难度比例 100% 基础题目',
        choice: 5, fill: 4, essay: 0,
        diffDesc: '100% 基础知识题，逐步引导，不出难题'
      },
      2: {
        desc: '2星（基础+提高）',
        rule: '选择题 4 道 + 填空题 3 道 + 解答题 2 道，难度比例 70% 基础 + 30% 提高',
        choice: 4, fill: 3, essay: 2,
        diffDesc: '70% 基础题 + 30% 提高题'
      },
      3: {
        desc: '3星（基础+提高+进阶）',
        rule: '选择题 4 道 + 填空题 3 道 + 解答题 3 道，难度比例 50% 基础 + 30% 提高 + 20% 进阶挑战',
        choice: 4, fill: 3, essay: 3,
        diffDesc: '50% 基础 + 30% 提高 + 20% 进阶挑战题'
      }
    };
    const baseCfg = DIFFICULTY_CONFIG[level as 1|2|3];
    // N 章则线性放大题量
    const cfg = {
      ...baseCfg,
      choice: baseCfg.choice * chapterCount,
      fill: baseCfg.fill * chapterCount,
      essay: baseCfg.essay * chapterCount,
      rule: `选择题 ${baseCfg.choice * chapterCount} 道 + 填空题 ${baseCfg.fill * chapterCount} 道 + 解答题 ${baseCfg.essay * chapterCount} 道（共 ${chapterCount} 章，每章 ${baseCfg.choice}+${baseCfg.fill}+${baseCfg.essay}）`,
    };

    const { client, model } = getDoubaoClient();

    // 构建错题上下文
    let wrongCtx = '';
    if (wrongProblems && wrongProblems.length > 0) {
      const weakPoints = wrongProblems
        .flatMap((item: any) => item.meta?.problems || [])
        .filter((p: any) => p.status === 'WRONG' || p.status === 'CORRECTED')
        .slice(0, 5)
        .map((p: any) => p.question || '(未识别)')
        .join('；');
      if (weakPoints) wrongCtx = `\n学生历史薄弱点（重点针对出题）：${weakPoints}`;
    }

    // 课件上下文摘要
    let cwCtx = '';
    if (coursewareContent && typeof coursewareContent === 'string' && coursewareContent.trim().length > 0) {
      cwCtx = `\n本章课件摘要：${coursewareContent.substring(0, 500)}`;
    }

    const systemPrompt = `你是一位资深命题专家，擅长出高质量测验题。
请严格按照 JSON 格式输出，不要输出任何其他文字。`;

    const chapterListBlock = chapterList.map((c, i) => `  ${i + 1}. ${c}`).join('\n');
    const userPrompt = `请为以下内容出一份测验题：
- 教材：《${bookTitle}》
- 科目：${subject}
- 章节（共 ${chapterCount} 个，每个章节都需出题覆盖）：
${chapterListBlock}
- 学生：${studentName}
- 难度：${baseCfg.desc}
${wrongCtx}${cwCtx}

出题要求：
1. ${cfg.rule}
2. 难度分布：${baseCfg.diffDesc}
3. 题量必须按章节均衡分配，每章题量基本相同
4. 每道题必须有详细解析（explanation 字段）
5. 选择题各项用 A/B/C/D 格式

请以纯 JSON 数组格式返回，格式如下：
[
  {
    "id":"q1",
    "type":"choice",
    "question":"题目内容...",
    "options":["A. 选项一","B. 选项二","C. 选项三","D. 选项四"],
    "answer":"A",
    "explanation":"解析..."
  },
  {
    "id":"q2",
    "type":"fill",
    "question":"填空题...",
    "answer":"答案",
    "explanation":"解析..."
  },
  {
    "id":"q3",
    "type":"essay",
    "question":"解答题...",
    "answer":"参考答案...",
    "explanation":"评分标准和解析..."
  }
]

只返回 JSON 数组，不要其他文字。`;


    const completion = await client.chat.completions.create({
      model,
      temperature: 0.7,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    } as any);

    const rawContent = completion.choices[0]?.message?.content || '[]';
    const cleanJson = rawContent.replace(/^```json\n?|\n?```$/g, '').trim();

    let questions: Question[];
    try {
      questions = JSON.parse(cleanJson);
      if (!Array.isArray(questions)) throw new Error('返回值不是数组');
    } catch (parseErr) {
      console.error('[Assessment] JSON 解析失败:', rawContent.substring(0, 200));
      return res.status(500).json({ success: false, error: '模型返回格式异常，请重试' });
    }

    // 确保每题都有 id
    questions = questions.map((q, i) => ({ ...q, id: q.id || `q${i + 1}` }));

    // 持久化到 classroom_items 表
    // 仅在 autoSave !== false 时写入数据库
    let savedId = '';
    if (autoSave !== false) {
      const id = uuidv4();
      const resolvedOwnerId = ownerId || 'shared';
      try {
        db.prepare(`
          INSERT INTO classroom_items
            (id, type, bookTitle, chapter, subject, ownerId, userName, contentJson, questionCount, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id, 'quiz', bookTitle, chapterList.join('；'),
          normalizeSubject(subject), resolvedOwnerId, studentName,
          JSON.stringify(questions), questions.length, Date.now()
        );
        console.log(`[Assessment] 已保存到 classroom_items: ${id} (${questions.length} 题, ${chapterCount} 章)`);
        savedId = id;
      } catch (dbErr) {
        console.error('[Assessment] 保存到数据库失败:', dbErr);
      }
    }

    return res.json({
      success: true,
      data: questions,
      id: savedId,
      saved: !!savedId,
      questionCount: questions.length
    });


  } catch (error: any) {
    console.error('[Assessment] 生成失败:', error);

    if (error.status === 429 || error.code === 429) {
      return res.status(429).json({ success: false, error: 'API 配额已耗尽，请稍后重试' });
    }
    const msg = (error.message || '').toLowerCase();
    if (msg.includes('fetch') || msg.includes('connection') || msg.includes('network')) {
      return res.status(503).json({ success: false, error: '网络连接失败，请检查服务器网络' });
    }
    if (error.status === 403 || error.status === 401) {
      return res.status(403).json({ success: false, error: 'API 认证失败，请检查 ARK_API_KEY' });
    }

    next(error);
  }
});


export default router;
