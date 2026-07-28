# 学习小助手重构：技术设计与接口契约（Gate 4）

状态：已确认（Gate 4）

上游：BR-001 至 BR-020，`2026-07-28-learning-assistant-prd.md`，Gate 3 设计与验收文档。

## 1. 背景

当前学习产物分散于 `classroom_items`（课件、随堂测验）、`learning_packages`（听力、视频、思维训练）和 `assessment_papers`（模拟考试）。已有错题生成按单题保存讲解/测验。若由浏览器直接拼接这些存储，任务状态、原实体连接、失败恢复和历史兼容会分散到多个组件，无法稳定满足 BR-014 与 BR-015。

## 2. 目标

新增一个后端拥有的统一学习任务索引，以一个不可变任务记录表示一次学生发起的学习活动；它链接而不复制现有实体，并提供学习小助手的聚合输入与智慧课堂的聚合读取。

## 3. 方案

### 3.1 系统边界

```text
学习小助手前端
  -> 助手概览/错题候选/章节能力 API
  -> 统一学习任务服务
       -> 现有课件、错题、学习包、考试服务
       -> learning_tasks + learning_task_links
  -> 智慧课堂任务 API
       -> 任务索引 + 只读 legacy 适配器
  -> 原实体详情（课件、测验、学习包、试卷、诊断）
```

| 模块 | 责任 | 不负责 |
| --- | --- | --- |
| 助手概览服务 | 汇总可见教材、错题学科计数、作答错题、章节能力和可用性原因。 | 生成或保存课堂内容。 |
| 统一任务服务 | 创建任务、幂等重试、状态迁移、实体链接、任务事件日志。 | 重写课件、试卷或诊断的内容格式。 |
| 错题聚合服务 | 校验多题来源、合并知识点、创建一份讲解和一份原创测验。 | 修改错题本原始识别数据。 |
| 视频审核服务 | 保存审核、健康、适龄和可嵌入状态；提供允许嵌入的 URL。 | 搜索、代理、下载、转码或托管视频。 |
| 智慧课堂任务查询 | 聚合新任务与只读 legacy 项目，返回稳定的任务摘要和解析目标。 | 将 legacy 内容复制进新表。 |
| 原实体服务 | 继续提供课件、测验、学习包、试卷、导出和诊断。 | 理解全局任务列表布局。 |

### 3.2 数据模型

在现有 SQLite `learningDomain` 中增加以下表；它们为附加式迁移，不改写历史内容表。

#### `learning_tasks`

| 字段 | 约束/含义 |
| --- | --- |
| `id` | UUID，主键。 |
| `ownerId` | 当前家庭学生档案标识，用于资料视图和记录归属；首期没有角色或成员授权模型。 |
| `requestKey` | 前端首次点击生成时产生的 UUID；同一 `ownerId` 唯一，用于网络重试幂等。再次点击生成必须使用新的 key。 |
| `taskType` | `courseware`、`classroom_quiz`、`wrong_review`、`english_listening`、`video`、`math_thinking`、`assessment`。 |
| `sourceType` | `chapter` 或 `wrong_problems`。 |
| `subject`、`grade` | 创建时快照，供快速筛选。 |
| `bookId`、`chapterIdsJson` | 教材流锚点；错题流为空。 |
| `wrongProblemRefsJson` | 错题流中的不可变来源引用数组。错题本引用为 `{ source: "scanned_item", scannedItemId, problemIndex }`；课堂作答错题引用为 `{ source: "quiz_result", quizResultId, problemIndex }`；教材流为空。 |
| `title` | 创建时可读标题，避免列表读取内容正文。 |
| `generationStatus` | `queued`、`running`、`ready`、`failed`、`resource_unavailable`。 |
| `learningStatus` | `not_started`、`in_progress`、`completed`；由原实体进度更新或查询时计算。 |
| `errorCode`、`errorMessage` | 仅保存面向学生的有限错误码/文案，不保存模型响应或密钥。 |
| `createdAt`、`updatedAt` | 毫秒时间戳。 |

