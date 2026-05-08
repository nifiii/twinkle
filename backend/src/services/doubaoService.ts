import OpenAI from 'openai';
import { ChapterNode } from '../types.js';
import fs from 'fs/promises';
import path from 'path';
import { extractPagesAsImages } from './imageService.js';

// 初始化 OpenAI 客户端 (适配火山引擎)
const getDoubaoClient = () => {
  const apiKey = process.env.ARK_API_KEY;
  const model = process.env.ARK_MODEL_ID;

  if (!apiKey || !model) {
    throw new Error('缺少有效的 ARK_API_KEY 或 ARK_MODEL_ID 环境变量');
  }

  return {
    client: new OpenAI({
      apiKey: apiKey,
      baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    }),
    model: model
  };
};

export interface DoubaoMetadataResult {
  title: string;
  author?: string;
  subject: string;
  category: string;
  grade: string;
  tags: string[];
  publisher?: string;
  publishDate?: string;
  tableOfContents: ChapterNode[];
}

export interface DoubaoMetadataResult {
  title: string;
  author?: string;
  subject: string;
  category: string;
  grade: string;
  tags: string[];
  publisher?: string;
  publishDate?: string;
  tableOfContents: ChapterNode[];
}

const SYSTEM_PROMPT = `你是一个专业的图书元数据分析专家。
你的任务是根据用户提供的图书内容片段，提取以下结构化元数据，并以纯 JSON 格式返回。

需要提取的字段：
1. **title**: 书名（通常在文件开头，或者包含"义务教育教科书"等字眼，请提取完整书名）
2. **author**: 作者（选填，若无法确定则留空）
3. **subject**: 学科分类（数学/物理/化学/生物/英语/语文/历史/地理/政治/其他）
4. **category**: 图书类型（教材/教辅/竞赛资料/考试真题/课外读物/其他）
5. **grade**: 年级段（格式如："七年级上册"、"高中一年级"、"小学三年级"等）
6. **tags**: 标签数组（如：["奥数", "几何", "代数"]，["中考", "真题"]等）
7. **publisher**: 出版社名称（**极其重要**！必须仔细在文本中查找如：人民教育出版社、外研社等机构名称，即使位置不显眼也请务必提取）
8. **publishDate**: 出版日期（格式：YYYY-MM 或 YYYY）
9. **tableOfContents**: 章节目录扁平数组（包含 id, title, level 字段，level 1=章, 2=节）

请直接返回 JSON 对象，不要包含 markdown 代码块标记。`;

/**
 * 使用豆包分析图书元数据
 */
export async function analyzeMetadataWithDoubao(
  text: string,
  fileName: string
): Promise<DoubaoMetadataResult> {
  const { client, model } = getDoubaoClient();
  const contentSample = text.substring(0, 8000);
  const userPrompt = `文件名: ${fileName}\n\n图书内容片段:\n${contentSample}`;

  const t0 = Date.now();
  console.log(`[Doubao][analyzeMetadata] >>> 开始请求 model=${model} fileName=${fileName} contentLen=${text.length}`);

  try {
    const completion = await client.chat.completions.create({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      model: model,
      temperature: 0.1,
    });

    const elapsed = Date.now() - t0;
    const usage = completion.usage;
    console.log(`[Doubao][analyzeMetadata] <<< 完成 耗时=${elapsed}ms prompt_tokens=${usage?.prompt_tokens} completion_tokens=${usage?.completion_tokens}`);

    const rawContent = completion.choices[0].message.content || '{}';
    const cleanJson = rawContent.replace(/```json\n?|\n?```/g, '').trim();
    return JSON.parse(cleanJson);
  } catch (error: any) {
    const elapsed = Date.now() - t0;
    console.error(`[Doubao][analyzeMetadata] !!! 请求失败 耗时=${elapsed}ms status=${error?.status} type=${error?.type} message=${error?.message}`);
    throw error;
  }
}

/**
 * 针对扫描版 PDF，先通过 imageService 取封面，然后调用 Doubao 多模态 API 识别。
 */
