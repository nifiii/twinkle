# 已生成学习资料：API 契约

状态：Gate 4 已确认

## 1. 背景

资料页需要独立于智慧课堂的筛选接口，删除以任务为原子单位。

## 2. 目标

让前端可分页读取、继续和受控下线生成资料。

## 3. 方案

### `GET /api/generated-learning-materials`

Query：`ownerId` 必填；`subject`、`progress=all|pending|completed`、`cursor` 可选；`limit=1..100`。

`200`：`{ success: true, data: { items: GeneratedMaterial[], nextCursor } }`。

`GeneratedMaterial` 包含 `taskId`、`taskType`、`title`、`subject`、`book`、`chapterTitles`、`learningStatus`、`createdAt`、`primaryLink`。不返回生成正文、作答或上传资料路径。

### `DELETE /api/generated-learning-materials/:taskId`

Body：`{ ownerId }`。仅 `source=task` 且 `ready` 任务可删除。

`200`：`{ success: true, data: { taskId, retiredEntityCount } }`。

错误：`400 invalid_source`、`404 task_not_found`、`409 shared_generated_content`、`409 review_snapshot_incomplete`、`410 learning_content_retired`。所有拒绝均不写数据。

### 生产维护 CLI

`repairEnglishListeningFailures.js` 默认生成 SQLite 备份和 `manifest.json`；需要 `--book-id`。`--apply` 必须指定已经审核的 manifest，只更新目标教材的 `grade` 为 `三年级下册`，并下线该 manifest 内无内容链接的教材元数据/正文失败英语听力任务。它不批量生成听力，也不处理清单外失败任务。

### 失败任务展示

任务摘要增加只读 `retryable:boolean` 与 `blockedReason?:string`。`resource_unavailable` 和 `invalid_source` 为不可重试；其他失败由服务端决定。

## 4. 风险

删除请求必须携带当前 `ownerId`；它是家庭资料上下文，不作为安全隔离声明。
