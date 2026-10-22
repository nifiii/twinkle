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

看图文字作答与学生绘图输入分开判断。BR-MM-013 确认后，原卷绘图子题在分析摘要归一为 `essay` 并追加 `convertedFromDrawing=true`，题型标注“问答题（原绘图题）”；原始视觉证据仍记录 `requiresDrawing=true`。同组非绘图子题保持原类型，分析模型需拆分混合分区并保持总题量。校验有绘图证据时摘要必须包含转换标记；生成提示要求知识点对应的文字推理/描述，输出仍要求绘图时拒绝发布。生成阶段根据结构摘要创建原创静态 SVG，不传递或复用母卷原图。后端使用标签/属性正向白名单限制自足 SVG，网页使用隔离的 img 文档展示，PDF使用既有 svg-to-pdfkit；提交快照保留相同 illustration，使回顾不依赖源卷。无需新增数据库列或依赖。

固定视觉证据先于文本模型调用校验；材料缺失提示具体缺失项，不消耗文本模型纠正重试。绘图需求按 BR-MM-013 转换，不再由规范化器写入“缺失项”。仅透传受控领域校验错误（至多 500 字），供应商内部异常不透传。创建任务时仍复核已保存证据，避免旧分析绕过同一门槛。旧失败分析需重新发起；不重写已存卷或历史作答。

# 4. 风险

- 全母卷视觉证据仅用于源材料完整性核验和确定分区能力。生成批次只传当前分区结构与知识点，不能把含其他分区的 `visualEvidence` 嵌入当前分区，防止模型混合题型与遗漏材料。

原始文件缺失、页渲染失败、低置信度或听力材料缺失均返回可识别错误；不创建蓝图或试卷半成品。