export async function extractMetadataFromPDFWithDoubao(
  pdfPath: string,
  fileName: string
): Promise<DoubaoMetadataResult> {
  const { client, model } = getDoubaoClient();

  // 1. 调用本地 PDF 封面(或前几页)抽取服务提取多张图片
  const tempDir = path.join(process.cwd(), 'uploads', 'covers');
  let extractedImages: string[] = [];
  try {
    // 根据需求，提取前4页以确保涵盖了封面、扉页、版权页以及目录等元信息
    extractedImages = await extractPagesAsImages(pdfPath, tempDir, 4);
    if (!extractedImages || extractedImages.length === 0) {
      throw new Error("未能生成任何封面图片");
    }
  } catch (err: any) {
    console.error("生成或读取页面图片失败，将使用占位图测试 Vision API (Windows 开发环境无 pdftoppm 可能触发):", err.message);
    // 开发环境如果遇到 pdftoppm 确实，发一张占位图避免流程中断，便于本地全链路测试
    extractedImages = [];
  }

  // 2. 将图片转换为 Base64
  let base64Images: string[] = [];
  if (extractedImages.length > 0) {
    for (const imgName of extractedImages) {
      const imgPath = path.join(tempDir, imgName);
      try {
        const buffer = await fs.readFile(imgPath);
        base64Images.push(buffer.toString('base64'));
      } catch (e) {
        console.error("读取本地图片报错: " + imgPath, e);
      }
    }
  }

  // 如果连一张图片都没有成功提取出来，说明无法进行多模态分析，直接返回兜底元数据
  if (base64Images.length === 0) {
    console.warn('多模态图片提取失败，无法进行 Vision 解析，返回基础推测元数据。');
    return {
      title: fileName.replace('.pdf', ''),
      subject: '其他',
      category: '其他',
      grade: '未知',
      tags: [],
      tableOfContents: []
    };
  }

  // 3. 构建多模态 Vision 请求
  const systemPrompt = `你是一个专业的图书元数据提取助手。请仔细分析这些图片，提取图书的基本信息。
请返回如下结构的纯 JSON 对象，不要带有 markdown 标记：
{
  "title": "书名",
  "author": "作者/编者（若无则留空）",
  "subject": "学科（如：语文/数学/英语/物理/化学等，必填）",
  "category": "主要类别（如：教材/教辅/课外读物等，必填）",
  "grade": "适用年级（如：小学三年级下册、高中一年级等，必填）",
  "tags": ["特征标签1", "标签2"],
  "publisher": "出版社名称（若无则留空）",
  "publishDate": "出版日期，格式 YYYY-MM（若无则留空）",
  "tableOfContents": []
}

【提取重点】
1. **title**：通常在封面正中央，字体最大最醒目（请提取完整的书名，例如"义务教育教科书 英语 三年级下册"）
2. **author**：通常在封面下方或版权页
3. **subject**：判断这是哪一门学科（如：语文/数学/英语/物理/化学等）
4. **category**：判断这是教材/教辅/课外读物等
5. **grade**：根据书名或封面上的描述判断，例如"义务教育教科书·英语三年级下册"则为"三年级下册"或"小学三年级下册"
6. **tags**：提取一些关键标签（如：中考、人教版、2022版课标、义务教育等）
7. **publisher**：**极其重要**！必须在封面的最底部、扉页或版权页仔细查找出版社全称（如：人民教育出版社、外语教学与研究出版社等）。即使字号较小也请务必辨认。
8. **publishDate**：查找版权页上的出版年份如 YYYY-MM`;

  // 构造 content 数组：1 个 text 提示词 + N 个 image_url 图片
  const messageContent: any[] = [
    { type: "text", text: systemPrompt + "\n文件名: " + fileName }
  ];

  for (let i = 0; i < base64Images.length; i++) {
    const b64 = base64Images[i];
    // 如果已经带有前缀(如占位图)，直接使用，否则加上 jpeg 前缀
    const url = b64.startsWith('data:image/') ? b64 : `data:image/jpeg;base64,${b64}`;
    messageContent.push({
      type: "image_url",
      image_url: { url }
    });
  }

  const t0Vision = Date.now();
  console.log(`[Doubao][Vision] >>> 开始请求 model=${model} fileName=${fileName} images=${base64Images.length}`);

  try {
    const response = await client.chat.completions.create({
      model: model,
      temperature: 0.1,
      messages: [
        {
          role: "user",
          content: messageContent
        }
      ],
    });
    const elapsedVision = Date.now() - t0Vision;
    const usageVision = response.usage;
    console.log(`[Doubao][Vision] <<< 完成 耗时=${elapsedVision}ms prompt_tokens=${usageVision?.prompt_tokens} completion_tokens=${usageVision?.completion_tokens}`);
    let content = response.choices[0].message.content;
    if (!content) throw new Error('Doubao API 返回空内容');

    // 尝试提取 ```json ... ``` 中的内容
    const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) || content.match(/```\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      content = jsonMatch[1];
    }

    console.log('Doubao Vision API 返回原始内容:', content);

    // 尝试移除非 JSON 内容 (例如被 markdown 格式包裹的代码块)
    const jsonStr = content.replace(/```json\n?|\n?```/g, '').trim();
    const result = JSON.parse(jsonStr) as DoubaoMetadataResult;

    // 标准化校验科目
    const validSubjects = ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治'];
    if (!validSubjects.includes(result.subject)) {
      result.subject = '其他';
    }

    return result;
  } catch (error: any) {
    const elapsedVisionErr = Date.now() - t0Vision;
    console.error(`[Doubao][Vision] !!! 请求失败 耗时=${elapsedVisionErr}ms status=${error?.status} type=${error?.type} message=${error?.message}`);
    // 返回一个默认兜底，保证流程不完全中断
    return {
      title: fileName.replace(/\.pdf$/i, ''),
      subject: '其他',
      category: '其他', // Add default for required fields
      grade: '未知', // Add default for required fields
      tags: [], // Add default for required fields
      tableOfContents: [] // Add default for required fields
    };
  }
}

/**
 * 针对扫描版 PDF 的全本 OCR 内容转 Markdown
 * 将整个 PDF 拆分为图片，分批 (如 3张一批) 调用豆包 Vision 模型处理
 */
export async function convertPDFToMarkdownWithDoubaoOCR(
  pdfPath: string,
  fileName: string
): Promise<string> {
  const { client, model } = getDoubaoClient();
  const tempDir = path.join(process.cwd(), 'uploads', 'temp_ocr');

  let extractedImages: string[] = [];
  try {
    // 1. 调用本地服务提取所有页面为图片 (pageCount = -1 表示提取全部)
    console.log(`[OCR] 开始提取全本 PDF 图片: ${pdfPath}`);
    extractedImages = await extractPagesAsImages(pdfPath, tempDir, -1);
    if (!extractedImages || extractedImages.length === 0) {
      throw new Error("未能生成任何 PDF 页面图片");
    }
    console.log(`[OCR] 成功提取 ${extractedImages.length} 页图片。`);
  } catch (err: any) {
    console.error(`[OCR] 提取 PDF 失败: ${err.message}`);
    return `> [!WARNING] OCR环境提取失败，或由于服务器未安装完整 Poppler 依赖。\n> \n> 请检查服务器 \`pdftoppm\` 是否正常工作。`;
  }

  // 2. 将图片划分为批次，避免单次 Token 溢出与频繁并发
  const batchSize = 3;
  const concurrencyLimit = 3; // 最大同时进行的 API 请求数 (3批 = 同时处理 9页)
  const totalBatches = Math.ceil(extractedImages.length / batchSize);
  
  // 预先分配结果数组，保证并发结束后按顺序拼接
  let markdownResults: string[] = new Array(totalBatches).fill('');

  const systemPrompt = `你是一个专业的图书排版与 OCR 专家。你的任务是将输入的原始扫描版页面图片，精确地转换为排版优良、结构清晰的 Markdown 文档。
要求：
1. 【核心内容提取】提取图片中的所有正文文本，不要总结或摘要！必须是原原本本的全文识别。
2. 【目录特殊处理】**极其重要**！如果你识别出当前页面是“目录（Table of Contents）”或包含目录结构：
   - 必须使用规范的 Markdown 无序或有序列表（如 \`- \` 或 \`1. \`）来表现层级缩进。
   - 必须将对应的页码准确无误地保留在每行目录的末尾。
3. 【标题层级】保持原有的标题层级（识别出大字或标题样式时，使用 #，## 等）。
4. 【段落排版】如果有明显的分段断行，请用空行隔开。如果遇到多栏排版或跨页排版，请尝试以线性的阅读顺序输出。
5. 【纯净输出】只输出纯粹的 Markdown 文本，**绝对不要**包含任何诸如“以下是转换结果”之类的开场白或缩减内容。`;

  console.log(`[OCR] 开始将 ${extractedImages.length} 页图片分批发送给 Doubao Vision 模型。共 ${totalBatches} 批，每批 ${batchSize} 页。最大并发数: ${concurrencyLimit}`);

  // 极简版本的并发控制器 (Semaphore)
  const processBatchWithLimit = async (batchIndex: number) => {
    const startIndex = batchIndex * batchSize;
    const batchImages = extractedImages.slice(startIndex, startIndex + batchSize);
    console.log(`[OCR] 开始处理第 ${batchIndex + 1} 批 / 共 ${totalBatches} 批 (处理页数: ${startIndex + 1} ~ ${startIndex + batchImages.length})`);

    const messageContent: any[] = [
      { type: "text", text: "请将这几张页面内容精确地转录为 Markdown。\n\n" }
    ];

    let hasValidImage = false;
    for (const imgName of batchImages) {
      const imgPath = path.join(tempDir, imgName);
      try {
        const buffer = await fs.readFile(imgPath);
        const b64 = buffer.toString('base64');
        messageContent.push({
          type: "image_url",
          image_url: { url: `data:image/jpeg;base64,${b64}` }
        });
        hasValidImage = true;
      } catch (e) {
        console.error(`[OCR] 读取图片文件失败: ${imgPath}`, e);
      }
    }

    if (!hasValidImage) {
      markdownResults[batchIndex] = '';
      return;
    }

    let retryCount = 0;
    let success = false;
    const maxRetries = 4; // 增加独立重试次数以防高并发失败

    while (retryCount <= maxRetries && !success) {
      const tBatch = Date.now();
      try {
        console.log(`[Doubao][OCR] >>> 批次 ${batchIndex + 1}/${totalBatches} 开始请求 model=${model}`);
        const response = await client.chat.completions.create({
          model: model,
          temperature: 0.1,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: messageContent }
          ]
        } as any);

        const elapsedBatch = Date.now() - tBatch;
        const usageBatch = response.usage;
        console.log(`[Doubao][OCR] <<< 批次 ${batchIndex + 1} 完成 耗时=${elapsedBatch}ms prompt_tokens=${usageBatch?.prompt_tokens} completion_tokens=${usageBatch?.completion_tokens}`);

        let content = response.choices[0]?.message?.content || '';
        content = content.replace(/^```markdown\n?|```\n?$/g, '').trim();

        if (content) {
          markdownResults[batchIndex] = content;
          success = true;
          console.log(`[OCR] 第 ${batchIndex + 1} 批处理成功 ✅`);
        } else {
          throw new Error('Doubao API 返回空内容');
        }
      } catch (apiErr: any) {
        retryCount++;
        console.warn(`[Doubao][OCR] !!! 批次 ${batchIndex + 1} 请求失败 (重试 ${retryCount}/${maxRetries}) status=${apiErr?.status} type=${apiErr?.type} message=${apiErr?.message}`);
        if (retryCount <= maxRetries) {
          // 指数退避加随机抖动，避免并发拥堵
          const baseDelay = 2000 * Math.pow(2, retryCount - 1);
          const jitter = Math.random() * 1000;
          await new Promise(res => setTimeout(res, baseDelay + jitter));
        } else {
          console.error(`[OCR] ❌ 第 ${batchIndex + 1} 批最终彻底失败。`);
          markdownResults[batchIndex] = `\n\n> [!CAUTION] 转换失败 (页码 ${startIndex + 1}~${startIndex + batchImages.length})\n> 模型并发调用异常或达到重试上限。\n\n`;
        }
      }
    }
  };

  // 实现并发队列池
  let activePromises = new Set<Promise<void>>();
  for (let i = 0; i < totalBatches; i++) {
    const p = processBatchWithLimit(i);
    activePromises.add(p);
    
    // 当 p 结束后从池中移除
    p.finally(() => activePromises.delete(p));
    
    // 如果达到了并发上限，就等待池子里最快结束的一个任务
    if (activePromises.size >= concurrencyLimit) {
      await Promise.race(activePromises);
    }
  }
  
  // 等待剩余所有的批次全部执行完
  await Promise.all(activePromises);

  // 3. 清理临时目录下的本批图片
  console.log(`[OCR] 所有并行批次转换完毕，正在清理 ${extractedImages.length} 个临时图片文件...`);
  for (const imgName of extractedImages) {
    try {
      await fs.unlink(path.join(tempDir, imgName));
    } catch (e) {
      // ignore
    }
  }

  // 返回最终大拼接文本
  return markdownResults.join('\n\n---\n\n');
}

