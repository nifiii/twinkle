import { Router, Request, Response, NextFunction } from 'express';
import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import db from '../services/databaseService.js';
import { normalizeSubject } from '../utils/subject.js';

const router = Router();

// 获取豆包客户端（ARK API，兼容 OpenAI SDK）
const getDoubaoClient = () => {
  const apiKey = process.env.ARK_API_KEY;
  const model = process.env.ARK_MODEL_ID;
  if (!apiKey || !model) throw new Error('ARK_API_KEY 或 ARK_MODEL_ID 未配置');
  return {
    client: new OpenAI({ apiKey, baseURL: 'https://ark.cn-beijing.volces.com/api/v3' }),
    model
  };
};

// 课件幻灯片结构
interface Slide {
  index: number;
  title: string;
  content: string;
  notes: string; // 讲解词，用于 TTS
}

// 课件生成接口（保持原 path 向后兼容）
router.post('/generate-courseware', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      bookTitle, chapter, chapters, studentName, subject,
      teachingStyle, wrongProblems, ownerId,
      autoSave,
      existingSections, // 复用前一次生成结果，仅做保存
    } = req.body;

    if (!bookTitle || !chapter || !studentName) {
      return res.status(400).json({
        success: false,
        error: '缺少必需参数: bookTitle, chapter, studentName'
      });
    }

    // 多章节支持：优先使用 chapters 数组
    const chapterList: string[] = Array.isArray(chapters) && chapters.length > 0
      ? chapters
      : String(chapter).split(/[；;、,]/).map(s => s.trim()).filter(Boolean);
    const chapterCount = chapterList.length || 1;

    // 如果客户端传入 existingSections（用户在预览模态点保存），直接落库不再调 LLM
    if (autoSave === true && Array.isArray(existingSections) && existingSections.length > 0) {
      const id = uuidv4();
      const resolvedOwnerId = ownerId || 'shared';
      try {
        db.prepare(`
          INSERT INTO classroom_items
            (id, type, bookTitle, chapter, subject, ownerId, userName, contentJson, slideCount, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id, 'courseware', bookTitle, chapterList.join('；'),
          normalizeSubject(subject), resolvedOwnerId, studentName,
          JSON.stringify(existingSections), existingSections.length, Date.now()
        );
        console.log(`[Courseware] 复用已生成内容保存: ${id} (${existingSections.length} 节)`);
        return res.json({
          success: true,
          data: existingSections,
          id,
          saved: true,
          slideCount: existingSections.length,
        });
      } catch (dbErr: any) {
        console.error('[Courseware] 保存失败:', dbErr);
        return res.status(500).json({ success: false, error: '保存失败：' + dbErr.message });
      }
    }

    const { client, model } = getDoubaoClient();

    // 构建错题上下文
    let wrongCtx = '';
    if (wrongProblems && wrongProblems.length > 0) {
      const topics = wrongProblems
        .flatMap((item: any) => item.meta?.problems || [])
        .filter((p: any) => p.status === 'WRONG' || p.status === 'CORRECTED')
        .slice(0, 5)
        .map((p: any) => p.question || '(未识别)')
        .join('、');
      if (topics) wrongCtx = `\n学生历史薄弱点（请重点讲解）：${topics}`;
    }

    const styleMap: Record<string, string> = {
      rigorous: '语言严谨规范，逻辑层次分明，适合理科系统学习',
      storytelling: '用生活化情景和故事贯穿知识点，轻松有趣',
      practice: '以例题为核心，边讲边练，强调解题过程',
      exploration: '启发式提问引导学生思考，培养探究精神'
    };
    const styleDesc = styleMap[teachingStyle] || '语言严谨规范，逻辑层次分明';

    const systemPrompt = `你是一位优秀的学科教师，擅长用清晰易读的文章形式讲解知识点。
请严格按照指定 JSON 格式输出，不要输出任何其他文字。`;

    // 单章 5-8 节，N 章则线性放大
    const minSec = 5 * chapterCount;
    const maxSec = 8 * chapterCount;

    const chapterListBlock = chapterList.map((c, i) => `  ${i + 1}. ${c}`).join('\n');
    const userPrompt = `请为以下内容生成一份可读性强的课程讲义：
- 教材：《${bookTitle}》
- 章节（共 ${chapterCount} 个，必须每个章节都有内容覆盖）：
${chapterListBlock}
- 学科：${subject || '未指定'}
- 学生：${studentName}
- 讲解风格：${styleDesc}${wrongCtx}

生成要求：
1. 共生成 ${minSec}–${maxSec} 个知识节（section），按章节顺序依次覆盖。
2. 每个章节至少分配 4–6 节正文 + 1 个章节导入；所有章节内容生成完毕后，在最末追加 1 节「课程小结」。
3. 每节的 chapter 字段标注它属于上面哪个章节（与传入的章节标题一字不差）。
4. 每节的 content 字段：300-500 字，用流畅的文章段落讲解该知识点。
5. 每节的 notes 字段：以「老师」和「小明」对话形式自问自答，150-250 字。最末「课程小结」节的 notes 可为空字符串。
6. 「课程小结」的 content：用要点列表总结所有 ${chapterCount} 个章节的重点。

请以纯 JSON 数组格式返回（注意每节都要有 chapter 字段）：
[
  {"index":1,"chapter":"${chapterList[0]}","title":"章节导入","content":"...","notes":"老师：...？\\n小明：...。"},
  ...
  {"index":N,"chapter":"","title":"课程小结","content":"本课重点：\\n1. ...\\n2. ...","notes":""}
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
    // 清理可能的 markdown 代码块包裹
    const cleanJson = rawContent.replace(/^```json\n?|\n?```$/g, '').trim();

    let slides: Slide[];
    try {
      slides = JSON.parse(cleanJson);
      if (!Array.isArray(slides)) throw new Error('返回值不是数组');
    } catch (parseErr) {
      console.error('[Courseware] JSON 解析失败:', rawContent.substring(0, 200));
      return res.status(500).json({ success: false, error: '模型返回格式异常，请重试' });
    }

    // 仅在 autoSave !== false 时写入数据库
    let savedId = '';
    if (autoSave !== false) {
      const id = uuidv4();
      const resolvedOwnerId = ownerId || 'shared';
      try {
        db.prepare(`
          INSERT INTO classroom_items
            (id, type, bookTitle, chapter, subject, ownerId, userName, contentJson, slideCount, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id, 'courseware', bookTitle, chapterList.join('；'),
          normalizeSubject(subject), resolvedOwnerId, studentName,
          JSON.stringify(slides), slides.length, Date.now()
        );
        console.log(`[Courseware] 已保存到 classroom_items: ${id} (${slides.length} 节, ${chapterCount} 章)`);
        savedId = id;
      } catch (dbErr) {
        // DB 保存失败不影响主流程，记录日志即可
        console.error('[Courseware] 保存到数据库失败:', dbErr);
      }
    }

    return res.json({
      success: true,
      data: slides,
      id: savedId,
      saved: !!savedId,
      slideCount: slides.length
    });

  } catch (error: any) {
    console.error('[Courseware] 生成失败:', error);

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
