## **图书馆图书阅读功能实现方案**

根据您的需求，我将为图书馆模块新增一个沉浸式阅读器，支持 PDF、TXT 及 EPUB 格式的在线预览。

---

### **1. 新增阅读器组件 ([BookReader.tsx](file:///d:/devops/HL-os/components/BookReader.tsx))**
创建一个全新的阅读器组件，根据文件格式提供不同的展示逻辑：
- **PDF 格式**：利用浏览器的原生能力，通过 `<iframe>` 或 `<embed>` 标签嵌入 PDF 文件，支持缩放、打印及目录跳转。
- **TXT 格式**：通过 `fetch` 获取文本内容，并在具有良好排版（行高、字体、页边距优化）的容器中渲染，支持滚动阅读。
- **EPUB 格式**：由于当前环境未安装专门的 EPUB 解析库，将优先尝试以文本预览模式打开，或提供清晰的格式说明及下载链接。
- **通用功能**：顶部包含书名显示及“退出阅读”按钮。

---

### **2. 升级图书馆主控逻辑 ([LibraryHub.tsx](file:///d:/devops/HL-os/components/LibraryHub.tsx))**
- **状态管理**：在 `ViewMode` 类型中增加 `'read'` 模式。
- **导航逻辑**：
    - 修改 `handleSelectBook` 函数，使其点击后将 `viewMode` 切换至 `'read'` 并记录当前选中的图书对象。
    - 在渲染逻辑中增加判断，当处于阅读模式时，隐藏网格列表并展示 `BookReader` 组件。

---

### **3. 优化卡片交互 ([BookCard.tsx](file:///d:/devops/HL-os/components/BookCard.tsx))**
- **触发机制**：保留现有的卡片整体 `onClick` 事件触发 `onSelect` 的逻辑。
- **防冲突处理**：由于“修改信息”按钮已经配置了 `e.stopPropagation()`，点击修改按钮时不会意外触发阅读器，满足“除点击修改按钮外”的要求。

---

### **4. 实施步骤**
1.  **创建 [BookReader.tsx](file:///d:/devops/HL-os/components/BookReader.tsx)**。
2.  **修改 [LibraryHub.tsx](file:///d:/devops/HL-os/components/LibraryHub.tsx)**：引入阅读器并处理视图切换。
3.  **验证交互**：确保点击卡片各处均能顺畅进入阅读模式，且不影响编辑功能。

请确认以上方案，确认后我将开始编码实现。