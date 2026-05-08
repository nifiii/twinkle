import { GoogleGenAI, Type } from '@google/genai';

/**
 * 图书元数据结构（AI 提取结果）
 */
export interface BookMetadataAI {
  title: string;           // 书名
  author: string;          // 作者
  subject: string;         // 学科（语文/数学/英语/物理/化学/生物/历史/地理/政治/其他）
  grade: string;           // 年级（如：三年级上册、高一上册）
  category: string;        // 类型（教科书/培训资料/工具书/课外读物）
  publisher: string;       // 出版社
  publishDate: string;     // 出版时间（YYYY-MM 格式，如：2023-06）
  confidence: number;      // 置信度 (0-1)
}

/**
 * 从 PDF 前 4 页文本中提取图书元数据
 * @param firstPagesText 前 4 页的文本内容
 * @param fileName 文件名（作为后备参考）
 * @returns AI 提取的结构化元数据
 */
export async function extractBookMetadataFromPages(
  firstPagesText: string[],
  fileName: string
): Promise<BookMetadataAI> {
  try {
    console.log('========================================');
    console.log('开始 AI 元数据提取');
    console.log('文件名:', fileName);
    console.log('输入文本页数:', firstPagesText.length);
    console.log('========================================');

    // 合并前 4 页文本
    const combinedText = firstPagesText.join('\n\n--- 页面分隔 ---\n\n');
    console.log('合并文本长度:', combinedText.length);
    console.log('前 200 字符预览:', combinedText.substring(0, 200));

    // 从环境变量读取 API Key
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('❌ GEMINI_API_KEY 未配置');
      throw new Error('GEMINI_API_KEY not configured');
    }
    console.log('✓ GEMINI_API_KEY 已配置');

    const ai = new GoogleGenAI({ apiKey });
    console.log('✓ GoogleGenAI 客户端初始化成功');

    // 设计精准的提示词
    const prompt = `你是一个专业的图书元数据提取助手。请从以下教材 PDF 的前 4 页文本中，提取图书的基本信息。

【文件名】${fileName}

【前 4 页文本内容】
${combinedText}

请严格按照以下 JSON 格式返回元数据，不要添加任何其他文字说明：

{
  "title": "书名（如果在前4页找不到，使用文件名去除扩展名）",
  "author": "作者或编者（如果没有则为空字符串）",
  "subject": "学科（必须从以下选项选择：语文、数学、英语、物理、化学、生物、历史、地理、政治、其他）",
  "grade": "年级（格式示例：一年级上册、二年级下册、高一上册、高三下册，如果无法确定则为空字符串）",
  "category": "类型（必须从以下选项选择：教科书、培训资料、工具书、课外读物，默认选择教科书）",
  "publisher": "出版社名称（如果没有则为空字符串）",
  "publishDate": "出版时间（格式：YYYY-MM，如果找不到则为空字符串，示例：2023-06、2022-01）",
  "confidence": 0.85
}

【提取规则】
1. **书名**：优先从封面或版权页提取，格式通常为"XXX教科书"或"XXX教材"
2. **学科**：根据书名和内容判断，必须是限定选项之一
3. **年级**：识别"X年级X学期"或"X年级X册"等格式
4. **类型**：教材类图书默认选择"教科书"
5. **出版社**：查找"出版社出版"或"出版社"等关键词
6. **出版时间**：查找"202X年X月"或"202X.X"格式，转换为 YYYY-MM
7. **置信度**：如果前4页信息充足，设置 0.8-1.0；信息缺失较多，设置 0.3-0.7

现在请提取并返回 JSON：`;

    // 调用 Gemini AI
    console.log('========================================');
    console.log('调用 Gemini AI 模型: gemini-2.0-flash-exp');
    console.log('========================================');

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash-exp',
      contents: prompt,
      config: {
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            author: { type: Type.STRING },
            subject: {
              type: Type.STRING,
              enum: ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治', '其他']
            },
            grade: { type: Type.STRING },
            category: {
              type: Type.STRING,
              enum: ['教科书', '培训资料', '工具书', '课外读物']
            },
            publisher: { type: Type.STRING },
            publishDate: { type: Type.STRING },
            confidence: { type: Type.NUMBER }
          },
          required: ['title', 'author', 'subject', 'grade', 'category', 'publisher', 'publishDate', 'confidence']
        }
      }
    });

    if (!response.text) {
      console.error('❌ AI 响应内容为空');
      throw new Error("AI 响应内容为空");
    }

    console.log('AI 原始响应长度:', response.text.length);
    console.log('AI 原始响应（前 500 字符）:', response.text.substring(0, 500));

    const result = JSON.parse(response.text) as BookMetadataAI;

    console.log('========================================');
    console.log('✓ AI 元数据提取成功');
    console.log('书名:', result.title);
    console.log('作者:', result.author);
    console.log('学科:', result.subject);
    console.log('年级:', result.grade);
    console.log('类型:', result.category);
    console.log('出版社:', result.publisher);
    console.log('出版时间:', result.publishDate);
    console.log('置信度:', result.confidence);
    console.log('========================================');

    return result;
  } catch (error) {
    console.error('========================================');
    console.error('❌ AI 元数据提取失败');
    console.error('错误详情:', error);
    if (error instanceof Error) {
      console.error('错误消息:', error.message);
      console.error('错误堆栈:', error.stack);
    }
    console.error('========================================');

    // 降级处理：返回基于文件名的默认值
    console.log('使用降级方案：基于文件名生成默认元数据');
    const fallbackTitle = fileName.replace(/\.(pdf|epub|txt)$/i, '');

    return {
      title: fallbackTitle,
      author: '',
      subject: '其他',
      grade: '',
      category: '教科书',
      publisher: '',
      publishDate: '',
      confidence: 0.0,
    };
  }
}
