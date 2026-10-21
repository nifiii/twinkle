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
- 缺失材料响应使用 `400`，`field=sourcePaper`，错误信息必须说明缺失项。

# 4. 风险

旧客户端读取字符串答案仍可工作；新客户端必须识别数组答案。错误响应不得泄露模型密钥或原始文件内容。
