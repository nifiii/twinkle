# 已生成学习资料与听力历史修复：任务分解

状态：Gate 5 已确认

## 1. 背景

本计划实现生成资料管理和历史英语听力受控修复。

## 2. 目标

交付可筛选、可删除且不损失学生回顾记录的生成资料页面，并消除无效听力重试。

## 3. 方案

### T-GLM-001 生成资料查询与删除服务

状态：已完成，本地验证通过。

Outcome：服务端可列出 ready 生成任务并安全下线一个任务及其唯一生成实体。

Inputs：BR-GLM-001 至 BR-GLM-006；AC-GLM-001 至 AC-GLM-005；API 契约。

Scope：学习任务查询、下线服务、路由、服务测试、下线索引。

Non-goals：不删除上传资料、作答回顾或错题标记；不改动生成模型。

Acceptance：筛选、唯一引用检查、完整回顾快照、410 旧地址和事务回滚均有测试。

Freedom：可选择服务内部拆分和 SQL 实现；不得变更删除边界或错误码。

Dependencies：无。

### T-GLM-002 学习资料已生成页面

状态：已完成，前端构建通过；三视口需在可访问本地集成服务或部署预览补验。

Outcome：学生可在学习资料按学科/进度筛选、继续和删除生成资料。

Inputs：T-GLM-001、Gate 3 设计、AC-GLM-001 至 AC-GLM-005。

Scope：资源路由、资料页组件、API 客户端、浏览器/前端验证。

Non-goals：不修改书架和错题本既有删除行为。

Acceptance：三视口、键盘确认、加载/空/错/删除状态和旧地址验证通过。

Freedom：可选择组件拆分和局部状态；必须复用学习资料视觉令牌。

Dependencies：T-GLM-001。

### T-ELR-001 听力失败分类与历史修复工具

状态：已完成，本地受控迁移测试通过；生产仅可先执行 dry-run。

Outcome：不可恢复的教材资料错误不再提供重试；生产可在备份和 manifest 审核后修复年级并删除无内容失败任务。

Inputs：BR-ELR-001 至 BR-ELR-003；AC-ELR-001 至 AC-ELR-002；听力技术设计。

Scope：听力/任务状态映射、智慧课堂状态、受控 CLI、测试和运行手册。

Non-goals：不批量生成听力，不伪造章节正文，不删除成功听力。

Acceptance：`grade`/正文错误不可重试；dry-run 不写入；apply 后仅清单项目改变，三年级新任务使用 g3_4。

Freedom：可选择 manifest 格式和脚本文件名；不得省略备份、清单或 apply 分离。

Dependencies：T-GLM-001 的下线语义。

### T-GLM-003 发布验证与生产执行

状态：待部署。生产 `--apply` 仍需人工审核新镜像生成的 manifest，不包含在本地实现完成范围内。

Outcome：形成本地和生产可复核证据，并在人工审核 manifest 后执行生产修复。

Inputs：T-GLM-001、T-GLM-002、T-ELR-001；全部 AC。

Scope：构建、专项测试、浏览器检查、生产 dry-run/备份/apply/回滚说明。

Non-goals：不执行未经人工审核的生产写操作。

Acceptance：测试、构建、三视口、生产 API 和备份哈希均通过。

Freedom：可选择既有测试工具和证据格式。

Dependencies：T-GLM-001、T-GLM-002、T-ELR-001。

## 4. 风险

每个任务单独提交；生产 apply 仅在 manifest 内容与验收一致时执行。回滚使用 apply 前 SQLite 备份并恢复旧镜像。
