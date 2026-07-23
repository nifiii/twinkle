import express, { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { extractPDFMetadata, parsePDF } from '../services/pdfParser.js';
import { parseEPUB } from '../services/epubParser.js';
import { analyzeBookMetadata } from '../services/bookMetadataAnalyzer.js';
import { extractMetadataFromFileName } from '../services/geminiMetadataExtractor.js';
import { analyzeMetadata, convertToMarkdown } from '../services/llmService.js';
import { extractPagesAsImages } from '../services/imageService.js';
import { extractMetadataFromPDFWithDoubao } from '../services/doubaoService.js';
import { getBookJobResult, submitBookJob } from '../services/bookJobs.js';
import { jobStore } from '../services/jobRuntime.js';

const router = express.Router();

// 临时存放目录
const TEMP_DIR = path.join(process.cwd(), 'uploads', 'temp');

// 确保目录存在
const ensureDir = async () => {
  await fs.mkdir(TEMP_DIR, { recursive: true });
  await fs.mkdir(path.join(process.cwd(), 'uploads', 'covers'), { recursive: true });
  console.log('[upload-book] 临时上传目录已就绪:', TEMP_DIR);
};

// 立即调用，但不在此处等待（由路由中间件或启动脚本确保更好，
// 但在 express 中我们可以在首个请求前或通过一个自执行函数确保完成）
const dirPromise = ensureDir();

// 配置 multer 用于大文件流式上传 (直接写磁盘，零内存压力)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, TEMP_DIR);
  },
  filename: (req, file, cb) => {
    const baseId = `${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    cb(null, `${baseId}_${file.originalname}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 1024 * 1024 * 1024, // 1GB 限制
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      'application/pdf',
      'application/epub+zip',
      'text/plain',
    ];

    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('不支持的文件格式，仅支持 PDF、EPUB、TXT'));
    }
  },
});

/**
 * POST /api/upload-book
 * 极简上传接口：仅负责将文件存入磁盘，不执行解析。
 * 解决 100MB+ 文件在同一请求中解析导致的 408 Timeout 根因。
 */
router.post('/upload-book', async (req, res, next) => {
  await dirPromise; // 确保目录已建立
  next();
}, upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: '未上传文件',
      });
    }

    const file = req.file;
    const ownerId = typeof req.body.ownerId === 'string' && req.body.ownerId ? req.body.ownerId : 'shared';
    const fileFormat = getFileFormat(file.mimetype);
    const relativeTempPath = `/uploads/temp/${file.filename}`;
    const submission = await submitBookJob({
      sourcePath: path.join(TEMP_DIR, file.filename), fileName: file.originalname, ownerId,
      fileHash: typeof req.body.fileHash === 'string' ? req.body.fileHash : undefined,
    });
    if (!submission.accepted) {
      await fs.unlink(path.join(TEMP_DIR, file.filename)).catch(() => undefined);
      return res.status(429).json({ success: false, error: '当前任务队列已满，请稍后重试' });
    }

    console.log(`[upload-book] 文件上传并入队: ${file.originalname} -> ${submission.job!.id}`);

    return res.status(202).json({
      success: true,
      data: {
        fileName: file.originalname,
        fileFormat,
        fileSize: file.size,
        tempFilePath: relativeTempPath,
        taskId: submission.job!.id,
      },
    });
  } catch (error) {
    console.error('上传失败:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '文件上传失败',
    });
  }
});

router.get('/upload-book/task/:id', async (req: Request, res: Response) => {
  const ownerId = typeof req.query.ownerId === 'string' && req.query.ownerId ? req.query.ownerId : 'shared';
  const job = jobStore.getForOwner(req.params.id, ownerId);
  if (!job || job.type !== 'book') return res.status(404).json({ success: false, error: '图书任务不存在' });
  try {
    return res.json({
      success: true,
      data: {
        id: job.id, status: job.status, stage: job.stage, queuePosition: jobStore.getQueuePosition(job.id),
        error: job.status === 'failed' ? '图书解析失败，请重试' : undefined,
        result: await getBookJobResult(job),
      },
    });
  } catch {
    return res.status(500).json({ success: false, error: '图书任务结果读取失败' });
  }
});

/**
 * POST /api/upload-book/parse
 * 解析已上传的图书文件（通过文件路径，只提取元数据，不调用 AI）
 */
