import { GoogleGenAI, Type } from '@google/genai';
import { ChapterNode } from '../types';

// 延迟初始化：仅在调用时检查 API Key，避免阻塞服务启动
const getAIClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'PLACEHOLDER_API_KEY') {
    throw new Error('缺少有效的 GEMINI_API_KEY 环境变量');
  }
  return new GoogleGenAI({ apiKey });
};

export interface BookMetadataAnalysisResult {
  title: string;
  author?: string;
  subject: string;
  category: string;
  grade: string;
  tags: string[];
  tableOfContents: ChapterNode[];
}

const METADATA_ANALYSIS_SYSTEM_INSTRUCTION = `你是一个专业的图书元数据分析专家。
你的任务是根据用户提供的图书内容片段，提取以下结构化元数据：

1. **title**: 书名（必填）
2. **author**: 作者（选填，若无法确定则留空）
3. **subject**: 学科分类（数学/物理/化学/生物/英语/语文/历史/地理/政治等）
4. **category**: 图书类型（教材/教辅/竞赛资料/考试真题/课外读物）
5. **grade**: 年级段（小学/初中/高中/大学/其他）
6. **tags**: 标签数组（如：["奥数", "几何", "代数"]，["中考", "真题"]等）
7. **tableOfContents**: 章节目录扁平数组（⚠️ 重要：不要使用嵌套结构）

**章节目录规则**：
- 返回扁平数组，每个章节用 level 字段标识层级
- level=1: 章（Chapter）
- level=2: 节（Section）
- level=3: 小节（Subsection）
- 每个章节需要包含：id（唯一标识），title（标题），level（层级）
- pageRange 可选，如果能从内容中推断出页码范围则填写
- 如果用户提供了初步目录，请优化和完善它；若没有，请根据内容自行提取

**注意**：
- 必须严格按照 JSON Schema 输出
- tableOfContents 必须是扁平数组，不要包含 children 字段
- 若某字段无法确定，请给出最合理的推测
- 标签要精准、实用，避免冗余`;

/**
 * 使用 Gemini 分析图书元数据
 * @param bookContent 图书文本内容片段（前3000字）
 * @param preliminaryTOC 初步提取的目录（可选）
 * @param fileName 文件名（辅助分析）
 * @returns 结构化元数据
 */
export async function analyzeBookMetadata(
  bookContent: string,
  preliminaryTOC: ChapterNode[] = [],
  fileName: string = ''
): Promise<BookMetadataAnalysisResult> {
  try {
    // 截取前 3000 字作为样本（避免 token 过多）
    const contentSample = bookContent.substring(0, 3000);

    const prompt = `请分析以下图书信息并提取元数据：

**文件名**: ${fileName}

**内容片段**:
${contentSample}

**已提取的初步目录**:
${preliminaryTOC.length > 0 ? JSON.stringify(preliminaryTOC, null, 2) : '无'}

请返回完整的结构化元数据。`;

    const ai = getAIClient();
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        role: 'user',
        parts: [{ text: prompt }],
      },
      config: {
        systemInstruction: METADATA_ANALYSIS_SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: {
              type: Type.STRING,
              description: '书名',
            },
            author: {
              type: Type.STRING,
              description: '作者',
              nullable: true,
            },
            subject: {
              type: Type.STRING,
              description: '学科分类',
            },
            category: {
              type: Type.STRING,
              description: '图书类型',
            },
            grade: {
              type: Type.STRING,
              description: '年级段',
            },
            tags: {
              type: Type.ARRAY,
              items: {
                type: Type.STRING,
              },
              description: '标签数组',
            },
            tableOfContents: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  title: { type: Type.STRING },
                  level: { type: Type.NUMBER },
                  pageRange: {
                    type: Type.OBJECT,
                    properties: {
                      start: { type: Type.NUMBER },
                      end: { type: Type.NUMBER },
                    },
                    nullable: true,
                  },
                },
                required: ['id', 'title', 'level'],
              },
              description: '章节目录扁平数组（使用 level 区分层级，1=章，2=节，3=小节）',
            },
          },
          required: ['title', 'subject', 'category', 'grade', 'tags', 'tableOfContents'],
        },
      },
    });

    const rawJson = response.text;
    if (!rawJson) {
      throw new Error('AI 返回结果为空');
    }
    const metadata: BookMetadataAnalysisResult = JSON.parse(rawJson);

    // 为每个章节添加空 children 数组（前端兼容性）
    if (metadata.tableOfContents) {
      metadata.tableOfContents = metadata.tableOfContents.map((chapter) => ({
        ...chapter,
        children: [],
      }));
    }

    console.log('元数据分析成功:', metadata.title);
    return metadata;
  } catch (error) {
    console.error('Gemini 元数据分析失败:', error);
    const message = error instanceof Error ? error.message : '未知错误';
    throw new Error(`元数据分析失败: ${message}`);
  }
}
