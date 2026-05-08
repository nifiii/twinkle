# AI-Powered Book Metadata Extraction Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现基于 AI 的图书元数据智能提取功能，通过解析 PDF 前 4 页内容，使用 Gemini AI 提取结构化元数据，并存储到指定目录结构中。

**Architecture:**
1. 使用 `pdfjs-dist` 替换 `pdf-parse`，仅提取前 4 页文本和封面图片
2. 设计 Gemini AI 提示词，从前 4 页文本中提取元数据
3. 修改 `/api/upload-book/parse` 端点，集成 AI 元数据提取
4. 扩展前端编辑器字段，支持完整的图书元数据
5. 实现文件存储策略：`/opt/hl-os/data/originals/books/` 按 ownerId 归档

**Tech Stack:**
- `pdfjs-dist` (Mozilla PDF.js v3+) - PDF 解析
- `@google/generative-ai` - Gemini AI 元数据提取
- TypeScript/Node.js - 后端 API
- React - 前端编辑器
- Express.js - 路由处理

---

## Phase 1: 安装依赖与基础配置

### Task 1: 安装 pdfjs-dist 依赖

**Files:**
- Modify: `backend/package.json`

**Step 1: 添加依赖到 package.json**

```bash
cd backend
npm install pdfjs-dist@3.11.174
```

**Step 2: 验证安装**

```bash
cat package.json | grep pdfjs
```

Expected: `"pdfjs-dist": "^3.11.174"`

**Step 3: Commit**

```bash
cd /d/devops/HL-os
git add backend/package.json backend/package-lock.json
git commit -m "deps: add pdfjs-dist for PDF page extraction"
```

---

### Task 2: 创建 PDF 解析服务 (pdfjs 版本)

**Files:**
- Create: `backend/src/services/pdfjsParser.ts`

**Step 1: 创建 pdfjsParser.ts 文件**

```typescript
import * as pdfjsLib from 'pdfjs-dist';

// 配置 worker (pdfjs-dist v3+ 需要手动配置 worker)
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

export interface PageExtractionResult {
  text: string;
  pageNumber: number;
}

export interface CoverImageResult {
  base64: string;
  format: 'png' | 'jpeg';
}

/**
 * 提取 PDF 前 N 页的文本内容
 * @param buffer PDF 文件 Buffer
 * @param pageCount 提取页数（默认 4 页）
 * @returns 前 N 页的文本内容数组
 */
export async function extractFirstPages(
  buffer: Buffer,
  pageCount: number = 4
): Promise<PageExtractionResult[]> {
  try {
    // 加载 PDF 文档
    const loadingTask = pdfjsLib.getDocument({ data: buffer });
    const pdfDocument = await loadingTask.promise;

    const totalPages = pdfDocument.numPages;
    const pagesToExtract = Math.min(pageCount, totalPages);

    console.log(`PDF 总页数: ${totalPages}, 提取前 ${pagesToExtract} 页`);

    const results: PageExtractionResult[] = [];

    // 逐页提取文本
    for (let i = 1; i <= pagesToExtract; i++) {
      const page = await pdfDocument.getPage(i);
      const textContent = await page.getTextContent();

      // 提取并拼接文本项
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ')
        .trim();

      results.push({
        text: pageText,
        pageNumber: i,
      });

      console.log(`第 ${i} 页提取完成，文本长度: ${pageText.length}`);
    }

    return results;
  } catch (error) {
    console.error('PDF 页面提取失败:', error);
    const message = error instanceof Error ? error.message : '未知错误';
    throw new Error(`PDF 页面提取失败: ${message}`);
  }
}

/**
 * 提取 PDF 第 1 页作为封面图片
 * @param buffer PDF 文件 Buffer
 * @returns 封面图片的 base64 编码
 */
export async function extractCoverImage(buffer: Buffer): Promise<CoverImageResult | null> {
  try {
    const loadingTask = pdfjsLib.getDocument({ data: buffer });
    const pdfDocument = await loadingTask.promise;

    const page = await pdfDocument.getPage(1);

    // 设置缩放比例（2.0 以获得清晰图片）
    const viewport = page.getViewport({ scale: 2.0 });

    // 创建 canvas
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('无法创建 canvas context');
    }

    canvas.height = viewport.height;
    canvas.width = viewport.width;

    // 渲染 PDF 页面到 canvas
    await page.render({
      canvasContext: context,
      viewport: viewport,
    }).promise;

    // 转换为 base64 PNG
    const base64 = canvas.toDataURL('image/png').split(',')[1];

    console.log(`封面图片提取成功，尺寸: ${canvas.width}x${canvas.height}`);

    return {
      base64,
      format: 'png',
    };
  } catch (error) {
    console.error('封面图片提取失败:', error);
    // 封面提取失败不阻断流程，返回 null
    return null;
  }
}

/**
 * 获取 PDF 总页数
 * @param buffer PDF 文件 Buffer
 * @returns 总页数
 */
export async function getPDFPageCount(buffer: Buffer): Promise<number> {
  try {
    const loadingTask = pdfjsLib.getDocument({ data: buffer });
    const pdfDocument = await loadingTask.promise;
    return pdfDocument.numPages;
  } catch (error) {
    console.error('PDF 页数获取失败:', error);
    throw new Error('PDF 页数获取失败');
  }
}
```