router.post('/upload-book/parse', async (req: Request, res: Response) => {
  try {
    console.log('========================================');
    console.log('收到 /api/upload-book/parse 请求');
    console.log('请求体:', req.body);

    const { filePath, fileName } = req.body;

    if (!filePath || !fileName) {
      console.error('❌ 缺少必要参数');
      return res.status(400).json({
        success: false,
        error: '缺少必要参数',
      });
    }

    console.log('✓ 参数验证通过');
    console.log('文件路径:', filePath);
    console.log('文件名:', fileName);

    // 安全检查：确保 filePath 在 data/originals/books 目录内
    const safePath = path.normalize(filePath);
    const fullPath = path.join(process.cwd(), safePath);

    console.log('规范化路径:', safePath);
    console.log('完整路径:', fullPath);

    const allowedPaths = [
      path.join(process.cwd(), 'uploads'),
      path.join(process.cwd(), 'data', 'originals', 'books')
    ];

    const isAllowed = allowedPaths.some(allowedPath => fullPath.startsWith(allowedPath));

    if (!isAllowed) {
      console.error('❌ 非法的文件路径');
      console.error('允许的路径前缀:', allowedPaths);
      return res.status(400).json({
        success: false,
        error: '非法的文件路径',
      });
    }

    console.log('✓ 路径安全检查通过');
    console.log('开始提取元数据:', fileName);

    // 读取文件
    const fileBuffer = await fs.readFile(fullPath);
    const fileFormat = getFileFormatFromFileName(fileName);

    console.log(`文件格式: ${fileFormat}`);

    let basicMetadata;
    let pageCount = 0;

    try {
      switch (fileFormat) {
        case 'pdf':
          console.log('========================================');
          console.log('开始处理 PDF 文件');
          console.log('文件路径:', fullPath);
          console.log('========================================');

          // 使用统一 LLM 服务提取元数据
          console.log('调用 LLM 提取元数据...');

          let aiMetadata;
          let coverImage = null;

          // 并行执行：元数据提取 + 封面生成
          try {
            // 解析 PDF 内容获取页数和尝试纯文本
            const pdfParseResult = await parsePDF(fileBuffer);
            pageCount = pdfParseResult.meta?.info?.Pages || pdfParseResult.meta?.metadata?._data?.Pages || 1;

            // 启发式判断：如果平均每页字数极少，说明可能是扫描版 PDF
            // pdf-parse 在纯图像上往往只返回寥寥几个控制字符
            const avgCharsPerPage = pdfParseResult.content.length / pageCount;
            const isScannedPDF = pdfParseResult.content.length < 500 || avgCharsPerPage < 50;

            let metadataResult;
            let coverImageName;

            if (isScannedPDF) {
              console.log(`[扫描PDF检测] 每页平均字数 ${avgCharsPerPage.toFixed(2)}，使用 Doubao Vision 多模态分析封面提取元数据`);
              [metadataResult, coverImageName] = await Promise.all([
                // 走 Vision (内部会调 imageService 取封面，然后发给大模型)
                extractMetadataFromPDFWithDoubao(fullPath, fileName),
                extractPagesAsImages(fullPath, path.join(process.cwd(), 'uploads', 'covers'), 1).then(imgs => imgs[0])
              ]);
              // 扫描版：写入极短的 txt（内容几乎为空），saveBook 阶段会检测到并走 OCR 路径
              const tempTxtPath = fullPath.replace(path.extname(fullPath), '.txt');
              await fs.writeFile(tempTxtPath, pdfParseResult.content).catch(() => {});
            } else {
              console.log(`[非扫描PDF] 每页平均字数 ${avgCharsPerPage.toFixed(2)}，使用文本路径提取元数据`);
              [metadataResult, coverImageName] = await Promise.all([
                analyzeMetadata(pdfParseResult.content, fileName),
                extractPagesAsImages(fullPath, path.join(process.cwd(), 'uploads', 'covers'), 1).then(imgs => imgs[0])
              ]);
              // 非扫描版：无论 fullPath 是否在 uploads 目录，都必须写入 .txt 供后台 Markdown 转换使用
              // 注意：fullPath 通常指向已存档路径（data/originals/...），不含 uploads，原逻辑 if (fullPath.includes('uploads')) 导致 .txt 永远不写
              const tempTxtPath = fullPath.replace(path.extname(fullPath), '.txt');
              await fs.writeFile(tempTxtPath, pdfParseResult.content).catch((e) => {
                console.warn(`[upload-book/parse] 写入 .txt 失败 (非致命): ${tempTxtPath}`, e.message);
              });
            }

            aiMetadata = metadataResult;
            coverImage = coverImageName ? `/uploads/covers/${coverImageName}` : null;
          } catch (aiError) {
            console.error('AI 处理失败:', aiError);
            // 降级处理：仅使用基本信息
            aiMetadata = {
              title: fileName.replace('.pdf', ''),
              subject: '其他',
              grade: '',
              category: '教科书',
              tags: [],
              tableOfContents: []
            };
          }

          // 之前已经尝试获取过 pageCount 了，这里不再覆盖为 0
          // pageCount = await extractPDFMetadata(fileBuffer).then(r => r.pageCount).catch(() => 0);
          console.log('========================================');
          console.log('✓ PDF 处理成功');
          console.log('总页数:', pageCount || '未知');
          console.log('AI 提取的元数据:', JSON.stringify(aiMetadata));
          console.log('封面图片:', coverImage);
          console.log('========================================');

          basicMetadata = {
            title: aiMetadata.title || fileName.replace('.pdf', ''),
            author: aiMetadata.author,
            subject: aiMetadata.subject,
            grade: aiMetadata.grade,
            category: aiMetadata.category,
            publisher: aiMetadata.publisher,
            publishDate: aiMetadata.publishDate,
            coverImage: coverImage,
            coverFormat: 'png',
            aiConfidence: 0.9, // 豆包通常比较准，给个默认高置信度
            fieldConfidence: {}, // 豆包暂不返回字段级置信度
            tags: aiMetadata.tags || [],
            tableOfContents: aiMetadata.tableOfContents || []
          };
          break;

        case 'epub':
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
            coverImage: null,
            aiConfidence: 0.5,
          };
          pageCount = epubData.pageCount;
          console.log(`EPUB 解析成功，页数: ${pageCount}`);
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
            coverImage: null,
            aiConfidence: 0.5,
          };
          pageCount = 1;
          break;

        default:
          return res.status(400).json({
            success: false,
            error: `不支持的文件格式: ${fileFormat}`
          });
      }

      // 构建最终元数据
      const finalMetadata = {
        title: basicMetadata.title || fileName.replace(/\.(pdf|epub|txt)$/i, ''),
        author: basicMetadata.author || '',
        subject: basicMetadata.subject || '其他',
        grade: basicMetadata.grade || '',
        category: basicMetadata.category || '教科书',
        publisher: basicMetadata.publisher || '',
        publishDate: basicMetadata.publishDate || '',
        coverImage: basicMetadata.coverImage,
        tags: basicMetadata.tags || [],             // 保留 AI 提取的标签
        tableOfContents: basicMetadata.tableOfContents || []  // 高优先级：保留 AI 提取的目录结构
      };

      console.log('返回的元数据:', finalMetadata);

      // 返回元数据（包含置信度）
      return res.json({
        success: true,
        data: {
          fileName: fileName,
          tempFilePath: filePath, 
          fileFormat,
          fileSize: fileBuffer.length,
          pageCount: pageCount,
          metadata: finalMetadata,
          confidence: {
            overall: basicMetadata.aiConfidence || 0,
            fields: basicMetadata.fieldConfidence || {}
          },
          extractionMethod: 'gemini'
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
  } catch (error) {
    console.error('请求处理失败:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '请求处理失败',
    });
  }
});

/**
 * 根据 MIME 类型获取文件格式
 */
function getFileFormat(mimeType: string): 'pdf' | 'epub' | 'txt' {
  if (mimeType === 'application/pdf') {
    return 'pdf';
  } else if (mimeType === 'application/epub+zip') {
    return 'epub';
  } else if (mimeType === 'text/plain') {
    return 'txt';
  }
  throw new Error(`未知的 MIME 类型: ${mimeType}`);
}

/**
 * 根据文件名获取文件格式
 */
function getFileFormatFromFileName(fileName: string): 'pdf' | 'epub' | 'txt' {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (ext === '.epub') return 'epub';
  if (ext === '.txt') return 'txt';
  return 'pdf'; // 默认
}

export default router;
