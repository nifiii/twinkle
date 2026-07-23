import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import analyzeRouter, { initAnalyzeTasks } from './routes/analyze.js';
import coursewareRouter from './routes/courseware.js';
import assessmentRouter from './routes/assessment.js';
import saveScannedItemRouter from './routes/saveScannedItem.js';
import scannedItemsRouter from './routes/scannedItems.js';
import saveBookRouter from './routes/saveBook.js';
import booksRouter from './routes/books.js';
import uploadBookRouter from './routes/upload-book.js';
import filesRouter from './routes/files.js';
import classroomRouter from './routes/classroom.js';
import ttsRouter from './routes/tts.js';
import usersRouter from './routes/users.js';
import wrongProblemsRouter from './routes/wrongProblems.js';
import dashboardRouter from './routes/dashboard.js';
import jobsRouter from './routes/jobs.js';
import { cleanupTempChunks } from './utils/cleanup.js';
import { initDatabase } from './services/databaseService.js';

dotenv.config();

// 初始化数据库
initDatabase();

// 拍题异步任务：启动恢复 + 每小时清理 24h 之前的记录
initAnalyzeTasks();

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ extended: true, limit: '200mb' }));

// 请求日志
// Why: 拍题 OCR 单次 ~450s,前端 3s 一次轮询会刷 ~150 行 GET /api/analyze-task/:id,
//      把真正有用的日志(豆包请求/失败/启动)淹没。这里直接跳过此路径。
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/analyze-task/')) {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
    if (req.path.includes('upload')) {
      console.log('  Content-Type:', req.get('content-type'));
      console.log('  Content-Length:', req.get('content-length'));
    }
  }
  next();
});

// 静态文件服务
// 1. 上传的临时文件
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));
// 2. 数据目录 (用于 serving 封面等)
const DATA_DIR = process.env.DATA_DIR || '/opt/twinkle/data';
app.use('/covers', express.static(path.join(DATA_DIR, 'obsidian', 'covers')));
app.use('/data', express.static(DATA_DIR)); // 直接映射整个 data 目录供前端访问
// app.use('/data/images', express.static(path.join(DATA_DIR, 'originals', 'images'))); // 移除冗余配置

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    version: '1.0.0'
  });
});

// 路由
app.use('/api', analyzeRouter);
app.use('/api', coursewareRouter);
app.use('/api', assessmentRouter);
app.use('/api', saveScannedItemRouter);
app.use('/api', scannedItemsRouter);
app.use('/api', saveBookRouter);
app.use('/api', booksRouter);
app.use('/api', uploadBookRouter);
app.use('/api/files', filesRouter);
app.use('/api', classroomRouter);
app.use('/api', ttsRouter);
app.use('/api', usersRouter);
app.use('/api', wrongProblemsRouter);
app.use('/api', dashboardRouter);
app.use('/api', jobsRouter);

// API 404 处理（仅 /api/* 未匹配时返回 JSON）
app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'API endpoint not found'
  });
});

// 生产模式：托管前端静态文件 + SPA fallback
// Why: 单容器架构下 express 直接服务 React build 产物，省去前端独立 nginx
if (process.env.NODE_ENV === 'production') {
  const PUBLIC_DIR = path.join(process.cwd(), 'public');
  app.use(express.static(PUBLIC_DIR));
  // 排除 /api/, /data/, /uploads/, /covers/，避免静态资源缺失时返回 200 index.html 导致前端误判
  app.get(/^(?!\/(api|data|uploads|covers)\/).*/, (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });
}

// 错误处理
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({
    success: false,
    error: err.message || 'Internal Server Error'
  });
});

const server = app.listen(PORT, () => {
  console.log(`✅ Backend server running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/api/health`);

  // 启动时清理一次过期文件
  cleanupTempChunks().catch(console.error);

  // 定期清理（每小时）
  setInterval(() => {
    cleanupTempChunks().catch(console.error);
  }, 60 * 60 * 1000);
});

// 设置服务器超时时间为 30 分钟 (解决特大文件上传解析耗时长的 408 错误)
server.timeout = 1800000;
server.headersTimeout = 1810000;
server.keepAliveTimeout = 60000;
