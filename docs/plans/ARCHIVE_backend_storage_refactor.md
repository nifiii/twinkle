# 图书存储与数据库重构历史归档


## 归档文档: 优化图书上传与保存流程逻辑.md


## 第一阶段：版本备份与环境清理

1. **Git Tag**：执行 `git tag -a v1.3.0-pre-cleanup -m "清理重构前的备份"`。
2. **移除 AnythingLLM**：
   * 物理删除 `backend/src/routes/anythingllm.ts`。
   * 从 `saveBook.ts`、`saveScannedItem.ts`、`courseware.ts` 中**彻底删除**与 AnythingLLM 索引、推送相关的代码块。
   * 修改 `databaseService.ts` 和 `fileStorage.ts`，移除 `anythingLlmDocId` 字段。

## 第二阶段：优化 AI 服务 (doubaoService.ts)

1. **保持元数据逻辑**：`analyzeMetadataWithDoubao` 函数保持不变，继续使用前 8000 字快速获取 JSON。
2. **增强 Markdown 转化**：
   * 修改 `convertToMarkdownWithDoubao` 函数：
     * 移除 30,000 字的硬编码限制。
     * 改为接收尽可能长的 `contentText`（例如前 100,000 字，或根据模型上限动态调整）。
     * 提示词保持为：要求生成符合标准 Obsidian 范式的结构化文档。

## 第三阶段：重构图书上传流 (upload-book.ts)

1. **一次提取**：继续使用 `parsePDF` 提取全文 `contentText`。
2. **并行处理**：
   * **任务 A (元数据)**：调用 `analyzeMetadataWithDoubao`（快速返回）。
   * **任务 B (Markdown)**：调用 `convertToMarkdownWithDoubao`（全量转化）。
3. **临时持久化**：
   * 将生成的全量 Markdown 存入 `uploads/temp/[id].md`。
4. **响应前端**：返回元数据 JSON。**元数据获取和处理逻辑与之前完全一致**。

## 第四阶段：重构图书保存流 (saveBook.ts)

1. **删除冗余操作**：
   * **彻底删除** 异步任务中重新调用 `parsePDF` 的代码。
   * **彻底删除** 异步任务中重新调用 LLM 转换的代码。
2. **物理移动**：
   * 直接从 `uploads/temp/[id].md` 读取已生成的 Markdown。
   * 调用 `saveBookMarkdown` 按照存储策略（用户名/学科）将其保存到正式的 Obsidian 目录。
3. **索引更新**：
   * 在 SQLite 中将书籍状态标记为 `completed`。

## 第五阶段：验证

1. **性能**：确认 `save-book` 接口不再有耗时的 PDF 解析操作，点击保存后秒回。
2. **完整性**：检查生成的 .md 文件，确认其内容比之前更完整且符合 Obsidian 范式。
3. **代码整洁度**：确认全局已无 `AnythingLLM` 相关的残留代码。


---\n

## 归档文档: 修复后端服务日志报错及图书保存失败问题.md


# 修复后端服务日志报错方案

## 1. 根因分析

### 1.1 数据库查询报错 (`SQLITE_ERROR: no such column: "shared"`)

* **现象**：在调用 `/api/books` 或 `/api/scanned-items` 时，后端日志显示 `SqliteError: no such column: "shared"`。

