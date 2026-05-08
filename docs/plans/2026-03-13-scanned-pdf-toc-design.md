# 扫描版 PDF 目录提取增强设计文档

## 1. 背景 (Background)
目前的系统在处理影印版（扫描件）PDF 时，主要依赖 `upload-book/parse` 阶段的 Vision 分析。但 Vision 仅能处理前 4 页，如果书籍目录位于第 5 页之后，则无法提取到目录结构。这导致后续基于目录生成教学内容的流程中断。

## 2. 目标 (Goal)
实现在全书 OCR 转换为 Markdown 后，利用 AI 自动从 Markdown 文本中提取完整的层级目录（`ChapterNode` 结构），并将其回填至系统索引和 Markdown 元数据中。

## 3. 方案 (Solution) - 方案 A：异步后置提取
在 `saveBook` 路由的异步处理流程中，增加一个“目录补全”环节。

### 3.1 架构设计 (Architecture)
1. **触发时机**：OCR 任务结束并生成全本 Markdown 之后。
2. **文本采样**：截取 Markdown 前 20,000 个字符（通常涵盖了前言和目录部分）。
3. **AI 提取**：调用豆包专用 Prompt，识别 Markdown 中的章节、标题和页码。
4. **数据同步**：
   - 更新数据库中的 `tableOfContents`。
   - 更新 Markdown 文件头部（Obsidian Properties）的 `tableOfContents`。

### 3.2 关键组件 (Components)
- **`doubaoService.ts`**: 新增 `extractTOCFromMarkdown` 函数，负责与大模型通信。
- **`saveBook.ts`**: 修改异步块，在 OCR 回调中串联目录提取逻辑。
- **`fileStorage.ts`**: 增强 `saveBookMarkdown` 或提供专门的元数据更新工具。

### 3.3 数据流 (Data Flow)
`PDF` -> `Images` -> `Doubao OCR` -> `Markdown` -> `Doubao TOC Analysis` -> `Success`

## 4. 风险 (Risk)
- **Token 限制**：Markdown 前部如果极其冗长，可能超过单次 Prompt 长度。
  - *对策*：仅截取前 20k 字符，并寻找关键字符串“目录”进行二次定位。
- **解析错误**：AI 可能会从正文标题中误识别出非目录项。
  - *对策*：提示词中明确要求识别“目录页”特征。

## 5. 回滚 (Rollback)
如果该功能导致处理时间显著变长或出错，只需在 `saveBook.ts` 中注释掉 `extractTOCFromMarkdown` 的调用即可恢复原样。

## 6. FAQ
- **Q**: 为什么不直接在图片阶段做？
- **A**: 图片阶段受限于 API 批次大小和上下文关联，从结构化的 Markdown 文本中提取目录层级更容易被 AI 理解。
