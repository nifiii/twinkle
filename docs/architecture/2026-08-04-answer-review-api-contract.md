# 作答回顾：API 契约（Gate 4）

## 1. 背景

API 不再暴露评分、诊断、改判和成绩字段。

## 2. 目标

前端只需要提交答案、读取回顾和切换需巩固标记。

## 3. 方案

### 提交与读取

`POST /api/quiz-result/start` 及 `POST/PATCH /api/paper-attempts`

- 成功提交返回 `status: "submitted"` 与回顾 ID。
- 不返回、也不得异步生成 `correctCount`、`percentage`、`suggestions`、`isCorrect` 或评分状态。

`GET /api/.../:id/review?ownerId=...`

```json
{
  "id": "review-id",
  "ownerId": "child_1",
  "status": "submitted",
  "submittedAt": 1760000000000,
  "items": [{
    "questionId": "q1",
    "type": "choice",
    "question": "题目",
    "studentAnswer": "A",
    "referenceAnswer": "B",
    "explanation": "解析",
    "needsReinforcement": false
  }]
}
```

### 需巩固标记

`PUT /api/.../:id/review-items/:questionId/reinforcement`

请求：`{ "ownerId": "child_1", "needsReinforcement": true }`

响应：`{ "questionId": "q1", "needsReinforcement": true }`

- 仅允许当前作答的 ownerId。
- 记录不存在返回 `404 review_not_found`；题号不属于该回顾返回 `400 review_item_invalid`。
- 标记写入成功后，统一错题本下次读取必须可见；取消后不可见。
- `quiz_result` 与 `paper_attempt` 使用相同语义的来源标记；前者的 sourceId 是测验结果 ID，后者是试卷作答 ID。

### 退役端点

`GET /api/paper-attempts/:id/diagnosis`、`POST /api/paper-attempts/:id/reviews`、`PATCH /api/quiz-results/:id/override`

- 返回 `410`、`errorCode: "grading_retired"`。

## 4. 风险

- 发布时需同时替换前端调用，不能将 410 当普通网络错误反复重试。
