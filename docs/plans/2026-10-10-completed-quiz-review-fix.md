# 已完成测验状态与作答回顾修复

## 1. 背景

生产只读验证确认：公顷和平方千米测验结果 `e7ce11c3-297f-4d81-84a5-a35511e2a09d` 为 submitted，学习状态 completed，却被列表接口作为 generationStatus=submitted 返回，前端据此显示“暂不可用”。对应思维训练任务因提交接口删除原测验而返回 task_target_missing。回顾接口二次转换快照，忽略 referenceAnswer，四题参考答案均为空，但题目、学生答案和解析仍在。

分类：7. 代码实现 bug。现有作答回顾 PRD 的历史规则、前端历史入口约定及 AC-AR-001 已明确提交后可查看完整回顾，应回到上述任务修复实现；本轮没有新增产品流程或生产数据迁移。

## 2. 目标

输入：当前学生任务、关联测验及 submitted/completed 作答记录。输出：已完成状态、可用回顾入口与完整逐题回顾。成功标准：历史链接可读，原始学生答案不变，参考答案不再因读取转换丢失，已完成记录不计入待学习。

## 3. 方案

### T-CQR-001 状态与历史入口

- Outcome：已提交的测验记录显示已完成；测验类任务读取现有结果确定已完成，并通过原任务地址进入回顾，兼容原测验已被旧接口删除的情况。
- Inputs：2026-08-04-answer-review-prd.md、frontend-design.md、AC-AR-001；现有 learning-tasks 与 quiz-results 接口。
- Scope：classroomTaskQueryService、ClassroomTaskHub、classroom 提交路由、服务/API 测试。
- Non-goals：不修改评分规则，不恢复已下线内容，不重建被删除的测验，不修改 ownerId 契约、播放规则或生产数据。
- Acceptance：submitted/completed 结果均 ready+completed，其他状态仍不可伪装成已完成；匹配结果必须属于当前学生和关联测验；原测验已删时原任务仍可读取回顾；新提交不删除原测验；同一作答被原任务/独立测验承接时不重复列出，历史详情地址仍有效；课件保留阅读入口、随堂作答另有回顾入口；无结果的未完成、失败和缺失目标仍按原语义处理。
- Freedom：允许局部只读聚合和链接投影，不要求回填任务表；使用既有题目详情页。
- Dependencies：无。

### T-CQR-002 快照读取与回归

- Outcome：历史和新提交均保留题目、学生答案、参考答案、解析与需巩固标记。
- Inputs：AC-AR-001、003、004、007；answer-review API 契约。
- Scope：answerReviewService、服务/API 测试、浏览器验证与本文件证据。
- Non-goals：不调用模型补答案，不复制或覆盖历史快照，不恢复分数或批改入口。
- Acceptance：referenceAnswer 原样恢复，旧 correctAnswer/answer 格式仍可读，重复读取不改变快照；提交→返回列表→已完成→回顾→刷新保留原答案；三视口、键盘可用；需巩固标记可读；未完成不可跳过提交伪装已完成。
- Freedom：字段兼容与本地夹具的内部实现自由，禁止通过展示伪造答案或无条件解锁。
- Dependencies：T-CQR-001。

UI/API 边界：generationStatus 只代表内容生成状态，learningStatus 代表学习进度；submitted 不作为生成状态。已完成可回顾记录使用“已完成 / 查看作答回顾”；题组列表按真实 completed 状态显示待学习与已完成数量，类别和学科导航保持。原任务映射到回顾仅在属于当前学生的有效提交结果存在时发生，不修改数据库链接。

### 验证与使用说明（2026-10-10）

| 检查 | 结果 |
| --- | --- |
| 修复前复现 | 新增测试在原代码上 4 项失败：submitted 未映射 ready、原任务未识别已完成、快照参考答案二次读取丢失。生产只读 API 同时确认原任务 410 与原测验 404。 |
| 服务/API 回归 | Node 22.23.3，6 个测试文件共 31/31 通过：classroomTaskQueryService、answerReviewService、learningTasksRoute、paperAttemptService、generatedLearningMaterialService、learningPackageService。 |
| 实际本地 API | Express + 隔离 SQLite：提交保留原测验，模拟旧记录删除原测验后原任务返回 200、已完成和回顾链接，历史详情可读、刷新回顾答案完整、跨学生读取返回 404。 |
| 兼容与保护 | 旧 correctAnswer/answer 与新 referenceAnswer 均可读；原作答 JSON/任务状态/持久化链接未被查询改写；既有需巩固标记仍可读；独立测验和课件随堂测验入口均回归通过。 |
| 浏览器 | 本地完整 App 与模拟 API，19 项断言通过；390/768/1440px 列表和回顾无横向溢出，键盘可打开回顾、刷新保留答案，已完成/待学习/失败按钮及计数正确，兼容旧 submitted 生成状态响应，无页面运行时错误。 |
| 构建 | 后端 tsc --noEmit 与前端 npm run build 通过；保留既有大包体积警告。 |

本地浏览器夹具和截图保存在 `output/playwright/completed-quiz-oct10-check.cjs` 与 `completed-quiz-{list|review}-{390|768|1440}.png`，不随发布。测试未使用生产写操作或模型调用。可在新 Playwright CLI 会话执行 `run-code --filename output/playwright/completed-quiz-oct10-check.cjs` 复验，需本地 Vite 监听 5183。

上线需同时发布前后端。进入智慧课堂 → 数学 → 其他，已提交的思维训练/测验可通过“查看作答回顾”进入；课件阅读入口继续保留，课件的随堂作答记录在历史回顾项中访问。无需数据补写、删除或重生成。本轮仅完成本地修改与验收，未部署生产。

## 4. 风险

- 快照字段转换由课堂提交、试卷作答和清理脚本共用，GitNexus 上游风险 MEDIUM；须验证新旧格式和试卷提交回归。课堂查询与路由上游风险 LOW。
- 原题确实没有保存参考答案时，继续显示缺失提示，不凭空推测。
- 不执行生产写入；发布后历史数据从原快照读取，无迁移。回滚为基线 9c1b290，仅回滚代码；新保留的原测验不得随回滚删除。