索引：`(ownerId, createdAt DESC)`、`(ownerId, generationStatus, updatedAt DESC)`、`(ownerId, subject, taskType, createdAt DESC)`；唯一索引 `(ownerId, requestKey)`。

#### `learning_task_links`

| 字段 | 约束/含义 |
| --- | --- |
| `taskId` | 外键语义指向 `learning_tasks.id`。 |
| `entityType` | `classroom_courseware`、`classroom_quiz`、`learning_package`、`assessment_paper`、`external_resource`。 |
| `entityId` | 原实体 ID。 |
| `role` | `primary`、`explanation`、`practice`、`resource`、`paper`。 |
| `createdAt` | 链接创建时间。 |

唯一约束 `(taskId, entityType, entityId, role)`。一项错题任务可用 `explanation` 与 `practice` 两条链接指向各一份聚合实体；视频任务以 `resource` 链接指向经审核外链，同时可选择保留一个学习包链接以记录完成状态。

#### `learning_task_events`

只记录任务创建、开始、就绪、失败、重试和资源失效。字段为 `id`、`taskId`、`eventType`、`detailJson`、`createdAt`。它是操作审计与排障记录，不保存教材正文、题目全文、答案或模型原始响应。

#### `external_resources` 附加字段

| 字段 | 含义 |
| --- | --- |
| `embedStatus` | `allowed`、`blocked`、`unknown`。只有 `allowed` 可被任务选择。 |
| `embedUrl` | 审核确认的第三方嵌入 URL；必须是公开 HTTPS URL。 |
| `lastEmbedCheckedAt` | 最近一次嵌入许可检查。 |

资源合格条件为：`status=approved`、`reviewedAt` 非空、`linkHealthStatus=healthy`、`embedStatus=allowed`、标题/时长/适龄标签/公开 URL 完整。不得由前端或任务服务从原 URL 推导嵌入地址。

### 3.3 创建与状态流

1. 前端对一次明确的“生成”点击创建新的 `requestKey` 并请求任务服务。
2. 服务在短事务中校验家庭学生档案上下文、输入来源和能力矩阵，写入 `learning_tasks(queued)` 及 `created` 事件；同一 key 重试返回同一任务。
3. Worker 或同步适配器将状态置为 `running`，调用对应既有服务。
4. 成功时在同一事务中写入 `learning_task_links`、将任务置为 `ready` 并写入事件；失败时只置为 `failed`，不写伪链接。
5. 进入或完成原实体时，同步更新或查询计算 `learningStatus`。生成状态终态后停止轮询。
6. 用户选择“重新生成”代表新的生成操作，必须提供新的 `requestKey`，从而创建新任务；“重试失败任务”复用既有 key 仅重做同一任务，且不得覆盖任何 `ready` 任务。

错误任务可以保留为课堂记录，展示原因与重试；创建前发现无视频资源则直接返回 `resource_unavailable`，不创建实体链接。

### 3.4 现有实体接入

| 新任务类型 | 输入校验 | 复用实体/服务 | 链接角色 |
| --- | --- | --- | --- |
| `courseware` | 可见教材、具体章节 | 现有 courseware job 与 `classroom_items` | `primary` |
| `classroom_quiz` | 可见教材、具体章节 | 现有 `QuizGenerator`/`classroom_items` | `primary` |
| `wrong_review` | 1-10 个当前 `ownerId` 的错题本或课堂作答错题引用，且学科一致 | 新聚合适配器，产出一份错题讲解课件与一份测验；复用 `classroom_items`。仅错题本来源写入每题 `wrong_problem_quiz_links`，课堂作答来源只保存于任务快照 | `explanation`、`practice` |
| `english_listening` | 英语教材、具体章节、启用 packages | 现有 `learning_packages`、TTS 与两次播放规则 | `primary` |
| `video` | 指定学科教材、具体章节、合格 `external_resource` | 学习包进度或轻量视频任务适配器；只保存审核过的 embed URL | `resource`，可选 `primary` |
| `math_thinking` | 数学教材、具体章节 | 现有 `learning_packages` | `primary` |
| `assessment` | 教材、章节、类型、难度；奥数时校验资料年级 | 现有蓝图、`assessment_papers`、attempt、export、diagnosis 服务 | `paper` |

