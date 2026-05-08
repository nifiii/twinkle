## **Markdown 阅读器深度重构方案**

为了提供最优的图书阅读体验，我将基于行业领先的 **unified/remark** 生态系统对 `BookReader.tsx` 进行全面重构。重构后的阅读器将具备专业级排版、数学公式支持、代码高亮以及智能导航能力。

### **1. 核心架构升级 (Rendering Engine)**

*   **渲染引擎**: 升级 `react-markdown` 至最新版。
*   **功能插件**:
    *   `remark-gfm`: 支持 GitHub 特色语法（表格、任务列表、删除线等）。
    *   `remark-math` + `rehype-katex`: 提供专业级 LaTeX 数学公式渲染。
    *   `react-syntax-highlighter`: 为代码块提供语法高亮。
*   **专业排版**: 引入 `@tailwindcss/typography` (`prose` 插件)，确保行间距、字号和对比度符合电子阅读最佳标准。

### **2. 交互体验增强 (UX/UI Features)**

*   **智能目录 (Active ToC)**: 
    *   右侧目录不仅可点击跳转，还会随阅读进度自动高亮当前章节（基于 `Intersection Observer`）。
*   **阅读模式切换**: 
    *   提供 **护眼模式** (Sepia)、**夜间模式** (Dark) 和 **清新模式** (Default) 切换。
    *   支持动态调整 **字体大小**。
*   **阅读进度条**: 顶部实时显示阅读百分比。
*   **代码助手**: 为代码块增加“一键复制”功能。
*   **图片增强**: 支持图片点击放大查看（Light-box）和居中展示。

### **3. 实施路径 (Execution Steps)**

#### **第一阶段：环境准备**
1.  安装核心依赖：`remark-gfm`, `remark-math`, `rehype-katex`, `react-syntax-highlighter`, `@tailwindcss/typography`。
2.  更新 `tailwind.config.js` 引入 `prose` 插件。

#### **第二阶段：组件重构**
1.  重构 `BookReader.tsx`，将 Markdown 渲染逻辑抽离为 `MarkdownRenderer` 子组件。
2.  实现 `ReadingSidebar` 组件，集成目录、进度和阅读偏好设置。
3.  优化路径解析逻辑，确保所有媒体资源（图片、公式）在 Windows/Linux 环境下均能稳定加载。

#### **第三阶段：交互闭环**
1.  实现章节自动高亮逻辑。
2.  添加 Markdown 导出与下载功能的增强。

**确认后我将开始安装依赖并进行重构。我们将把简单的 Markdown 预览器提升为专业级别的电子书阅读器。**
