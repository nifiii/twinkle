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