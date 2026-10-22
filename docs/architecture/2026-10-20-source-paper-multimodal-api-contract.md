# 1. 背景

需要让母卷分析和多选题在服务、作答和导出链路中使用同一数据结构。

# 2. 目标

冻结最小API字段，避免前后端各自解释数组答案或视觉证据。

# 3. 方案

- `POST /api/source-paper-vision-evidence`（内部服务契约）：`{ ownerId, bookId }` → `SourcePaperVisionEvidence`。
- `GET /api/assistant/source-paper-materials?ownerId=child_1`：只返回当前家庭范围内已完成解析、存在原始文件、已标注试卷/考试类且排除奥数资料的母卷摘要。
- `POST /api/learning-tasks` 的母卷请求：
  ```json
  {
    "ownerId": "child_1",
    "requestKey": "一次性客户端请求标识",
    "taskType": "assessment",
    "source": {
      "kind": "source_paper",
      "sourcePaperBookId": "book-id",
      "grade": "小学四年级",
      "options": { "examType": "final", "difficulty": "standard", "questionOverrides": { "1": 5 } }
    }
  }
  ```
  服务校验母卷与当前学生年级后创建 `source_paper` 任务，蓝图不写入章节；视觉材料缺失时任务失败且不保存半成品。
- `AssessmentQuestion.type`: `choice | multi_choice | listening | fill | essay`。
- `AssessmentQuestion.answer`: `string | string[]`；`multi_choice` 必须是非空字符串数组。
- `PaperAttempt.answers`: `Record<string, string | string[]>`。
- 图片题追加 `AssessmentQuestion.illustration?: { description: string; svg: string }`，并原样保存到作答回顾快照。看图文字作答分区 `requiresVisual=true` 时每题必填；只允许不含脚本、外链、嵌入图片的静态 SVG 子集；缺图或非法图阻断整卷发布。
- `requiresDrawing` 仅指学生需要画图或补画；看图填空、选择、写作不能归入绘图作答。
- BR-MM-013（2026-10-22 用户确认）：视觉证据的 `requiresDrawing` 保留原卷事实，不再单独成为失败原因。分析摘要 `sections[].convertedFromDrawing?: true` 标注转换，转换时必填 `conversionGoal`（至多 240 字的文字考查目标），相关分区 `responseType=essay`、`questionKind=问答题（原绘图题）`；混合分区拆开且子题总数不变。生成题型仍用现有 `essay`，答案为字符串，已有提交/回顾/PDF契约不变。缺失材料照常失败，不把绘图能力缺少当作原文件损坏。
- `requiresMaterial` 表示作答依赖材料。`requiresVisual=true` 的图文配对可以由已校验的原创 illustration 满足；题干明确引用短文/文章/对话/词库时仍必须提供对应文字 material，不允许用图片掩盖缺少的阅读原文。
- 缺失材料响应使用 `400`，`field=sourcePaper`，错误信息必须说明缺失项。

# 4. 风险

旧客户端读取字符串答案仍可工作；新客户端必须识别数组答案。错误响应不得泄露模型密钥或原始文件内容。
