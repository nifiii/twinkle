## **拍题功能深度优化方案 (综合修订版)**

根据您的最新反馈，我整合并优化了整个拍题功能的实现方案，重点解决错题卡片展示、Markdown 阅读体验、缩放交互以及数据库存储效率。

---

### **1. AI 识别协议与内容完整性 ([analyze.ts](file:///d:/devops/HL-os/backend/src/routes/analyze.ts))**
- **强制内容副本**：严禁 AI 使用“插图如上”、“见前文”等引用描述。
- **内容完整性**：要求 AI 为每道题生成的 `content` 字段必须包含完整的背景材料、插图描述及题干，确保错题剥离后依然自洽。
- **排版规范**：要求 AI 在生成内容时使用标准 Markdown 换行（双换行符），为前端渲染提供良好的分段基础。

---

### **2. 存储架构优化 ([saveScannedItem.ts](file:///d:/devops/HL-os/backend/src/routes/saveScannedItem.ts))**
- **SQLite 瘦身**：
    - **归集文档**：在 SQLite 中仅保存元数据（ID、学科、日期、MD 文件路径）。**不再保存**完整的 `problemsJson` 和 `allImagesJson`，以降低数据库体积。
    - **错题条目**：在 SQLite 中**保留**完整的结构化题目内容（`problemsJson`），确保错题本功能（卡片模式）的正常运行。
- **文件系统存储**：继续按原策略将完整识别结果保存为本地 `.md` 文件，作为归集文档的数据源。

---

### **3. 前端展示逻辑重构 ([KnowledgeHub.tsx](file:///d:/devops/HL-os/components/KnowledgeHub.tsx))**
- **差异化视图**：
    - **错题类别**：恢复并优化**错题展示卡片**模式。对卡片内的题干内容应用 `ReactMarkdown` 渲染，解决“连成一段”的问题，并显示“老师批注”和“订正”信息。
    - **归集文档类别**：仅展示 Markdown 文档内容，**彻底移除原始图片展示区域**。
- **Markdown 美化**：定义专门的 Markdown 渲染样式，强制应用合理的行高和段落间距，确保阅读体验清晰。

---

### **4. 交互与筛选优化 ([CaptureModule.tsx](file:///d:/devops/HL-os/components/CaptureModule.tsx))**
- **筛选器调整**：移除“全部类别”，仅保留“错题”和“归集文档”。
- **默认值设置**：默认选中的分类设置为“错题”。
- **缩放逻辑修正**：
    - **放大**：1.0x -> 1.5x -> 2.0x 循环。
    - **缩小**：点击缩小按钮直接恢复到 1.0x。

---

### **5. 实施步骤**
1.  **修改 [analyze.ts](file:///d:/devops/HL-os/backend/src/routes/analyze.ts)**：升级 AI 协议，确保内容完整且易于排版。
2.  **修改 [saveScannedItem.ts](file:///d:/devops/HL-os/backend/src/routes/saveScannedItem.ts)**：调整 SQLite 存储策略，实现归集文档瘦身。
3.  **修改 [CaptureModule.tsx](file:///d:/devops/HL-os/components/CaptureModule.tsx)**：调整默认分类、移除冗余选项、重构缩放逻辑。
4.  **修改 [KnowledgeHub.tsx](file:///d:/devops/HL-os/components/KnowledgeHub.tsx)**：重构详情页，实现错题卡片与文档预览的逻辑分离，并应用 Markdown 美化。

请确认此综合方案，确认后我将立即执行修改。