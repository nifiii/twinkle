# 豆包 AI 优化 — 执行追踪

## Task 1: 前端图片压缩 [P0]
- [x] CaptureModule.tsx 新增 compressImage()
- [x] 单图模式 handleProcess 调用压缩
- [x] 多图模式 loadImagePromises 调用压缩

## Task 2: 精简 OCR Prompt [P1]
- [x] analyze.ts OCR_SYSTEM_INSTRUCTION 精简 ~35 行

## Task 3: 动态轮询 + 阶段进度提示 [P1]
- [x] geminiService.ts getPollingInterval() 动态间隔
- [x] analyzeImage 增加 onProgress 回调
- [x] CaptureModule.tsx 增加 progressText state
- [x] 单图/多图 传入 onProgress 回调

## Task 4: OCR 与逻辑分析拆解 [P1]
- [x] analyze.ts 新增 OCR_ONLY_INSTRUCTION
- [x] analyze.ts 新增 POST /api/analyze-image-ocr 端点
- [x] analyze.ts 新增 GET /api/analyze-task-ocr/:id 端点
- [x] analyze.ts 新增 POST /api/analyze-markdown 端点
- [x] geminiService.ts 新增 analyzeImageOcr()
- [x] geminiService.ts 新增 analyzeMarkdown()
- [x] CaptureModule.tsx 两阶段 UI 改造

## Task 5: Lite 模型降级 [P2]
- [x] .env.example 新增 ARK_LITE_MODEL_ID
- [x] courseware.ts 改用 getLiteDoubaoClient()
- [x] classroom.ts 解答题批改改用 Lite
- [x] classroom.ts 学习建议改用 Lite
