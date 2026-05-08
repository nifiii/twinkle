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
