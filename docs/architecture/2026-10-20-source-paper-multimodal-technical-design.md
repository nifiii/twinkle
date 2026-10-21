# 1. 背景

现有 `assessmentPaperService` 只读取 `books.mdPath`，视觉模型能力分散在OCR服务中且不保留页级证据。

# 2. 目标

建立最小稳定契约：输入安全的原始文件路径，输出可审计的页级结构证据；生成阶段只消费证据摘要和可用的听力原文摘要。

# 3. 方案

`SourcePaperVisionEvidence`：

```ts
{ pages: number; sections: [{ title, questionRange, responseType, requiresMaterial, requiresVisual, requiresAudio, requiresDrawing }]; assets: [{ type, page, bbox, questionNumbers, description, confidence }]; issues: string[] }
```

路径必须位于 `DATA_DIR` 下；Vision 模型使用 `ARK_SOURCE_PAPER_VISION_MODEL_ID`，未配置时回退 `ARK_VISION_MODEL_ID`。服务可注入 `renderPages` 与 `analyzePage` 便于测试。证据不持久化原图。

`QuestionType` 增加 `multi_choice`；答案在API和前端统一为 `string | string[]`，数组按题目选项顺序规范化。

# 4. 风险

原始文件缺失、页渲染失败、低置信度或听力材料缺失均返回可识别错误；不创建蓝图或试卷半成品。
