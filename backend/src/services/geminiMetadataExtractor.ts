import { GoogleGenAI, Type } from '@google/genai';

/**
 * 图书元数据接口
 */
export interface BookMetadata {
  title: string;
  author: string;
  subject: string;
  grade: string;
  category: string;
  publisher: string;
  publishDate: string;
}

/**
 * 字段置信度
 */
export interface FieldConfidence {
  title?: number;
  author?: number;
  subject?: number;
  grade?: number;
  category?: number;
  publisher?: number;
  publishDate?: number;
}

/**
 * 完整提取结果
 */
export interface ExtractionResult {
  metadata: BookMetadata;
  confidence: {
    overall: number;
    fields: FieldConfidence;
  };
}

/**
 * 从文件名提取图书元数据
 * @param fileName PDF 文件名
 * @returns 提取的元数据和置信度
 */
export async function extractMetadataFromFileName(
  fileName: string
): Promise<ExtractionResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  console.log('========================================');
  console.log('使用 Gemini 2.0 Flash 提取图书元数据');
  console.log('文件名:', fileName);
  console.log('========================================');

  const genAI = new GoogleGenAI({ apiKey });

  const prompt = `你是一个专业的图书元数据提取助手。请根据以下教材 PDF 文件名，推断图书的基本信息。

【文件名】${fileName}

请严格按照以下 JSON 格式返回元数据，不要添加任何其他文字说明（包括 markdown 代码块标记）：

{
  "title": "书名（根据文件名推断，去除版本说明等额外信息）",
  "author": "作者或编者（如果文件名中没有则为空字符串）",
  "subject": "学科（必须从以下选项选择：语文、数学、英语、物理、化学、生物、历史、地理、政治、其他）",
  "grade": "年级（格式示例：一年级上册、二年级下册、高一上册、高三下册，如果无法确定则为空字符串）",
  "category": "类型（必须从以下选项选择：教科书、培训资料、工具书、课外读物，默认选择教科书）",
  "publisher": "出版社名称（如果文件名中没有则为空字符串）",
  "publishDate": "出版时间（格式：YYYY-MM、YYYY，如果找不到则为空字符串，示例：2023-06、2022）",
  "confidence": {
    "overall": 0.85,
    "fields": {
      "title": 0.9,
      "author": 0.5,
      "subject": 0.95,
      "grade": 0.8,
      "category": 0.9,
      "publisher": 0.3,
      "publishDate": 0.3
    }
  }
}

【推断规则】
1. **书名**：从文件名中提取核心名称，去除"义务教育教科书"、"根据课程标准修订"等修饰词
2. **学科**：根据文件名中的学科关键词判断，必须是限定选项之一
3. **年级**：识别"X年级X学期"、"X年级X册"、"X上/下册"等格式
4. **类型**：教材类图书默认选择"教科书"
5. **出版社**：如果文件名中没有则为空字符串
6. **出版时间**：如果文件名中没有则为空字符串
7. **置信度**：
   - overall: 整体置信度（0-1），根据文件名信息充足度判断
   - fields: 每个字段的置信度（0-1）
   - 文件名明确包含的字段（如学科、年级）设置 0.8-1.0
   - 文件名不包含的字段（如作者、出版社）设置 0.0-0.4

请直接返回 JSON 对象，不要使用 markdown 代码块。`;

  try {
    console.log('调用 Gemini API...');

    const response = await genAI.models.generateContent({
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
            confidence: {
              type: Type.OBJECT,
              properties: {
                overall: { type: Type.NUMBER },
                fields: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.NUMBER },
                    author: { type: Type.NUMBER },
                    subject: { type: Type.NUMBER },
                    grade: { type: Type.NUMBER },
                    category: { type: Type.NUMBER },
                    publisher: { type: Type.NUMBER },
                    publishDate: { type: Type.NUMBER }
                  }
                }
              }
            }
          },
          required: ['title', 'author', 'subject', 'grade', 'category', 'publisher', 'publishDate', 'confidence']
        }
      }
    });

    if (!response.text) {
      throw new Error('Gemini 返回空响应');
    }

    // Gemini 返回的 JSON 结构是扁平的（title, author 等），需要包装成 ExtractionResult 格式
    const parsed = JSON.parse(response.text);

    console.log('========================================');
    console.log('✓ Gemini 元数据提取成功');
    console.log('原始响应:', JSON.stringify(parsed, null, 2));
    console.log('书名:', parsed.title);
    console.log('作者:', parsed.author);
    console.log('学科:', parsed.subject);
    console.log('年级:', parsed.grade);
    console.log('类型:', parsed.category);
    console.log('出版社:', parsed.publisher);
    console.log('出版时间:', parsed.publishDate);
    console.log('整体置信度:', parsed.confidence?.overall);
    console.log('========================================');

    // 包装成正确的 ExtractionResult 结构
    const result: ExtractionResult = {
      metadata: {
        title: parsed.title || '',
        author: parsed.author || '',
        subject: parsed.subject || '其他',
        grade: parsed.grade || '',
        category: parsed.category || '教科书',
        publisher: parsed.publisher || '',
        publishDate: parsed.publishDate || ''
      },
      confidence: parsed.confidence || {
        overall: 0,
        fields: {}
      }
    };

    return result;
  } catch (error) {
    console.error('========================================');
    console.error('❌ Gemini 元数据提取失败');
    console.error('错误详情:', error);
    if (error instanceof Error) {
      console.error('错误消息:', error.message);
      console.error('错误堆栈:', error.stack);
    }
    console.error('========================================');

    // 降级处理：返回基于文件名的默认值
    const fallbackTitle = fileName.replace(/\.(pdf|epub|txt)$/i, '');

    return {
      metadata: {
        title: fallbackTitle,
        author: '',
        subject: '其他',
        grade: '',
        category: '教科书',
        publisher: '',
        publishDate: ''
      },
      confidence: {
        overall: 0.0,
        fields: {}
      }
    };
  }
}