错题聚合的关键约束：一份任务中的全部选题必须属于选定学科；服务从两类原始错题中提取知识点并生成一份聚合讲解和一份原创测验。仅 `scanned_item` 来源建立 `wrong_problem_quiz_links`，以保持既有待订正统计语义；`quiz_result` 来源绝不伪造错题本链接。不把多题任务伪装成多条独立任务。

### 3.5 HTTP 契约

所有新端点位于 `/api`；`ownerId` 是必填的家庭学生档案上下文。首期只覆盖协作式家庭使用，不实现登录、角色或成员授权。

`TaskSummary` 是任务创建、列表和详情解析共用的稳定响应形状：

```json
{
  "id": "task-uuid-or-legacy:entityType:entityId",
  "source": "task",
  "taskType": "wrong_review",
  "title": "小数除法·错题讲解与测验",
  "subject": "数学",
  "grade": "四年级",
  "book": { "id": "book-1", "title": "义务教育教科书·数学四年级上册" },
  "chapterTitles": ["第一单元 大数的认识"],
  "generationStatus": "ready",
  "learningStatus": "not_started",
  "createdAt": 1780000000000,
  "updatedAt": 1780000000000,
  "primaryLink": { "entityType": "classroom_courseware", "entityId": "courseware-1", "role": "explanation" }
}
```

列表响应不包含题目、教材正文、答案、讲解正文或诊断明细。详情响应在此基础上增加 `sourceSnapshot`、全部 `links`、`errorCode`、面向学生的 `errorMessage` 及最近任务事件；原内容仍须经原实体详情 API 读取。

#### 助手读取

`GET /assistant/overview?ownerId=<id>`

返回当前家庭学生档案可见的教材摘要、错题按学科计数、课堂作答错题计数和支持能力。章节详情不在此接口返回。

`GET /assistant/wrong-problems?ownerId=<id>&subject=<subject>`

返回可选错题 `{ source, scannedItemId?|quizResultId?, problemIndex, subject, title, contentExcerpt, knowledgePoints, createdAt }`。`source` 为 `scanned_item` 或 `quiz_result`；只读。学科切换和排除仅为客户端选择状态。

`GET /assistant/books/:bookId/chapters/:chapterId/actions?ownerId=<id>`

返回所选章节允许动作与原因：`{ action, available, reasonCode?, resourceOptions? }`。视频资源仅返回已通过全部审核字段的 `{ id, title, durationSeconds, ageLabel, embedUrl }`。

#### 任务写入与读取

`POST /learning-tasks`

请求：

```json
{
  "ownerId": "child_1",
  "requestKey": "uuid",
  "taskType": "wrong_review",
  "source": {
    "kind": "wrong_problems",
    "subject": "数学",
    "grade": "四年级",
    "problems": [{ "source": "scanned_item", "scannedItemId": "item-1", "problemIndex": 2 }]
  }
}
```

教材流将 `source` 替换为 `{ "kind":"chapter", "bookId":"...", "chapterIds":["..."], "options": { "examType":"unit", "difficulty":"standard", "resourceId":"..." } }`。成功返回 `201 { success: true, data: TaskSummary }`；相同 `requestKey` 返回原任务 `200`。

`GET /learning-tasks?ownerId=<id>&status=&subject=&type=&bookId=&cursor=`

返回统一任务索引与只读 legacy 任务的稳定摘要，按 `updatedAt DESC` 游标分页。legacy 项目标记 `source=legacy`，不可重试且不要求回填任务表。

`GET /learning-tasks/:id?ownerId=<id>`

返回任务及链接；`legacy:<entityType>:<entityId>` 是只读解析 ID。若链接实体已删除则返回 `410 task_target_missing`。

`POST /learning-tasks/:id/retry`

仅允许 `failed` 或 `resource_unavailable`，且不含任何就绪实体链接的任务。请求体只含 `ownerId`；服务复用任务的不可变来源快照，事件记为 `retry_requested`。

