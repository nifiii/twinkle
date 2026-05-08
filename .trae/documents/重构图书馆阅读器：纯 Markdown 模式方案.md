## **图书馆阅读器重构方案：纯 Markdown 沉浸式阅读**

根据您的需求，我将重构图书馆的阅读功能，放弃 PDF/EPUB 等重型格式，转而使用轻量级的 Markdown 进行渲染。这不仅能极大地提升加载速度，还能提供更统一、流畅的阅读体验。

---

### **1. 核心链路调整**

#### **后端变更 (Backend)**
- **数据结构升级**：在 `EBook` 模型中增加 `mdPath` 字段，确保前端能获取到转换后的 Markdown 文件路径。
- **接口增强**：更新 `GET /api/books` 和 `GET /api/books/:id` 接口，在返回的图书对象中包含 `mdPath`。
- **文件服务**：利用已有的 `/data` 静态服务，直接将服务器上的 `.md` 文件提供给前端下载/查看。

#### **前端变更 (Frontend)**
- **类型定义更新**：在 `types.ts` 中同步更新 `EBook` 接口，包含 `mdPath`。
- **服务层适配**：在 `apiService.ts` 中完成 `mdPath` 的字段映射。

---

### **2. 阅读器重写 ([BookReader.tsx](file:///d:/devops/HL-os/components/BookReader.tsx))**

我们将彻底重写 `BookReader.tsx`，使其成为一个专业的 Markdown 阅读器：
- **移除依赖**：彻底移除 `react-pdf` 及其相关的 `pdfjs` 配置，精简包体积。
- **内容渲染**：
    - 使用 `react-markdown` 进行文本解析。
    - 针对 Markdown 语法（标题、引用、代码块、表格）进行专门的 CSS 样式美化，确保排版美观。
- **加载逻辑**：
    - 优先通过 `mdPath` 获取内容。
    - 如果 `mdPath` 尚未生成（处理中），提供友好的等待提示。
- **交互优化**：
    - 采用平滑的垂直滚动模式，更符合数字阅读习惯。
    - 保留全屏切换和基础工具栏。

---

### **3. 实施步骤**
1.  **后端类型与路由更新**：修改 `backend/src/types.ts` 和 `backend/src/routes/books.ts`。
2.  **前端类型与服务更新**：修改 `types.ts` 和 `apiService.ts`。
3.  **重写阅读器组件**：修改 [BookReader.tsx](file:///d:/devops/HL-os/components/BookReader.tsx)。
4.  **样式调优**：为 Markdown 内容添加书本风格的排版样式。

确认方案后，我将立即开始执行。