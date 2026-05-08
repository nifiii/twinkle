# 扫描版 PDF 全本 OCR 方案

## 1. 现象描述与背景
用户在上传 `asd_15pages.pdf`（扫描版）时，得到的 Markdown 转换结果是一段预设的提示语：“本文档被识别为扫描版 PDF。出于性能与流量限制，目前在线转换流程仅能为您提取基本元数据与封面...”

## 2. 根因假设与验证
- **主因假设**：该段提示语**并非豆包 AI 接口的限制或返回内容**。实际上，这是我们在 `backend/src/services/doubaoService.ts` 中的 `convertPDFToMarkdownWithDoubaoOCR` 函数里**写死的 Fallback 内容**。由于初期考虑到扫描版全书提交给多模态大模型成本较高且耗时，因此直接做了截断和提示。
- **环境依赖确认**：根据用户反馈，远程服务器环境**已经安装了 `pdftoppm`** (它属于 Poppler 工具包的一部分)。因此，我们在生产环境中完全可以通过 `pdftoppm` 将 PDF 转为图片，技术路径是完全可行的。

## 3. 方案设计 (KISS 原则)
正如用户所说，我们需要区分 PDF 类型（纯文本型 vs 扫描型），并分别处理。事实上由于之前已在元数据提取阶段加入了判断，我们在异步转换 Markdown 阶段（`saveBook.ts`）也已经有**自动拦截降级机制**：
- **现存机制**：`saveBook.ts` 在读取缓存 `.txt` 时，如果内容极短（`content.length < 200`），则认定其为扫描版 PDF，调用 `convertPDFToMarkdownWithDoubaoOCR`。如果内容丰富，就走正常的纯文本 `convertToMarkdown`。

当前缺少的唯一环节，就是把 `convertPDFToMarkdownWithDoubaoOCR` 里的“假提示”换成真正的多模态图片识别逻辑。
实现逻辑如下：
1. **提取所有页数图片**：复用并调整 `imageService.ts` 中的 `extractPagesAsImages`，支持解析 PDF 的所有页（不限制 `-l 1`）。
2. **分批发送给豆包 Vision API**：
   - 将生成的图片按组分片（由于 Vision API 每增加一张图片，Token 都会暴涨，这里建议每批发送 `3` 张图片）。
   - 让大模型顺序返回文本（以 Markdown 形式）。
3. **文本合并与清理**：控制并发地执行这些批次，最后拼接成完整的 Markdown，并删除临时图片。

## 4. 代码修改规划
### 4.1. [MODIFY] `backend/src/services/imageService.ts`
- 修改 `extractPagesAsImages`：如果是 `-1` 页，则利用 `pdftoppm` 自动提取整个文档所有页，返回所有图片列表。

### 4.2. [MODIFY] `backend/src/services/doubaoService.ts`
- 重写 `convertPDFToMarkdownWithDoubaoOCR(pdfPath, fileName)`：
  1. 调用 `extractPagesAsImages(pdfPath, tempDir, -1)` 获取所有图片。
  2. 按照每 3 张一组对图片 Base64 进行分组。
  3. 循环调用豆包多模态 API（串行或控制并发），Prompt 为：“请将这些扫描版页面的内容准确转换为带有良好排版的 Markdown 格式。直接返回 Markdown 文本。”
  4. 搜集所有结果并 `join('\n\n')` 返回。
  5. 确保执行完毕后清理生成的那些 `.jpg` 临时图片文件。

## 5. 风险点与回滚方式
1. **费用与 Token 限制**：长篇扫描版 PDF 分批发送给多模态大模型，会增加 Token 开销和时间（比如 50 页的 PDF 可能耗时 1~2 分钟）。不过由于目前 `saveBook.ts` 内 Markdown 生成是依靠 `setImmediate` **后台异步生成**的，因此不会阻塞前端响应。
2. **降级保护**：如果在转换某批次时发生严重超时报错，我们将这部分降级为错误提示以告知用户。

## 6. 验证
部署到服务器环境中后，再次上传 `asd_15pages.pdf`。观察控制台后台应当打印出分组请求 Doubao Vision 的日志，并在不久后于系统中看到一篇完整的包含了 OCR 内容的 Markdown 阅读视图。
