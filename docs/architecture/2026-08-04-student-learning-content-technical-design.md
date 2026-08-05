# 学生学习内容：技术设计（Gate 4）

状态：已确认。上游：`2026-08-04-student-learning-content-prd.md`、Gate 3 设计和验收用例；覆盖 BR-SSC-001 至 BR-SSC-012、BR-UWB-001 至 BR-UWB-007。

## 1. 背景

新版服务首次上线前，用户授权清空全部既有学习小助手派生学习数据。上传教材与上传试卷是用户源资料，不能被删除。历史课件、测验、模拟考试、作答、成绩、错题和学习任务分散在课堂、学习域、扫描归档和文件存储中，必须按源资料白名单清理。

## 2. 目标

1. 新教材课件统一保存为可校验的学生自学结构，并自动创建同章节随堂测验。
2. 清空全部旧学习小助手派生学习资料及关联记录，不保留访问入口。
3. 保留 `books`、上传试卷 `scanned_items.type='exam_paper'`、其他非错题扫描资料与对应源文件。
4. 迁移在数据库和文件系统层均可审计、可阻断、可从备份恢复。

## 3. 方案

### 3.1 系统边界与数据流

```text
教材章节正文
  -> StudentCoursewareService
  -> 模型生成 { courseware, quiz }
  -> 结构校验
  -> classroom_items（学生课件 + 随堂测验）
  -> learning_task_links（primary + practice）
  -> 智慧课堂任务详情

旧学习助手数据 + 错题专属文件
  -> LearningAssistantReset（备份 -> dry-run 清单 -> --apply 事务）
  -> 删除派生实体 / 仅由错题占用的文件
  -> 任务详情返回已下线状态

books + 非错题 scanned_items + 源文件
  -> 仅计数、路径和 SHA-256 校验
  -> 永不进入删除集合
```

### 3.2 模块职责

| 模块 | 职责 | 不负责 |
| --- | --- | --- |
| `StudentCoursewareService` | 校验章节、生成并原子保存学生课件与配套测验。 | 修改评分、教材解析或旧数据。 |
| `StudentCoursewareValidator` | 校验学习结构、步骤数、必填内容和禁用教师话术。 | 推断学生掌握程度。 |
| `LearningAssistantReset` | 备份、清单、保留源资料校验、删除派生数据和专属文件。 | 删除上传教材、上传试卷、非错题扫描资料或共享文件。 |
| `RetiredLearningContentIndex` | 仅记录已清理学习内容的所有者、实体类型、实体 ID 与下线时间，以区分已下线地址和未知地址。 | 保存或恢复旧课件正文、题目、成绩、错题、答案或其他可学习内容。 |
| `UnifiedWrongBookQueryService` | 新服务运行后只读聚合新的 `scanned_items` 与 `quiz_results`。 | 恢复旧错题、迁移或重新批改。 |
| 任务路由与前端 | 创建/读取新任务；旧目标缺失时呈现下线状态。 | 在 HTTP 或浏览器层删除数据、猜测旧内容。 |

### 3.3 新学生课件内容模型

不新增 `contentMode` 或 `contentVersion` 数据库列。新教材课件的 `contentJson` 统一为对象；教材任务读取路径只接受该结构。

```json
{
  "schemaVersion": 1,
  "audience": "student",
  "objectives": ["能认识并测量角的大小"],
  "steps": [
    {
      "id": "step-1",
      "kind": "objective|explanation|example|self_check|misconception|summary",
      "knowledgePoint": "角的度量",
      "title": "先认识量角器",
      "content": "面向当前年级的讲解正文",
      "example": { "prompt": "...", "walkthrough": ["..."], "answer": "..." },
      "selfCheck": { "id": "check-1", "prompt": "...", "options": ["..."], "answer": "...", "explanation": "..." }
    }
  ],
  "summary": ["..."],
  "studyTip": "..."
}
```

校验不变量：`audience=student`；步骤数 6 至 10；至少各有一个 `explanation`、`example`、`self_check`、`misconception`、`summary`；每步有标题、知识点和正文；不存在教师字段。校验失败时任务为失败，课件和测验半成品均不写入。

### 3.4 配套测验关联

一次“生成学生自学课件”请求在同一 SQLite 事务内写入学生课件（`primary`）与同章节随堂测验（`practice`）。生成、结构校验或写入任一步失败，两个实体和链接均不保留。复用 `learning_task_links`，不新增表。

### 3.5 新版上线前全量清理

一次性 `LearningAssistantReset` 默认 dry-run，只有显式 `--apply` 才能写入。它不接收 `ownerId`，对数据库所有家庭资料执行；用户已确认这是新版首次上线的全量清理。

**保留白名单，优先于所有删除规则**

- `books` 全部行，以及其 `filePath`、`mdPath`、`coverPath` 指向的源文件。
- `scanned_items` 中 `type <> 'wrong_problem'` 的所有行，特别是用户上传试卷 `type='exam_paper'`，以及其 `mdPath`、`imagePath`、`allImagesJson` 指向的源文件。
- `metadata.json` 中的非错题条目，以及所有教材解析产物和非错题源资料。
- 不删除 `external_resources` 或用户档案。

**删除集合**

