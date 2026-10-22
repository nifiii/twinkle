# 母卷失败任务列表修复报告

## 1. 背景

生产智慧课堂“英语 → 模拟考试”曾把没有任何试卷链接的 `source_paper` 失败任务全部列出来，并显示“请重新选择试卷条件创建”。这些卡片不能继续学习，也不能在原任务上安全重试。

## 2. 目标

- 终态母卷失败任务不再进入智慧课堂任务列表或待学习计数。
- 正在排队或生成中的母卷任务仍可用于查看进度。
- 成功任务、历史作答回顾和任务详情接口保持可读。
- 不降低母卷视觉材料、题量、原创性或年级校验门槛。

## 3. 证据与根因

生产只读 SQLite 查询（2026-10-22）显示当前学生母卷任务中：1 项 `ready`、15 项 `failed`。失败任务的 `learning_task_links` 为空；失败原因包括视觉材料不完整、原创题完整性校验失败和重复题校验失败。前端仍能看到这些任务，是因为 `listClassroomTasks` 在转换前无条件读取全部 `learning_tasks`，而 `ClassroomTaskHub` 对失败的模拟考试只渲染不可操作的文案。

该问题分类为 **7. 代码实现 bug**：后端列表投影没有遵循母卷失败任务“无可学习内容、无安全重试路径”的状态边界。

## 4. 方案

`listClassroomTasks` 过滤 `sourceType='source_paper'` 且 `generationStatus in ('failed','resource_unavailable')` 的任务。过滤只作用于智慧课堂列表；任务详情仍返回失败状态和错误原因，分析页仍保留失败原因。`queued` 和 `running` 不过滤，便于用户查看生产进度。

## 5. 验证

- `backend/src/services/classroomTaskQueryService.ts` 增加终态母卷失败过滤。
- `backend/test/classroomTaskQueryService.test.ts` 增加失败任务不出现在列表、运行中任务仍出现、详情仍可读的回归用例。
- 后端 TypeScript 构建通过。
- 前端 Vite 构建通过。
- 本机完整后端测试受工作树共享的 `better-sqlite3` 原生绑定缺失阻断，未将该环境问题误判为业务回归；应在 Docker Node 20 构建阶段执行完整测试。

## 6. 风险

该修复不会自动删除生产失败记录；历史失败任务仍保留在数据库和分析页，便于审计。若后续需要清理，应按既有备份、manifest、人工审核和 `--apply` 流程单独执行。