**Step 2: TypeScript 类型检查**

```bash
cd backend
npx tsc --noEmit
```

Expected: 无类型错误（可能有 canvas 相关警告，可接受）

**Step 3: Commit**

```bash
git add backend/src/services/pdfjsParser.ts
git commit -m "feat: create pdfjs parser service for first pages extraction"
```

---

## Phase 2: AI 元数据提取服务

### Task 3: 设计 Gemini AI 提示词并创建提取服务

**Files:**
- Create: `backend/src/services/bookMetadataAIAnalyzer.ts`

**Step 1: 创建 bookMetadataAIAnalyzer.ts**

```typescript
import { generateAIResponse } from './geminiService.js';

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
    console.log('开始 AI 元数据提取，输入文本页数:', firstPagesText.length);

    // 合并前 4 页文本
    const combinedText = firstPagesText.join('\n\n--- 页面分隔 ---\n\n');

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
    const response = await generateAIResponse(prompt, {
      responseSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          author: { type: 'string' },
          subject: {
            type: 'string',
            enum: ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治', '其他']
          },
          grade: { type: 'string' },
          category: {
            type: 'string',
            enum: ['教科书', '培训资料', '工具书', '课外读物']
          },
          publisher: { type: 'string' },
          publishDate: { type: 'string' },
          confidence: { type: 'number' }
        },
        required: ['title', 'author', 'subject', 'grade', 'category', 'publisher', 'publishDate', 'confidence']
      }
    });

    console.log('AI 元数据提取成功:', response);

    return response as BookMetadataAI;
  } catch (error) {
    console.error('AI 元数据提取失败:', error);

    // 降级处理：返回基于文件名的默认值
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
```

**Step 2: 更新 geminiService.ts 以支持自定义 schema**

如果 `geminiService.ts` 没有 `responseSchema` 参数支持，需要添加：

```typescript
// 在 generateAIResponse 函数签名中添加
interface GenerateAIOptions {
  responseSchema?: any; // Gemini structured output schema
}

export async function generateAIResponse(
  prompt: string,
  options?: GenerateAIOptions
): Promise<any> {
  // ... 现有代码

  // 在 generationConfig 中添加
  const generationConfig = {
    // ... 现有配置
    responseSchema: options?.responseSchema,
    responseMimeType: options?.responseSchema ? 'application/json' : undefined,
  };

  // ...
}
```

**Step 3: Commit**

```bash
git add backend/src/services/bookMetadataAIAnalyzer.ts backend/src/services/geminiService.ts
git commit -m "feat: add AI-based book metadata extraction from first 4 pages"
```

---

