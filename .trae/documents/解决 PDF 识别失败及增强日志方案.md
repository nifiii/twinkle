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