错误响应采用 `{ success:false, errorCode, field?, error }`：
`invalid_context`、`invalid_source`、`capability_unavailable`、`resource_unavailable`、`task_not_found`、`task_target_missing`、`feature_disabled`、`generation_failed`。

### 3.6 路由下线

前端 Hash 解析器把首段为 `learn` 的路径解析为独立 `decommissioned` 状态；仅渲染“页面已下线”及 `#assistant`、`#tutor` 两个入口。不得调用学习包、试卷、作答、导出或诊断详情 API，不解析路径参数，也不触发重定向。

新的 `#tutor/task/:taskId` 先请求任务解析 API，再导航/渲染原实体详情。任务解析失败保留在课堂上下文，显示原因和返回任务列表命令。

### 3.7 安全、可靠性与可观测性

- `ownerId` 继续做格式校验和家庭学生档案记录关联；首期无登录、角色或成员授权模型。跨家庭共享或公开多用户访问必须另立身份与授权需求。新学习端点在既有开关之外增加 `LEARNING_TASKS_ENABLED`。
- 视频审核器仅验证 allowlist 中第三方公共 HTTPS 域名，限制重定向次数、超时和响应大小，拒绝 localhost、私网、文件协议和非嵌入链接，防止服务器侧请求伪造。它不保存或转发第三方 token。
- 记录结构化日志 `{ taskId, ownerId, taskType, sourceType, status, errorCode, durationMs }`；不记录教材正文、学生答案、错题题干全文、模型提示词、API key 或第三方 URL 查询参数。
- 指标：任务创建数、ready/failed 比率、生成时长、重复 requestKey 命中数、资源不可用数、任务链接缺失数、嵌入健康失败数。任务链接缺失比率大于零应可告警。
- 模型和审核调用设定明确超时；同步调用超过阈值必须转入可恢复任务，不让浏览器连接无限等待。

### 3.8 迁移、发布与回滚

1. 使用 `CREATE TABLE IF NOT EXISTS` 和附加列迁移；先部署读写任务服务和观测，后开启 `LEARNING_TASKS_ENABLED`。
2. 不回填 `learning_tasks`。课堂查询服务用只读 legacy 适配器展示已有 `classroom_items`、学习包和考试摘要，避免数据复制；旧 `#learn/*` 仍按 BR-002 下线。
3. 先以四年级教材和家庭学生档案验证；通过 AC-001 至 AC-016 后才启用入口。
4. 回滚时关闭新开关并停止新任务创建；保留任务表、事件和原实体，不执行删除或结构回退。旧 URL 不恢复。

## 4. 风险

| 风险 | 决策理由与缓解 |
| --- | --- |
| 同步生成服务与任务索引不一致 | 任务先写入，终态与链接在事务中提交；失败可重试，列表可识别失败。 |
| 错题聚合破坏旧统计 | 保留每个来源题的链接记录，但任务层只创建一次聚合记录。 |
| 第三方嵌入不稳定 | `embedStatus` 独立于链接健康；已失效任务展示资源不可用，不替换为其他内容。 |
| 旧课堂内容不可见 | 用后端只读 legacy 适配器显示，不迁移正文或作答。 |
| 跨家庭范围扩张 | 当前没有登录、角色或成员授权；若需要跨家庭共享或公开多用户访问，必须先完成独立的身份与授权设计。 |

## 5. 回滚

关闭 `LEARNING_TASKS_ENABLED` 后隐藏学习小助手与任务中心的新功能，原始课堂/学习包/试卷表保持可读。任何回滚均不得删除任务索引、链接、课程、作答、试卷、导出或诊断记录；`#learn/*` 始终维持下线状态。

## 6. FAQ

### 为什么需要任务表而不是在智慧课堂页面查询每张已有表？

一条任务包含来源、不可变选择快照、生成状态、失败原因和多个原实体链接。这些信息不能可靠地从各内容表反推；后端索引能让前端用一个稳定契约展示和恢复任务。

### 为什么 legacy 内容不回填到任务表？

回填会推断旧内容的错误来源、章节和生成意图，可能制造错误学习证据。只读适配器保留可发现性，且不篡改历史。