## Phase 3: 后端 API 集成

### Task 4: 重构 /api/upload-book/parse 端点

**Files:**
- Modify: `backend/src/routes/upload-book.ts`

**Step 1: 替换 pdf-parse 调用为 pdfjs-dist**

```typescript
import { extractFirstPages, extractCoverImage, getPDFPageCount } from '../services/pdfjsParser.js';
import { extractBookMetadataFromPages } from '../services/bookMetadataAIAnalyzer.js';

// 在 POST /api/upload-book/parse 中替换 switch case

try {
  switch (fileFormat) {
    case 'pdf':
      console.log('提取 PDF 前 4 页文本...');

      // 1. 提取前 4 页文本
      const firstPages = await extractFirstPages(fileBuffer, 4);
      const pageTexts = firstPages.map(p => p.text);

      // 2. 调用 AI 提取元数据
      console.log('调用 AI 提取元数据...');
      const aiMetadata = await extractBookMetadataFromPages(pageTexts, fileName);

      // 3. 提取封面图片
      console.log('提取封面图片...');
      const coverImage = await extractCoverImage(fileBuffer);

      // 4. 获取总页数
      pageCount = await getPDFPageCount(fileBuffer);

      console.log(`PDF 处理成功，页数: ${pageCount}`);
      console.log(`AI 提取的元数据:`, JSON.stringify(aiMetadata));

      basicMetadata = {
        title: aiMetadata.title,
        author: aiMetadata.author,
        subject: aiMetadata.subject,
        grade: aiMetadata.grade,
        category: aiMetadata.category,
        publisher: aiMetadata.publisher,
        publishDate: aiMetadata.publishDate,
        coverImage: coverImage?.base64 || null,
        coverFormat: coverImage?.format || 'png',
        aiConfidence: aiMetadata.confidence,
      };
      break;

    case 'epub':
      // EPUB 保持原有逻辑（暂不处理）
      console.log('解析 EPUB...');
      const epubData = await parseEPUB(fileBuffer);
      basicMetadata = {
        title: epubData.estimatedMetadata.title || fileName.replace(/\.epub$/i, ''),
        author: epubData.estimatedMetadata.author || '',
        subject: '其他',
        grade: '',
        category: '教科书',
        publisher: '',
        publishDate: '',
      };
      pageCount = epubData.pageCount;
      break;

    case 'txt':
      basicMetadata = {
        title: fileName.replace(/\.txt$/i, ''),
        author: '',
        subject: '其他',
        grade: '',
        category: '课外读物',
        publisher: '',
        publishDate: '',
      };
      pageCount = 1;
      break;

    default:
      return res.status(400).json({
        success: false,
        error: `不支持的文件格式: ${fileFormat}`
      });
  }

  console.log('返回的元数据:', finalMetadata);

  // 返回元数据（不调用 AI）
  return res.json({
    success: true,
    data: {
      fileName: fileName,
      fileFormat,
      fileSize: fileBuffer.length,
      pageCount: pageCount,
      metadata: finalMetadata,
    },
  });
} catch (parseError) {
  console.error('文件解析失败:', parseError);

  // 解析失败时使用文件名作为默认值
  const fallbackMetadata = {
    title: fileName.replace(/\.(pdf|epub|txt)$/i, ''),
    author: '',
    subject: '其他',
    grade: '',
    category: '教科书',
    publisher: '',
    publishDate: '',
    tags: []
  };

  console.log('使用默认元数据:', fallbackMetadata);

  return res.json({
    success: true,
    data: {
      fileName: fileName,
      fileFormat,
      fileSize: fileBuffer.length,
      pageCount: 0,
      metadata: fallbackMetadata,
    },
  });
}
```

**Step 2: TypeScript 类型检查**

```bash
cd backend
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add backend/src/routes/upload-book.ts
git commit -m "feat: integrate AI metadata extraction in upload-book/parse endpoint"
```

---

### Task 5: 实现文件存储策略

**Files:**
- Modify: `backend/src/routes/upload-chunk.ts`

