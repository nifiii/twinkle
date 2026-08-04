# 作答回顾与需巩固标记：任务分解（Gate 5）

状态：已确认（2026-08-04）

## 1. 背景

将自动批改和成绩改为无评分的作答回顾，并将课堂错题来源改为主动“需巩固”标记。

## 2. 目标

交付不依赖模型、可即时回顾、可主动进入错题本，且可审计删除历史评分数据的完整学习流程。

## 3. 方案

### T-AR-001 作答回顾领域契约与无评分提交

Outcome：课堂测验和试卷提交同步保存可回顾快照，不再调用评分服务或模型。

Inputs：BR-AR-001 至 BR-AR-003；US-AR-001；AC-AR-001、AC-AR-002、AC-AR-008；API 契约的提交/读取部分。

Scope：`paperAttempts`、课堂测验提交路由、回顾查询服务、数据库初始化及对应测试。

Non-goals：不改题目生成、教材、上传 OCR 或教师批注。

Acceptance：选择/填空/解答题提交后立即有四段回顾数据；模型服务不可用时仍通过；评分字段不写入或返回。

Freedom：可选回顾快照表或兼容字段组织，但必须保持 ownerId、题目快照和答案原子一致。

Dependencies：无。

### T-AR-002 需巩固标记与统一错题本来源

Outcome：学生/家长主动标记题目后，该题作为课堂作答错题进入统一错题本、错题讲解与专项测验；取消后退出。

Inputs：BR-AR-004、BR-AR-005；US-AR-002、US-AR-004；AC-AR-003、AC-AR-004；需巩固 API 契约。

Scope：需巩固存储/路由、`unifiedWrongBookService`、`wrongReviewService` 及测试。

Non-goals：不写 `scanned_items`、不自动判错、不修改教师批注错题。

Acceptance：标记与取消均具备 ownerId 校验、幂等性和统一错题本可见性验证。

Freedom：可选择表结构、索引及来源快照 JSON 组织。

Dependencies：T-AR-001。

### T-AR-003 作答回顾页面与看板移除成绩

Outcome：提交后的新旧详情都以作答回顾显示，且我的看板无评分卡片和趋势。

Inputs：BR-AR-002、BR-AR-003、BR-AR-008；US-AR-001 至 US-AR-003；AC-AR-007；Gate 3 设计。

Scope：测验作答组件、课堂任务详情、试卷详情、历史列表、看板及直接前端测试。

Non-goals：不改变学习资料整体视觉语言或增加新的顶级入口。

Acceptance：三视口/键盘验证；页面不存在评分文本、对错图标、改判或批改轮询；标记失败可重试。

Freedom：可复用一个回顾组件或按现有边界组合，但不允许前端推导对错。

Dependencies：T-AR-001、T-AR-002。

### T-AR-004 历史评分数据受控清理与退役 API

Outcome：可先 dry-run 后 apply 删除历史评分专属数据，历史可回顾内容保留，评分 API 稳定退役。

Inputs：BR-AR-006、BR-AR-007；US-AR-003、US-AR-005；AC-AR-005、AC-AR-006；技术设计 3.3。

Scope：专属 CLI、数据库迁移/测试、退役端点、运维说明。

Non-goals：不执行生产 apply；不删除教材、上传试卷、教师批注、源文件或题库。

Acceptance：manifest/备份/保留集验证通过；apply 后评分字段和表记录不可读，历史作答回顾和上传资料哈希仍可验证。

Freedom：可选择 CLI 名称、manifest 字段与备份目录，但必须默认 dry-run、显式 `--apply`、manifest 一致性和事务边界。

Dependencies：T-AR-001、T-AR-002。

### T-AR-005 发布前回归与生产执行手册

Outcome：发布包提供接口、构建、浏览器和清理 dry-run 证据；生产 apply 条件可操作。

Inputs：T-AR-001 至 T-AR-004；全部 AC-AR；Gate 4 清理规则。

Scope：测试、Playwright 证据、运行手册和发布说明。

Non-goals：不执行生产数据库写入或部署。

Acceptance：后端测试、构建、三视口浏览器流程、无模型提交断言、评分数据 dry-run 和保留资料校验通过。

Freedom：可选择夹具、截图名称和运行手册排版。

Dependencies：T-AR-001、T-AR-002、T-AR-003、T-AR-004。

## 4. 风险

- T-AR-004 是不可逆数据清理，生产仅在 T-AR-005 证据、人工审核 manifest 和单次授权后执行。
