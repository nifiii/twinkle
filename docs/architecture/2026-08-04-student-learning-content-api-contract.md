# 学生学习内容：API 契约（Gate 4）

状态：已确认。此契约覆盖新学生自学课件、旧学习助手资料下线行为和统一错题本；新版上线前全量清理由受控 CLI 完成，不开放 HTTP 删除接口。

## 1. 背景

教材课件创建、任务查询与课堂实体读取已有 API。新实现不能让客户端选择课件模式；清空旧学习助手数据后，客户端不得误读旧课件、测验、成绩或错题。

## 2. 目标

提供最小 API 表面：用既有学习任务创建入口生成学生自学课件及配套测验；已清理的旧学习助手内容返回稳定下线状态；统一错题本使用一个只读聚合接口。

## 3. 契约

### POST `/api/learning-tasks`

创建学生自学课件及其同章节随堂测验。仅当 `taskType='courseware'` 且 `source.kind='chapter'` 时适用。

```json
{
  "ownerId": "child_1",
  "userName": "大宝",
  "requestKey": "uuid-or-client-idempotency-key",
  "taskType": "courseware",
  "source": {
    "kind": "chapter",
    "bookId": "book-id",
    "chapterIds": ["chapter-1", "chapter-2"]
  }
}
```

成功：`201`。

```json
{
  "success": true,
  "data": {
    "id": "task-id",
    "taskType": "courseware",
    "generationStatus": "ready",
    "sourceSnapshot": { "sourceType": "chapter", "bookId": "book-id", "chapterIds": ["chapter-1"] },
    "links": [
      { "entityType": "classroom_courseware", "entityId": "cw-id", "role": "primary" },
      { "entityType": "classroom_quiz", "entityId": "quiz-id", "role": "practice" }
    ]
  }
}
```

错误：`400 invalid_context|invalid_source|capability_unavailable`，`404` 不新增；教材不存在和章节无效均通过既有 `400 invalid_source` 表达；生成失败为 `500 generation_failed`。不接受教材正文、课件正文、测验题目、课件模式、版本或成绩字段。关闭 `STUDENT_SELF_STUDY_COURSEWARE_ENABLED` 时返回 `503 feature_disabled`。

幂等性：同一 `ownerId + requestKey` 返回原任务，不重复生成实体。

### GET `/api/learning-tasks/:id`

读取任务及链接。学生课件任务返回 `primary` 课件和 `practice` 测验链接；不返回模型提示词。

当地址引用已清理的旧学习助手内容时：`410`。服务端只根据同一 `ownerId` 的 `retired_learning_content` 索引识别，不读取备份文件或旧正文；未命中索引的 ID 保持 `404 task_not_found`。

```json
{
  "success": false,
  "errorCode": "learning_content_retired",
  "error": "该学习内容已下线"
}
```

客户端必须进入“已下线旧学习内容”状态，只提供返回智慧课堂；不得重定向、回退读取旧数组或重新创建任务。普通不存在任务仍返回 `404 task_not_found`。用户上传教材和上传试卷继续依其原有契约读取。

### GET `/api/classroom/:id`

新教材学生课件的 `data.content` 是以下结构化对象：

```json
{
  "schemaVersion": 1,
  "audience": "student",
  "objectives": ["..."],
  "steps": [],
  "summary": ["..."],
  "studyTip": "..."
}
```

服务端只在对应 `learning_tasks.sourceType='chapter'` 的路径返回该对象。客户端不得凭 JSON 形状把旧内容当教材自学课件。已清理的旧学习助手实体返回 `410 learning_content_retired`；上传教材和上传试卷实体不受此规则影响。索引记录仅用于错误映射，不向客户端返回其实体类型或历史内容。

### GET `/api/wrong-book`

只读统一错题查询。

```text
ownerId=child_1
source=all|scanned_item|quiz_result      (默认 all)
subject=语文                              (可选)
from=2026-08-01T00:00:00.000Z            (可选)
to=2026-08-31T23:59:59.999Z              (可选)
query=关键词                              (可选，最多 80 字符)
limit=50                                 (默认 50，最大 100)
cursor=opaque-cursor                     (可选)
```

成功：`200`。

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "quiz_result:result-1:2",
        "source": "quiz_result",
        "reference": { "quizResultId": "result-1", "problemIndex": 2 },
        "subject": "数学",
        "contentExcerpt": "用量角器测量...",
        "knowledgePoints": ["角的度量"],
        "createdAt": 1780000000000,
        "detailTarget": { "kind": "quiz_result", "id": "result-1", "problemIndex": 2 },
        "capabilities": { "view": true, "edit": false, "delete": false }
      }
    ],
    "nextCursor": null,
    "sources": {
      "scanned_item": { "status": "ok", "count": 3, "skippedCount": 0 },
      "quiz_result": { "status": "ok", "count": 2, "skippedCount": 1 }
    }
  }
}
```

部分成功仍为 `200`；全源不可用为 `500 WRONG_BOOK_UNAVAILABLE`；参数错误为 `400 INVALID_FILTER`。不提供写入、删除、迁移或去重接口。

### CLI：`learning-assistant-reset`

该命令只在受控服务容器中执行，不经 HTTP 暴露。

```text
node dist/scripts/learningAssistantReset.js --dry-run
node dist/scripts/learningAssistantReset.js --apply --manifest <absolute-manifest-path>
```

- 两种模式都写入时间戳备份目录：SQLite 备份、待删错题专属文件备份、SHA-256、`manifest.json`。
- `--dry-run` 不改数据库或文件；`--apply` 只接受同次重新计算一致、上传教材/试卷校验通过且无阻断项的 manifest。
- 仅 `wrong_problem` 的固定历史前缀 `/opt/hl-os/data/` 可映射至当前数据卷做存在性检查；映射文件缺失时记录为 `delete.files.missing`，apply 不执行文件移动但可删除对应派生记录。其他数据卷外路径一律是阻断项。
- 成功输出：`runId`、备份路径、manifest 路径、删除课件/测验/模拟试卷/作答/成绩/错题/任务计数、删除文件数与保留源资料校验。
- 任一保留资料校验失败、待删文件被保留资料引用、未知链接实体、备份校验失败或并发集合变化，均输出 `blocked` 并以非零状态结束，不写数据库或文件。

## 4. 风险

- CLI manifest 属于运维审计材料，含内部 ID 和文件路径，必须留在数据卷，不由前端下载。
- `410 learning_content_retired` 必须与普通 `404` 区分，防止客户端将删除数据误当作可重试的网络错误。
- 上传试卷的保留契约基于 `scanned_items.type='exam_paper'`；模拟考试的删除契约基于 `assessment_*` 表，二者不得按标题或文件名猜测。