**Step 1: 修改文件合并逻辑，按 ownerId 归档**

```typescript
// 在 handleMerge 函数中修改最终文件路径生成

async function handleMerge(req: Request, res: Response): Promise<void> {
  let mergeCompleted = false;
  let finalPath = '';

  try {
    await ensureDirs();

    const { fileId, fileName, ownerId } = req.body;

    if (!fileId || !fileName || !ownerId) {
      res.status(400).json({ success: false, error: '缺少必要参数' });
      return;
    }

    // 验证并净化 fileId
    if (!/^[a-zA-Z0-9\-._]+$/.test(fileId)) {
      res.status(400).json({ success: false, error: 'fileId 格式无效' });
      return;
    }

    // 净化 fileName
    const safeFileName = path.basename(fileName);

    const chunkDir = path.join(TEMP_DIR, fileId);

    // 检查分片目录是否存在
    try {
      await fs.access(chunkDir);
    } catch {
      res.status(404).json({ success: false, error: '分片文件不存在' });
      return;
    }

    // 读取所有分片
    const chunks = await fs.readdir(chunkDir);
    chunks.sort((a, b) => {
      const indexA = parseInt(a.split('-')[1]);
      const indexB = parseInt(b.split('-')[1]);
      return indexA - indexB;
    });

    // 创建按 ownerId 归档的目录结构
    const BOOKS_DIR = path.join(process.cwd(), 'data', 'originals', 'books', ownerId);
    await fs.mkdir(BOOKS_DIR, { recursive: true });

    // 生成最终文件路径
    const ext = path.extname(safeFileName);
    const finalFileName = `${fileId}${ext}`;
    finalPath = path.join(BOOKS_DIR, finalFileName);

    // 合并分片（流式写入）
    const fileHandles = await Promise.all(
      chunks.map(chunk => fs.open(path.join(chunkDir, chunk), 'r'))
    );

    const writeHandle = await fs.open(finalPath, 'w');

    for (const handle of fileHandles) {
      const { buffer } = await handle.read();
      await writeHandle.write(buffer);
      await handle.close();
    }

    await writeHandle.close();

    mergeCompleted = true;

    // 清理临时分片
    await fs.rm(chunkDir, { recursive: true });

    // 返回相对路径（包含 ownerId）
    const relativePath = `/data/originals/books/${ownerId}/${finalFileName}`;

    console.log(`文件合并成功: ${safeFileName} -> ${relativePath}`);

    res.json({ success: true, filePath: relativePath });
  } catch (error: any) {
    console.error('合并分片失败:', error);

    // 清理部分合并的文件
    if (!mergeCompleted && finalPath) {
      try {
        await fs.unlink(finalPath);
      } catch (e) {
        // 忽略删除失败
      }
    }

    res.status(500).json({ success: false, error: error.message });
  }
}
```

**Step 2: 确保 data 目录在 .gitignore 中**

```bash
echo "data/" >> .gitignore
```

**Step 3: Commit**

```bash
git add backend/src/routes/upload-chunk.ts .gitignore
git commit -m "feat: implement file storage strategy with ownerId-based archiving"
```

---

## Phase 4: 前端编辑器扩展

### Task 6: 扩展 BookEditor 组件字段

**Files:**
- Modify: `components/BookEditor.tsx`

**Step 1: 更新 BookEditor 组件**

