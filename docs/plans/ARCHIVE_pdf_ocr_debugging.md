# PDF与OCR识别历史问题归档


## 归档文档: PLAN_DEBUG_PDF_UPLOAD.md


# Debugging PDF Upload Recognition - Implementation Plan

## 1. 背景 (现象描述)
- **报错/异常行为**：用户上传特定图书 (`asd.pdf`) 时，系统无法正确识别出图书的元数据和内容。
- **影响范围**：所有由扫描图片组成的 PDF 文件均受影响。文字版 PDF 仍可正常工作。

## 2. 根因假设与验证
- **主因假设**：`asd.pdf` 是扫描版 PDF（无文本层）。当前系统使用 `pdf-parse` 读取文本，只能读取到几十个无效字符，导致基于文本进行分析的 Doubao LLM 无法正确提取元数据和 Markdown 转换。
- **验证过程**：
  编写测试脚本 `backend/test_pdf.ts` 对 `asd.pdf` 执行了 `parsePDF`。结果表明：该文档有 50 页，但 `pdf-parse` 仅提取了 81 个字符（主要为零碎空行与封面中部分被 OCR 的几个字）。证实了假设。

## 3. 方案设计 (遵循 KISS 与现有功能保护原则)

**核心原则**：
- 最小化侵入，不改变系统“解析 PDF -> AI 提取元数据 -> 后台转 Markdown”的主流程。
- 不影响现有能够正常提取文字的 PDF 处理流（继续使用 Doubao）。

**方案说明**：
在流程中引入“扫描版 PDF 降级推断”：
1. **启发式判断扫描版**：在 `backend/src/routes/upload-book.ts` 中，调用 `parsePDF` 后，通过计算 `content.length / pageCount` 的比值。如果小于 `50`（每页平均少于 50 个字符），则判断为“扫描版 PDF”。
2. **元数据提取 fallback (同步提取)**：
   如果是扫描版 PDF，在 `upload-book.ts` 阶段，绕过 `pdf-parse` 的纯文本分析，调用火山引擎（Doubao）的多模态视觉 API (Vision Model) 或 PDF 解析 API，上传该 PDF 的首页图片或 PDF 本身，结合 Prompt 分析，以此生成准确的元数据。
3. **内容提 fallback (异步转换)**：
   在 `backend/src/routes/saveBook.ts` 的后台异步转换阶段（Markdown 生成），如果之前生成的 `.txt` 文件长度极小（低于阈值），则说明文本不可用。此时调用火山引擎（Doubao）的文档解析 API 或视觉 API，将原临时 PDF 文件进行全文 OCR 识别并输出为 Markdown。使用豆包原生生态替代跨模型调用。

## 4. 实现规划

### MVP 版本修改点：
- **[MODIFY]** `backend/src/services/doubaoService.ts` 
  新增支持多模态（Vision）或特定文档解析调用的方法。
  提供 `extractMetadataFromPDFWithDoubao(pdfBuffer, fileName)` 方法，用于利用豆包视觉模型识别 PDF（可能需要先转换为图片或调用特定 PDF API）并返回 metadata。
  提供 `convertPDFToMarkdownWithDoubaoOCR(pdfBuffer, fileName)` 方法，用于全书 OCR 与格式化提取。
- **[MODIFY]** `backend/src/routes/upload-book.ts`
  检测到 `content.length / pageCount < 50` 时，调用 `extractMetadataFromPDFWithDoubao` 获取元数据，代替基于普通文本的 `doubao` 逻辑。
- **[MODIFY]** `backend/src/routes/saveBook.ts`
  在异步转换部分，如果读取的文本文件过短，则读取原本存下的临时 PDF 文件 `.pdf`，调用 `convertPDFToMarkdownWithDoubaoOCR` 获取全本内容。

## 5. 风险点与回滚方式
- **风险点**：需要确认当前账户 `ARK_MODEL_ID` 配置在火山引擎上是否支持 Vision 或文档解析（部分基础模型只支持纯文本，需调用 `ep-xyz` 系列多模态模型）。此外 PDF OCR 需要较长时间。
- **回滚方式**：保留 `pdf-parse` 的原有逻辑作为默认值。撤销上述对特定长度的劫持判断即可。

## 6. 测试建议
- **回归验证**：
  上传一个已知正常的文字版 PDF，检查是否照旧通过现有的 Doubao 文本方法提取并生成 Markdown。
- **关键路径验证**：
  上传 `asd.pdf`，检查后端 Log 是否触发了 Doubao Vision/OCR 分析，并且能准确拿到正确元数据，最后成功生成最终带图文或文字的 Markdown。
Update imageService and doubaoService for first two pages OCR


---\n

## 归档文档: PLAN_PDF_OCR.md


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


---\n

## 归档文档: 解决 PDF 识别失败及增强日志方案.md


# 解决 PDF 识别失败及增强日志方案

经过分析，`pdfjs-dist` 报告 `Invalid PDF structure` 通常是因为上传的文件本身在合并过程中损坏（例如缺少文件头），或者文件版本/加密方式特殊。为了彻底解决问题并提供调试线索，我们将采取以下步骤：

## 1. 增强 PDF 解析模块 (backend/src/services/pdfParser.ts)
*   **添加详细日志**：在解析前读取并打印文件的前 20 个字节（16进制），验证文件头是否为 `%PDF`。
*   **配置优化**：
    *   启用 `ignoreErrors: true` 选项，尽可能容忍 PDF 结构错误。
    *   显式指定 `cMapUrl` 和 `standardFontDataUrl`，确保字体加载路径正确（虽然这通常影响乱码而非结构错误，但能排除路径问题）。
*   **错误处理**：捕获 `InvalidPDFException`，并在日志中输出更具体的错误堆栈。

## 2. 优化分片上传与合并 (backend/src/routes/upload-chunk.ts)
*   **文件完整性检查**：在合并分片逻辑中，确保分片按正确的数字顺序排序（避免 `1, 10, 2` 这种字典序排序导致的合并错误）。
*   **流式合并**：确保使用 `fs.appendFile` 或流式写入，防止大文件合并时的内存问题或数据丢失。

## 3. 增强业务日志 (backend/src/routes/upload-book.ts)
*   打印传入 `parsePDF` 的 Buffer 大小，确认是否与上传时一致。
*   记录 AI 分析的每个阶段耗时。

## 4. 验证计划
1.  修改代码。
2.  本地构建 `npm run build`。
3.  提交并推送到远程。
4.  在服务器上部署并查看 `journalctl` 日志，通过打印的 HEX 头确认文件是否在传输中损坏。

---
**确认后将执行代码修改。**


---\n

