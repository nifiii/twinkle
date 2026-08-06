# 已生成学习资料：技术设计

状态：Gate 4 已确认

## 1. 背景

现有学习任务已拥有任务、链接、事件和下线索引表。新能力不能把上传资料或作答回顾纳入删除范围。

## 2. 目标

提供可筛选的生成资料查询和受控下线；修复历史英语听力输入数据后清理无内容失败任务。

## 3. 方案

### 查询与下线边界

- 查询仅返回 `source=task`、`generationStatus=ready`、存在主链接且目标存在的任务；按 `ownerId`、学科、`learningStatus` 和 cursor 过滤。
- 下线以 `learning_task` 为命令对象。读取全部 `learning_task_links`，验证每个生成实体只被当前任务引用。
- 写入 `retired_learning_content` 后删除任务、链接、事件和唯一实体。实体为课堂课件/测验、听力包、试卷或错题讲解产物。
- `paper_attempts`、`quiz_results`、`attempt_item_results`、`wrong_problem_quiz_links`、`scanned_items`、`books` 不在删除集合。若试卷实体有作答回顾，删除只允许在回顾快照完整时进行。
- 删除事务失败则全部回滚；已下线任务重试删除返回同一成功语义。

### 听力失败语义

`LearningPackageValidationError(field=grade|chapterIds)` 映射为 `resource_unavailable`，保留可读原因。智慧课堂只对瞬时 `generation_failed` 显示重试；`resource_unavailable` 显示资料修复原因。

### 生产迁移

脚本读取 SQLite，创建 SHA-256 备份和 manifest：更新指定三年级英语书的 `grade` 为“三年级下册”；校验目录标题与 Markdown；只把无链接、无事件外学习进度、无作答的英语失败任务列入删除。默认 dry-run，`--apply --manifest` 才写入。对正文缺失章节保持阻断，不伪造正文。

## 4. 风险

- SQLite 引用没有外键约束，脚本和服务必须显式执行共享引用检查。
- 历史回顾是否自包含需以 JSON 快照验证；缺失时宁可阻断删除。
- 生产 `books.grade` 是唯一运行时依据，标签更新不是迁移成功证据。
