# 学习小助手全量清理运行手册

状态：实现完成，生产执行待单独授权

## 1. 背景

新版服务首次上线前，需要清空旧学习小助手派生学习数据。上传教材、上传试卷和其他非错题扫描资料是源资料，必须保持不变。清理由受控 CLI 执行，不提供 HTTP 删除接口。

## 2. 目标

在可恢复、可审计的前提下删除旧课件、测验、模拟考试、作答、成绩、错题、任务和专属文件；保留教材、上传试卷及其源文件。

## 3. 方案

### 3.1 前置条件

1. 已部署包含 `learningAssistantReset` 和 `retired_learning_content` 数据库初始化的镜像，且已至少启动一次完成建表，但尚未开启新版课件创建入口。
2. 服务处于维护窗口，停止 Web/API 进程，避免清单生成后继续创建旧学习内容。
3. 数据卷具备足够空间存放 SQLite 备份、`metadata.json` 备份和待删错题文件备份。
4. 当前执行人拥有本次生产 `--apply` 的单独授权。

### 3.2 Dry-run

在容器内执行：

```bash
node dist/scripts/learningAssistantReset.js --dry-run
```

核对输出的时间戳备份目录中的：

- `hlos.db` 与其 SHA-256；
- `metadata.json` 备份及 SHA-256（若存在）；
- `wrong-files/` 中的候选错题专属文件；
- `manifest.json` 的删除集合、保留集合、共享文件和 `blockers`。
- `delete.files.missing`：仅允许固定旧前缀 `/opt/hl-os/data/` 的 `wrong_problem` 映射后缺失；教材 `coverPath=/covers/<filename>` 必须映射并验证 `DATA_DIR/obsidian/covers/<filename>`，不得以 URL 形式跳过检查；不得出现教材、上传试卷、其他扫描资料或任意未知卷外路径。

必须满足：

- `blockers` 为 `[]`；
- `retain.books` 包含预期教材；
- `retain.scannedItems` 包含上传试卷 `exam_paper`；
- `delete` 不包含 `books`、非错题扫描项或任何被保留资料引用的文件。

### 3.3 Apply

仅使用已人工核对的绝对 manifest 路径：

```bash
node dist/scripts/learningAssistantReset.js --apply --manifest /opt/twinkle/data/migrations/2026-08-04_learning_assistant_reset/<run-id>/manifest.json
```

脚本会重新生成当前清单并比较集合。任一行、文件哈希、保留资料、metadata 错题条目或阻断项变化都会失败退出且不删除数据。成功时：

1. 错题专属文件被移动到本次备份目录的 `staged-files/`；
2. SQLite 在一个事务内先写入只含 `ownerId`、实体类型、实体 ID、下线时间的下线索引，再删除派生学习记录；
3. `metadata.json` 仅移除旧错题条目；
4. `result.json` 记录删除计数和备份目录。

### 3.4 执行后验证

1. 查询 `books` 与 `scanned_items.type='exam_paper'`，确认 ID、数量和源文件 SHA-256 与 manifest 保留集合一致。
2. 确认旧课件、测验、模拟考试、作答、成绩、错题和学习任务均不可读取；旧地址应返回 `410 learning_content_retired`。
3. 启动新版服务，创建一个章节学生自学课件，确认其自动关联随堂测验。
4. 归档 manifest、result、镜像版本、执行时间和验证结果。

### 3.5 恢复

出现错误或需要撤回时：停止服务，校验备份 SHA-256，恢复 `hlos.db`、`metadata.json`（若存在）和 `staged-files/` 的原路径文件后再启动服务。恢复会重新暴露旧学习内容，必须由家长再次明确授权。

## 4. 风险

| 风险 | 控制 |
| --- | --- |
| 错误执行 apply | CLI 必须携带已审核 manifest，且会重新比对当前集合。 |
| 删除源资料 | `books`、非错题扫描项及引用文件不在删除 SQL 或文件移动集合中。 |
| 数据库与文件不同步 | 先备份、暂存文件、更新 metadata、再提交 SQLite 事务；失败时恢复文件与 metadata。 |
| 服务运行中产生新数据 | 维护窗口内停止服务，apply 前重新计算并比较 manifest。 |
