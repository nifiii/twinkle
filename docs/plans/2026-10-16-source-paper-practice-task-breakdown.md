# 母卷原创测试：实施任务

## 1. 背景

2026-10-16用户授权按文档实施并推送master。Inputs共同包含本轮PRD、Gate 3四份设计和验收、technical-design及api-contract。任务顺序执行，不把文档推送作为功能完成。

## 2. 目标

Strict on outcomes, contracts, boundaries, and acceptance. Flexible on internal implementation details.

## 3. 方案

### T-SP-001 来源边界与完整结构分析

- Outcome：可选无目录母卷并获取可核验结构，普通试卷不再混入教材。
- Inputs：BR-SP-001/002/003/007～009，AC-SP-001/002/004/005/006，分析API契约。
- Scope：共享分类规则、教材候选及服务端校验、新分析服务/路由、增量SQLite表、有效年级读取。
- Non-goals：不动原文件/旧目录、不生成试卷、不引入扫描作业库。
- Acceptance：完整读取末尾知识点；来源误用拒绝；缺材料/不确定阻断；无原答案可分析；请求去重/刷新查询；年级兜底拒绝。
- Freedom：内部helper命名、结构校验实现、测试夹具；不可只读标题或截正文。
- Dependencies：无。
- Risk：真实模型分析可能漏题；以结构核验及长卷测试防止伪完整。

### T-SP-002 原创测试生成与统一任务

- Outcome：用户确认题量后得到可恢复的完整原创测试任务。
- Inputs：BR-SP-004/005，AC-SP-003/007/008/011/012，创建及状态契约。
- Scope：母卷生成适配器、source_paper任务来源、异步状态/去重、动态蓝图与原子保存。
- Non-goals：不改旧蓝图题数、不复现源题、不评分、不发布半成品。
- Acceptance：20/40子题及调整数量准确；完整材料、答案解析；超5分钟不误判；供应商/截断/失效来源失败无半成品；旧生成路径回归。
- Freedom：批次编排、内部校验及错误组织；不得暗减数量。
- Dependencies：T-SP-001。
- Risk：模型延迟、进程重启；有界执行、显式终态恢复。

### T-SP-003 模拟考试统一入口与确认交互

- Outcome：三个同级入口，模拟考试内母卷/奥数两模式，用户能核对结构、调整数量、看进度并进入任务。
- Inputs：US-SP-001～005，Gate 3全部设计，AC-SP-001/003/011～014。
- Scope：LearningAssistant、App路由、新母卷面板及API适配、生成锁定/5分钟解锁/刷新恢复。
- Non-goals：不改全站主题、不新增第四入口、不移除奥数能力。
- Acceptance：三视口无正文溢出；键盘可操作；切换模式不串响应；错误/空/忙碌完整；未知受理不重复创建。
- Freedom：小组件拆分、内部状态命名、局部布局；遵守现有token。
- Dependencies：T-SP-001/002。
- Risk：旧响应覆盖新学生/新来源；上下文身份与生命周期校验。

### T-SP-004 阅读材料、回顾、PDF及发布回归

- Outcome：网页/PDF和历史作答都保留必要材料，完成状态正确，更新可部署。
- Inputs：AC-SP-007/009/010/013/014，旧作答快照及生成资料删除契约。
- Scope：PaperExam、PaperPreview、AnswerReview、快照与PDF、新服务/API测试、浏览器验证和发布记录。
- Non-goals：不恢复得分/批改，不清理生产，不自动部署。
- Acceptance：新材料/选项/题号/答案一致，提交刷新已完成，旧卷兼容；前后端构建和相关回归通过；真实合成模型验收记录，GitNexus detect_changes后推送master并核对远端SHA。
- Freedom：测试组织、截图与证据路径、兼容可选字段实现。
- Dependencies：T-SP-002/003。
- Risk：旧快照无新增字段；仅加可选字段，不强制迁移或重写旧答案。

## 4. 风险

若发现与PRD不符，先按用户七类偏差分类并修订最早文档；仅代码bug直接修复。普通技术选型和实现内部冲突按既有栈最小方案处理，不新增范围。生产模型/资料发送与生产写入不包含在本地合成验收中。

### 4.1 2026-10-16 实施完成记录

T-SP-001 → T-SP-004 已依序实施并完成本地服务/API、131项后端回归、三视口与键盘、实际作答回顾、PDF检查和前后端构建。20/40题合成真实模型验证、发现的代码bug与修复、发布局限见[实施验收记录](../reports/2026-10-16-source-paper-practice-implementation-verification.md)。完整Linux镜像构建及部署后生产验收未执行；推送master不等于生产发布。