/**
 * 将文本按自然段落切分为小分片
 * 优先在换行符/句号处切割，避免截断句子
 */
function splitTextIntoChunks(text: string, chunkSize: number = 6000): string[] {
  const chunks: string[] = [];
  let currentPos = 0;

  while (currentPos < text.length) {
    let endPos = currentPos + chunkSize;
    if (endPos >= text.length) {
      chunks.push(text.substring(currentPos));
      break;
    }

    // 尝试在换行符处切割，保持段落完整
    const lastNewline = text.lastIndexOf('\n', endPos);
    if (lastNewline > currentPos + (chunkSize * 0.7)) {
      endPos = lastNewline + 1;
    }

    chunks.push(text.substring(currentPos, endPos));
    currentPos = endPos;
  }

  return chunks;
}


// ── convertToMarkdownWithDoubao 配置 ──────────────────────
// 每片 6000 字：单次 API 响应 ~30-60s（vs 40k 分片的 26分钟）
// 全并发后总耗时 ≈ 最慢单片耗时
const CHUNK_SIZE = 6000;
const MAX_CONCURRENCY = 6; // 豆包 API QPS 一般允许 5-10

// Prompt：强制 KaTeX 兼容格式，禁止裸 \begin{aligned} 或 \begin{array}
const CONVERT_SYSTEM_PROMPT = `你是一个专业的中文教材排版专家，将 PDF 原始文本转换为规范的 Markdown 格式。

**格式规则（必须严格遵守）：**
1. **标题层级**：章节名用 \`##\`，小节用 \`###\`，例题/练习用 \`####\`。
2. **数学公式**：
   - 所有数学公式、算式、竖式必须使用 LaTeX。
   - 行内短公式：\`$a+b=c$\`（单个 \$ 包裹）。
   - 独立公式块（运算步骤、对齐式、竖式计算等）**必须**用双美元符号单独成行包裹：
     \`\`\`
     $$
     \begin{array}...\end{array}
     $$
     \`\`\`
   - **绝对禁止** 在 Markdown 正文中直接以 \`\\begin{环境}\` 开头，必须外层包裹 \`$$\`。
3. **列表与段落**：有序用 \`1.\`，无序用 \`-\`。用空行分隔段落，不改变原文内容和顺序。
4. **分片衔接规则**：
   - **严禁** 在分片开头或结尾添加任何人工痕迹，如“续前文”、“待续”、“本部分结束”等。
   - **严禁** 重复输出前一个分片的结尾。
   - 保持文本输出的纯净性，直接输出转换后的 Markdown 核心内容。
5. **完整性**：严禁删减、摘要或省略任何原文内容。
6. **纯输出**：只输出 Markdown，不包含任何解释说明文字。`;