* **根因**：在 [fileStorage.ts](file:///d:/devops/HL-os/backend/src/services/fileStorage.ts) 的 `queryMetadata` 函数中，SQL 查询语句使用了双引号 `"shared"`。在 SQLite 中，双引号用于标识符（如列名），而单引号用于字符串常量。由于数据库表中没有名为 `shared` 的列，SQLite 将其视为不存在的列而报错。

### 1.2 图书保存失败 (`❌ 临时文件不存在: /uploads/temp/...`)

* **现象**：在调用 `/api/save-book` 时，日志显示临时文件不存在，导致保存失败。

* **根因**：在 [saveBook.ts](file:///d:/devops/HL-os/backend/src/routes/saveBook.ts) 中，路径解析逻辑存在缺陷。在 Linux 环境下，以 `/` 开头的路径（如 `/uploads/temp/...`）被 `path.isAbsolute()` 判定为绝对路径，导致程序尝试从系统根目录访问文件，而非从项目根目录访问。

***

## 2. 修复步骤

### 2.1 修复数据库查询 SQL 语法

* 修改 [fileStorage.ts](file:///d:/devops/HL-os/backend/src/services/fileStorage.ts) 中的 `queryMetadata` 函数。

* 将 SQL 语句中的 `"shared"` 修改为 `'shared'`。

### 2.2 修复图书保存路径解析

* 修改 [saveBook.ts](file:///d:/devops/HL-os/backend/src/routes/saveBook.ts) 中的路径拼接逻辑。

* 确保临时文件路径始终相对于项目根目录（`process.cwd()`）进行解析，忽略其是否以 `/` 开头。

***

## 3. 验证方案

### 3.1 数据库查询验证

* 调用 `/api/books` 接口，观察日志是否不再出现 `SqliteError`。

* 确认返回的数据包含 `ownerId` 为 `'shared'` 的记录。

### 3.2 图书保存验证

* 重新上传并保存一本图书。

* 观察日志中 `[saveBook] [1/5] 验证临时文件` 是否指向正确的绝对路径（如 `/opt/hl-os/backend/uploads/temp/...`）。

* 确认图书能够成功保存到数据库和文件系统中。

***

## 4. 风险评估与回滚

* **风险**：修改 SQL 语法和路径解析属于基础逻辑改动，需确保不会影响其他依赖这些路径的功能。

* **回滚**：若修复后出现新问题，可还原 [fileStorage.ts](file:///d:/devops/HL-os/backend/src/services/fileStorage.ts) 和 [saveBook.ts](file:///d:/devops/HL-os/backend/src/routes/saveBook.ts) 到先前版本。



---\n

## 归档文档: 图书存储与转换流程重构计划.md


# 图书存储与转换流程重构计划

经过分析，我们发现当前流程中 `upload-book.ts` 和 `saveBook.ts` 的职责划分不清，导致了元数据确认前的过早处理和重复计算。我们将按照以下步骤重构，确保文件存储、封面提取和 Markdown 转换逻辑正确执行。

## 1. 优化上传与预览 (`upload-book.ts`)
*   **目标**：仅负责文件接收、初步解析（提取元数据和封面）以供前端预览，**不做持久化存储或重型转换**。
*   **修改点**：
    *   移除 `upload-book.ts` 中所有的后台 Markdown 转换代码（即删除 `convertToMarkdown` 的调用）。
    *   移除将文件移动到 `data/originals/books` 的逻辑（如果存在），仅保留文件在临时目录或内存中，或仅生成临时预览路径。
    *   确保封面图片生成并返回临时 URL。

## 2. 重构最终保存 (`saveBook.ts`)
*   **目标**：作为图书入库的唯一入口，接收用户确认后的元数据，执行所有持久化操作。
*   **修改点**：
    *   **接收参数**：更新接口以接收前端传递的 `metadata`（包含确认后的书名、作者、标签等）和 `tempFilePath`（临时文件路径）或重新上传的文件流。
    *   **文件归档**：
        *   将原始 PDF/EPUB 文件从临时位置移动到 `data/originals/books/{ownerId}/`。
        *   将封面图片从临时位置移动到 `data/covers/` 或保留在 `uploads/covers/` 并更新数据库引用。
    *   **内容转换**：
        *   在此处调用 `llmService.convertToMarkdown(content)`。
        *   将生成的 Markdown 保存到 `data/obsidian/Books/{category}/{title}.md`。
    *   **数据库/索引更新**：保存元数据到 `books.json` 数据库，并触发 AnythingLLM 索引（如果需要）。

## 3. 增强文件服务 (`fileStorage.ts` & `imageService.ts`)
*   **验证**：检查 `saveBookFile` 和 `saveObsidianMarkdown` 方法，确保它们能自动创建不存在的目录（如按学科/分类的子目录）。
*   **封面处理**：确认 `extractCoverImage` 生成的图片路径是可访问的，且在保存图书时被正确关联。

## 4. 执行步骤
1.  **修改 `backend/src/routes/upload-book.ts`**：清理后台任务。
2.  **重写 `backend/src/routes/saveBook.ts`**：实现完整的“接收-转换-存储”逻辑。
3.  **验证**：通过上传一本新书，检查原始文件、Markdown 文件和封面图片是否均出现在预期目录中。

---
**确认后将执行代码修改。**


---\n

## 归档文档: 智学 OS 图书保存逻辑重构与 SQLite 数据库引入方案.md


## 1. 根因分析
根据您的反馈和后端日志排查，当前存在以下几个核心问题：

1.  **后端处理流程挂起**：`/api/save-book` 在记录“开始保存教材”后没有后续日志。这通常是因为在处理 28MB 的大文件时，同步的文件操作或重复的 PDF 解析耗时过长，导致连接超时或进程阻塞。
2.  **数据未持久化**：由于保存流程未完成，`metadata.json` 依然为空，因此图书馆网格中看不到任何书籍。
3.  **路径解析偏差**：后端代码中使用的 `process.cwd()` 在生产环境下（`/opt/hl-os/backend`）与预期的存储路径可能存在不一致，导致文件操作异常但未被正确捕获。
4.  **展示逻辑硬编码**：现有的 `books.ts` 路由在返回书籍列表时，标题和元数据是硬编码的（如“语文教材”），没有读取用户确认后的真实信息。
5.  **缺乏健壮的数据库**：使用 `metadata.json` 难以处理并发和复杂查询，确实需要引入 SQLite。

## 2. 解决方案设计

### **技术栈调整**
- **引入 SQLite**：使用 `better-sqlite3` 替代 `metadata.json`，存储书籍路径、标题、作者、学科、状态等信息。
- **引入日志增强**：使用 `winston` 或更详细的 `console.log` 监控每一个关键节点。

### **流程优化 (MVP 方案)**
1.  **快速保存策略**：在 `/api/save-book` 中，优先完成文件归档和数据库记录，并立即向前端返回成功。
2.  **异步转换任务**：将耗时的“PDF 转 Markdown”和“AnythingLLM 索引”改为异步执行（或在返回后继续在后台处理），避免前端因超时而无法跳转。
3.  **优化解析逻辑**：直接复用上传阶段已生成的临时路径，减少重复读取大文件的开销。

## 3. 实现步骤规划

### **第一阶段：数据库与基础建设**
1.  在后端安装 `better-sqlite3`。
2.  创建 `databaseService.ts`，定义 `books` 表结构（id, title, author, subject, filePath, mdPath, coverPath, status 等）。
3.  重构 `fileStorage.ts`，将元数据操作改为数据库操作。

### **第二阶段：后端路由修复**
1.  修改 `saveBook.ts`：
    *   增加详细的日志追踪。
    *   修正 `absoluteTempPath` 的计算方式，确保能找到临时文件。
    *   实现“先保存数据库，后异步转换内容”的逻辑。
2.  修改 `books.ts`：从数据库中读取真实的书籍信息并返回给前端。

### **第三阶段：前端与部署验证**
1.  更新 `BookUploader.tsx`，确保在收到成功响应后立即跳转，并提供保存成功的提示。
2.  更新 `Dockerfile` 和 `deploy.sh`，确保 SQLite 数据库文件持久化。
3.  在服务器执行部署并进行全流程测试。

## 4. 关键文件修改清单
- [backend/src/services/databaseService.ts](file:///d%3A/devops/HL-os/backend/src/services/databaseService.ts) (新建)
- [backend/src/routes/saveBook.ts](file:///d%3A/devops/HL-os/backend/src/routes/saveBook.ts) (流程重构)
- [backend/src/routes/books.ts](file:///d%3A/devops/HL-os/backend/src/routes/books.ts) (数据读取修复)
- [backend/src/services/fileStorage.ts](file:///d%3A/devops/HL-os/backend/src/services/fileStorage.ts) (适配数据库)
- [backend/package.json](file:///d%3A/devops/HL-os/backend/package.json) (添加依赖)

您是否同意此方案？如果确认，我将开始分步实施。


---\n