```typescript
interface BookMetadata {
  title: string;
  author: string;
  subject: string;
  grade: string;
  category: string;
  publisher: string;
  publishDate: string;
  tags: string[];
  coverImage?: string | null;
}

const SUBJECT_OPTIONS = [
  '语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治', '其他'
];

const GRADE_OPTIONS = [
  '一年级上', '一年级下', '二年级上', '二年级下',
  '三年级上', '三年级下', '四年级上', '四年级下',
  '五年级上', '五年级下', '六年级上', '六年级下',
  '七年级上', '七年级下', '八年级上', '八年级下', '九年级上', '九年级下',
  '高一上', '高一下', '高二上', '高二下', '高三上', '高三下',
  ''
];

const CATEGORY_OPTIONS = [
  { value: '教科书', label: '教科书' },
  { value: '培训资料', label: '培训资料' },
  { value: '工具书', label: '工具书' },
  { value: '课外读物', label: '课外读物' }
];

export const BookEditor: React.FC<BookEditorProps> = ({ metadata, onSave, onCancel }) => {
  const [formData, setFormData] = useState<BookMetadata>({
    title: metadata.title || '',
    author: metadata.author || '',
    subject: metadata.subject || '其他',
    grade: metadata.grade || '',
    category: metadata.category || '教科书',
    publisher: metadata.publisher || '',
    publishDate: metadata.publishDate || '',
    tags: metadata.tags || [],
    coverImage: metadata.coverImage || null,
  });

  const [tagInput, setTagInput] = useState('');
  const { currentUser } = useApp();

  // 初始化时添加用户名作为默认标签
  useEffect(() => {
    if (formData.tags.length === 0 && currentUser?.name) {
      setFormData(prev => ({
        ...prev,
        tags: [currentUser.name]
      }));
    }
  }, [currentUser?.name]);

  const handleSave = () => {
    onSave(formData);
  };

  const addTag = () => {
    if (tagInput.trim() && !formData.tags.includes(tagInput.trim())) {
      setFormData(prev => ({
        ...prev,
        tags: [...prev.tags, tagInput.trim()]
      }));
      setTagInput('');
    }
  };

  const removeTag = (tagToRemove: string) => {
    setFormData(prev => ({
      ...prev,
      tags: prev.tags.filter(tag => tag !== tagToRemove)
    }));
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <h3 className="text-xl font-bold text-gray-800 mb-4">编辑图书信息</h3>

          {/* 封面预览 */}
          {formData.coverImage && (
            <div className="mb-4 p-4 bg-gray-50 rounded-lg">
              <img
                src={`data:image/png;base64,${formData.coverImage}`}
                alt="封面预览"
                className="max-w-xs mx-auto rounded shadow"
              />
            </div>
          )}

          <div className="space-y-4">
            {/* 书名 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">书名 *</label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="请输入书名"
              />
            </div>

            {/* 作者 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">作者</label>
              <input
                type="text"
                value={formData.author}
                onChange={(e) => setFormData({ ...formData, author: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="请输入作者"
              />
            </div>

            {/* 学科 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">学科</label>
              <select
                value={formData.subject}
                onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {SUBJECT_OPTIONS.map(subject => (
                  <option key={subject} value={subject}>{subject}</option>
                ))}
              </select>
            </div>

            {/* 年级 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">年级</label>
              <select
                value={formData.grade}
                onChange={(e) => setFormData({ ...formData, grade: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {GRADE_OPTIONS.map(grade => (
                  <option key={grade} value={grade}>{grade || '未指定'}</option>
                ))}
              </select>
            </div>

            {/* 类型 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">类型</label>
              <select
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {CATEGORY_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {/* 出版社 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">出版社</label>
              <input
                type="text"
                value={formData.publisher}
                onChange={(e) => setFormData({ ...formData, publisher: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="请输入出版社"
              />
            </div>

            {/* 出版时间 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">出版时间</label>
              <input
                type="month"
                value={formData.publishDate}
                onChange={(e) => setFormData({ ...formData, publishDate: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* 标签 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">标签</label>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && addTag()}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="输入标签后按回车"
                />
                <button
                  onClick={addTag}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  添加
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {formData.tags.map(tag => (
                  <span
                    key={tag}
                    className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm flex items-center gap-1"
                  >
                    {tag}
                    <button
                      onClick={() => removeTag(tag)}
                      className="text-gray-500 hover:text-gray-700"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>

            {/* 操作按钮 */}
            <div className="flex justify-end gap-3 pt-4">
              <button
                onClick={onCancel}
                className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={!formData.title}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
```