| 层级 | 删除范围 |
| --- | --- |
| 课堂内容 | `classroom_items` 的全部课件和测验；`quiz_results`；`wrong_problem_quiz_links`。 |
| 任务 | `learning_tasks`、`learning_task_links`、`learning_task_events`；`learning_packages`、`learning_package_progress`。 |
| 模拟考试 | `assessment_blueprints`、`assessment_papers`、`paper_attempts`、`attempt_item_results`、`review_events`、`export_jobs`。这些是学习助手生成的试卷或作答，不是用户上传试卷。 |
| 错题 | 仅 `scanned_items.type='wrong_problem'`、`metadata.json` 中对应错题条目，以及仅被这些记录引用的 Markdown、图片和附件。 |

**备份、清单、校验与执行**

- 每次 dry-run 和 apply 均在同一受控数据卷创建时间戳目录，包含 SQLite 一致性备份、SHA-256、待删文件备份、`manifest.json` 和执行结果。
- `manifest.json` 必须按表列出待删 ID/计数、待删文件、保留源资料 ID/计数/文件 SHA-256、引用关系、阻断项和前后校验结果；不得包含教材正文、学生答案或模型提示词。
- 错题文件只有在数据卷内、仅被 `wrong_problem` 记录引用、且没有路径穿越时才进入删除集合；被保留资料引用的文件明确保留，无法解析或位于数据卷外的错题文件列入阻断项。
- 仅对 `scanned_items.type='wrong_problem'` 的精确历史前缀 `/opt/hl-os/data/`，将其相对路径映射到当前数据卷作存在性检查；映射后不存在的文件列入 `delete.files.missing`，不执行文件暂存但仍可随其错题记录在 apply 中删除。教材 `coverPath` 的站内静态 URL `/covers/<filename>` 是唯一非文件路径例外，映射到 `DATA_DIR/obsidian/covers/<filename>` 后校验实际文件。两种例外以外的任何数据卷外路径均阻断。
- `--apply` 重新计算集合，要求与批准的 dry-run manifest 完全一致；先备份，再将待删错题专属文件以同一数据卷内的原子移动暂存到本次备份目录，随后以单一 SQLite 事务按依赖顺序删除记录。事务失败时必须将已暂存文件移回原路径；事务成功后，暂存文件仅作为恢复材料保留在备份目录，不再出现在业务源路径。任一校验、备份、集合变化、暂存或事务失败都停止且不得报告成功。
- 删除事务在删除旧 `learning_tasks`、`classroom_items`、学习包、模拟考试、课堂作答及其关联实体前，为每个可由旧地址直接读取的实体写入 `retired_learning_content`。该索引只含 `ownerId`、`entityType`、`entityId`、`retiredAt`，不得保存正文、题目、成绩、错题、答案、章节摘录或模型输出；事务失败时索引与删除均回滚。
- 删除前关闭全部学习小助手创建入口；删除及校验完成后才发布/开启新版学生自学课件。

### 3.6 统一错题本模型

统一查询返回标准化错题摘要，不持久化聚合结果。新版产生的课堂错题只读取 `quiz_results.status='completed'` 中题干、正确答案完整且 `isCorrect=false` 的记录；扫描错题读取 `scanned_items.type='wrong_problem'`。两来源独立查询，支持部分成功，不回填或迁移旧数据。

### 3.7 权限、可观测性与恢复

- 家庭单设备模式按 `ownerId` 选择资料，不将其作为安全隔离边界。
- 任务和课堂详情先检查现存实体；实体不存在时仅查询同一 `ownerId` 的 `retired_learning_content`。命中返回 `410 learning_content_retired`，未命中返回正常 `404`；索引不提供列表、正文或恢复接口。
- 日志只记录 run ID、备份/manifest 路径、表计数、文件计数和错误码；清单留在数据卷，不由普通 API 返回。
- 指标：新课件结构校验失败率、测验关联完整率、清理删除/保留/阻断计数、文件校验失败率和错题本部分失败率。
- 恢复：停止服务，校验本次数据库与文件备份 SHA-256，恢复数据卷后重启。恢复会重新出现旧学习内容，必须经家长明确授权。

## 4. 风险

| 风险 | 控制 |
| --- | --- |
| 删除用户上传试卷 | 白名单保留所有非 `wrong_problem` 扫描项及文件，尤其 `exam_paper`；apply 前后验证 ID、数量和 SHA-256。 |
| 错题附件与上传资料共用路径 | 只删仅被错题记录引用的数据卷内文件；被保留资料引用的文件保留，其余无法安全归类的路径阻断。 |
| 误把生成模拟考试视为上传试卷 | 生成试卷只在 `assessment_*` 表中，上传试卷只在 `scanned_items`；按表边界处理。 |
| 运行中再生成旧内容 | 先关闭所有学习助手创建入口，apply 前重新比较 manifest。 |
| 删除后需回溯 | 每次执行前创建可校验数据库与专属文件备份。 |

## 5. 已确认决策

| ID | 决策 | 结论 | 原因 |
| --- | --- | --- | --- |
| D-SLC-001 | 新课件是否自动生成同章节随堂测验？ | 是。 | 已确认，保持“自学完成 → 诊断”闭环。 |
| D-SLC-002 | 新版首次上线如何处理旧学习小助手数据？ | 全量删除派生数据；保留上传教材和上传试卷。 | 已确认，避免教师型历史内容继续进入新版学生学习路径。 |