/**
 * 使用豆包将 PDF 文本转换为 Markdown
 * 策略：小分片(6k字符) + 全并发(≤6个同时) → 大幅缩短总耗时
 */
export async function convertToMarkdownWithDoubao(
  text: string
): Promise<string> {
  const { client, model } = getDoubaoClient();

  // 1. 切分文本
  const chunks = splitTextIntoChunks(text, CHUNK_SIZE);
  const totalChunks = chunks.length;
  console.log(`[Doubao][convertMD] 文本 ${text.length} 字符，切分为 ${totalChunks} 片(每片≤${CHUNK_SIZE}字)，最大并发=${MAX_CONCURRENCY}`);

  // 预分配结果数组，保证拼接顺序
  const results: string[] = new Array(totalChunks).fill('');

  // 处理单个分片，含指数退避重试
  async function processChunk(idx: number): Promise<void> {
    const chunk = chunks[idx];
    const maxRetries = 3;
    let retryCount = 0;

    while (retryCount <= maxRetries) {
      const t0 = Date.now();
      try {
        console.log(`[Doubao][convertMD] >>> 分片 ${idx + 1}/${totalChunks} 开始 len=${chunk.length} retry=${retryCount}`);
        const completion = await client.chat.completions.create({
          model,
          temperature: 0.1,
          max_tokens: 8192,
          messages: [
            { role: 'system', content: CONVERT_SYSTEM_PROMPT },
            {
              role: 'user',
              content: `这是文档第 ${idx + 1}/${totalChunks} 部分，请转换为 Markdown：\n\n${chunk}`
            }
          ]
        } as any);

        const elapsed = Date.now() - t0;
        const usage = completion.usage;
        const content = (completion.choices[0].message.content || '').trim();
        console.log(`[Doubao][convertMD] <<< 分片 ${idx + 1} 完成 耗时=${elapsed}ms prompt_tokens=${usage?.prompt_tokens} completion_tokens=${usage?.completion_tokens} outputLen=${content.length}`);

        if (!content) throw new Error('API 返回空内容');
        results[idx] = content;
        return;

      } catch (err: any) {
        const elapsed = Date.now() - t0;
        retryCount++;
        console.warn(`[Doubao][convertMD] !!! 分片 ${idx + 1} 失败 retry=${retryCount}/${maxRetries} 耗时=${elapsed}ms status=${err?.status} type=${err?.error?.type} msg=${err?.message}`);
        if (retryCount > maxRetries) {
          results[idx] = `\n\n> [!CAUTION] 分片 ${idx + 1}/${totalChunks} 转换失败（已重试 ${maxRetries} 次）\n\n`;
          return;
        }
        // 指数退避 + 随机抖动
        const delay = Math.min(2000 * Math.pow(2, retryCount - 1) + Math.random() * 1000, 30000);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  // 2. 并发执行（信号量控制最大并发数）
  const running = new Set<Promise<void>>();
  for (let idx = 0; idx < totalChunks; idx++) {
    if (running.size >= MAX_CONCURRENCY) {
      await Promise.race(running);
    }
    const p = processChunk(idx).finally(() => running.delete(p));
    running.add(p);
  }
  await Promise.all(running);

  // 3. 按顺序拼接
  const finalMarkdown = results.join('\n\n').trim();
  console.log(`[Doubao][convertMD] 全部 ${totalChunks} 片完成，总输出 ${finalMarkdown.length} 字符`);
  return finalMarkdown;
}

/**
 * 从完整的 Markdown 文本中提取目录结构
 */
export async function extractTOCFromMarkdown(
  markdown: string,
  title: string
): Promise<ChapterNode[]> {
  const { client, model } = getDoubaoClient();
  
  // 截取前 30,000 字符，通常目录出现在开头
  const sample = markdown.substring(0, 30000);
  
  const systemPrompt = `你是一个专业的图书结构分析专家。你的任务是从提供的 Markdown 文本中提取图书的层级目录（Table of Contents）。
要求：
1. **识别层级**：区分章、节、课、单元等。
2. **提取页码**：如果有页码信息，请务必保留。
3. **输出格式**：返回标准的 JSON 数组，每个元素包含 id, title, level (1=章, 2=节/课, 3=小节/框题)。
4. **排除正文**：只提取目录区域的内容，不要误将后续的正文内容当作目录提取。
5. **JSON 结构**：
[
  { "id": "1", "title": "第一章 XXX", "level": 1 },
  { "id": "1.1", "title": "第一节 YYY", "level": 2 }
]
请直接返回 JSON 代码块。`;

  const userPrompt = `书名: ${title}\n\nMarkdown 内容片段 (包含目录页):\n${sample}`;

  try {
    console.log(`[Doubao][TOC] >>> 开始从 Markdown 提取目录, 采样长度: ${sample.length}`);
    const completion = await client.chat.completions.create({
      model: model,
      temperature: 0.1,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    } as any);

    let content = completion.choices[0]?.message?.content || '[]';
    // 清理 Markdown 代码块包裹
    content = content.replace(/^```json\n?|```\n?$/g, '').trim();
    
    const toc = JSON.parse(content);
    console.log(`[Doubao][TOC] <<< 提取成功，共 ${Array.isArray(toc) ? toc.length : 0} 个目录项`);
    return toc;
  } catch (error: any) {
    console.error('[Doubao][TOC] !!! 提取目录失败:', error.message);
    return [];
  }
}