**Step 2: 更新 types.ts 以包含新的元数据字段**

```typescript
// 在 types.ts 中添加或修改
export interface BookMetadata {
  title: string;
  author: string;
  subject: string;
  grade: string;
  category: string;
  publisher: string;
  publishDate: string;
  tags: string[];
  coverImage?: string | null;
}
```

**Step 3: Commit**

```bash
git add components/BookEditor.tsx types.ts
git commit -m "feat: extend BookEditor with full metadata fields"
```

---

### Task 7: 更新 BookUploader 组件

**Files:**
- Modify: `components/BookUploader.tsx`

**Step 1: 修改成功提示文案**

将第 143 行的提示改为：

```typescript
<span className="text-sm text-green-800">上传成功！AI 正在分析图书信息...</span>
```

**Step 2: 更新默认元数据字段**

修改第 107-114 行的默认元数据：

```typescript
const defaultMetadata = {
  title: file.name.replace(/\.(pdf|epub|txt)$/i, ''),
  author: '',
  subject: '其他',
  grade: '',
  category: '教科书',
  publisher: '',
  publishDate: '',
  tags: [],
  coverImage: null
};
```

**Step 3: Commit**

```bash
git add components/BookUploader.tsx
git commit -m "fix: update BookUploader success message and default metadata"
```

---

## Phase 5: 构建与部署

### Task 8: 后端构建测试

**Step 1: 清理并重新构建**

```bash
cd backend
rm -rf dist
npm run build
```

Expected: 无编译错误

**Step 2: 检查构建输出**

```bash
ls -la dist/services/ | grep -E "(pdfjs|bookMetadataAI)"
```

Expected: 看到 `pdfjsParser.js` 和 `bookMetadataAIAnalyzer.js`

**Step 3: Commit (如果需要调整配置文件)**

```bash
# 如果有必要的配置文件修改
git add backend/tsconfig.json
git commit -m "build: adjust TypeScript config for pdfjs-dist"
```

---

### Task 9: 前端构建测试

**Step 1: 前端类型检查**

```bash
cd /d/devops/HL-os
npx tsc --noEmit
```

Expected: 无类型错误

**Step 2: 前端构建**

```bash
npm run build
```

Expected: 成功生成 `dist/` 目录

**Step 3: Commit (如果需要)**

```bash
git add tsconfig.json vite.config.ts
git commit -m "build: adjust frontend build config"
```

---

## Phase 6: 测试验证

### Task 10: 本地功能测试

**Step 1: 启动后端服务**

```bash
cd backend
npm run dev
```

**Step 2: 启动前端服务**

```bash
cd /d/devops/HL-os
npm run dev
```

**Step 3: 测试上传流程**

1. 打开浏览器访问 `http://localhost:5173`
2. 登录或选择用户
3. 进入"图书馆"标签页
4. 点击"上传图书"
5. 选择一个包含完整元数据的 PDF 文件（如英语教材）
6. 观察控制台日志：
   - 应该看到 "提取 PDF 前 4 页文本..."
   - 应该看到 "调用 AI 提取元数据..."
   - 应该看到 "封面图片提取成功..."
7. 等待编辑器弹出
8. 检查编辑器字段是否被 AI 提取的值填充
9. 修改部分字段后点击"保存"

**Expected Results:**
- 后端日志显示前 4 页文本提取成功
- AI 返回的元数据格式正确
- 封面图片正确显示在编辑器中
- 所有下拉字段包含正确的选项
- 保存后图书出现在图书馆列表中

**Step 4: 验证文件存储**

```bash
ls -la /opt/hl-os/data/originals/books/{ownerId}/
```

Expected: 看到上传的 PDF 文件

**Step 5: 测试降级场景**

1. 上传一个没有元数据的空白 PDF
2. 验证是否使用文件名作为默认书名
3. 验证编辑器是否正常显示（可手动填写）

**Step 6: Commit 测试结果文档**

创建测试报告���

```bash
cat > docs/test-reports/ai-metadata-extraction.md << 'EOF'
# AI 元数据提取功能测试报告

**测试日期:** 2026-01-22

**测试用例:** [列出实际测试用例]

**测试结果:** [通过/失败]

**发现的问题:** [记录任何问题]

**截图:** [粘贴截图]
EOF
git add docs/test-reports/ai-metadata-extraction.md
git commit -m "test: add AI metadata extraction test report"
```

---

## Phase 7: 部署上线

### Task 11: 推送代码到远程仓库

**Step 1: 推送所有提交**

```bash
cd /d/devops/HL-os
git push origin master
```

**Step 2: 拉取到生产服务器**

```bash
ssh your-server
cd /opt/hl-os
git pull origin master
```

**Step 3: 部署（运行部署脚本）**

```bash
sudo ./deploy.sh
```

**Step 4: 验证服务启动**

```bash
journalctl -u hlos-backend -f
```

**Step 5: 测试生产环境**

重复 Task 10 的测试步骤

---

## Phase 8: 文档更新

### Task 12: 更新项目文档

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/USER_GUIDE.md`

**Step 1: 更新架构文档**

在 `docs/ARCHITECTURE.md` 中添加：

```markdown
## 图书元数据提取流程

### 技术实现

1. **PDF 解析**: 使用 `pdfjs-dist` 提取前 4 页文本和封面图片
2. **AI 分析**: 使用 Gemini 2.0 Flash 从文本中提取结构化元数据
3. **字段映射**: AI 返回的 JSON 映射到数据库字段
4. **降级处理**: AI 失败时使用文件名作为默认书名

### 存储策略

- 原始文件: `/opt/hl-os/data/originals/books/{ownerId}/{uuid}.pdf`
- 封面图片: Base64 存储在元数据中
- 元数据索引: 未来将同步到 AnythingLLM
```

**Step 2: 更新用户指南**

在 `docs/USER_GUIDE.md` 中添加：

```markdown
## 上传图书

### 功能说明

上传图书后，系统会自动：
1. 提取 PDF 前 4 页内容
2. 使用 AI 识别书名、作者、学科、年级等信息
3. 提取封面图片
4. 显示编辑器供您确认或修改

### 支持的字段

- **书名**: 必填
- **作者**: 选填
- **学科**: 下拉选择（语文/数学/英语/物理/化学/生物/历史/地理/政治/其他）
- **年级**: 下拉选择（一年级上~高三下）
- **类型**: 下拉选择（教科书/培训资料/工具书/课外读物）
- **出版社**: 选填
- **出版时间**: 选填（年-月格式）
- **标签**: 自定义，默认添加用户名
```

**Step 3: Commit 文档更新**

```bash
git add docs/ARCHITECTURE.md docs/USER_GUIDE.md
git commit -m "docs: update architecture and user guide for AI metadata extraction"
```

---

## Summary

此实现计划包含 **12 个主要任务**，分为 8 个阶段：

1. ✅ 安装 pdfjs-dist 依赖
2. ✅ 创建 PDF 解析服务（提取前 4 页 + 封面）
3. ✅ 设计 Gemini AI 提示词并创建提取服务
4. ✅ 重构后端 API 集成 AI 提取
5. ✅ 实现文件存储策略（按 ownerId 归档）
6. ✅ 扩展前端编辑器字段
7. ✅ 更新 BookUploader 组件
8. ✅ 后端构建测试
9. ✅ 前端构建测试
10. ✅ 本地功能测试
11. ✅ 部署上线
12. ✅ 文档更新

**预计完成时间:** 2-3 小时（假设每个任务 10-15 分钟）

**关键依赖:**
- Gemini API key 已配置
- Node.js 18+ 环境
- /opt/hl-os/data/ 目录可写权限

**回滚方案:**
如果生产环境出现问题，可以回退到 commit `74216b1`（修复前的版本）：
```bash
git revert <commit-range>
git push origin master
sudo ./deploy.sh
```
