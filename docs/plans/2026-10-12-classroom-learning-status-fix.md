# 智慧课堂完成状态修复

## 1. 背景

- 偏差分类：7. 代码实现 bug。既有任务技术契约允许从原实体进度查询计算 learningStatus，但课堂仅读取课堂测验结果，漏读听力与试卷的提交记录。
- 生产只读核查：听力包 `02c4b2a3-bcbc-4a92-a0ef-a76552ec7737` 有 submittedAt=1791683233979、6 次完成播放及 3 题答案快照，关联任务 `87797276-f007-4771-b2a3-ee8f9caaa18c` 却显示 not_started。child_2 读取该包返回 404。
- 历史学习包及试卷索引固定返回 not_started；生成资料另有状态算法；已交卷试卷的继续学习入口会创建新草稿。

## 2. 目标

- 新提交及历史完成内容在列表、详情和生成资料筛选中一致显示已完成，保留历史作答。
- 用户确认：课件提交关联随堂测验才完成，仅阅读/播放显示学习中。lastStudiedAt 不是完成证据。
- 听力提交、试卷交卷、课堂测验提交分别以原进度/作答记录为准。播放次数不等于完成测验。

## 3. 方案

沿用 React/Express/SQLite，不新增框架或迁移。数据流：原进度与作答记录 → 按 ownerId 查询的共享状态计算 → 智慧课堂/生成资料列表 → 原作答回顾。已完成考试主入口投影到既有 paper_attempt，原 task links 和答案快照不改写。

### S-001 状态与回顾投影

- Outcome：听力、模拟考试、随堂测验、错题测验、思维训练及其课件获得一致学习状态。
- Inputs：2026-07-28 learning-assistant technical-design；2026-08-06 generated-learning-materials api-contract；2026-08-05 english-listening api-contract；2026-08-04 answer-review acceptance-tests；本次课件完成规则。
- Scope：classroomTaskQueryService、generatedLearningMaterialService 及对应测试。
- Non-goals：修改历史内容、答案、评分、教材、生成流程；生产写入；重新生成历史三题听力。
- Acceptance：本人提交显示完成；其他学生进度不影响；未提交播放/草稿为学习中；历史与新任务一致；查询不改快照与任务链接；失败任务仍失败。
- Freedom：内部 SQL、辅助函数布局及测试夹具可自行决定。
- Dependencies：无。

### S-002 页面与回归

- Outcome：已完成内容可直接回顾，已完成课件仍可阅读并进入随堂作答回顾，阅读中的课件返回后显示学习中。
- Inputs：S-001 输出、既有课堂路由与作答回顾接口、本次确认规则。
- Scope：ClassroomTaskHub、StudentCoursewareReader、ClassroomLegacyDetail、classroomTaskApi、App 及本地 API/浏览器回归。
- Non-goals：新 UI 风格、自动批改、取消重做能力的其他入口、删除数据。
- Acceptance：听力直接打开包内原答案；考试打开已有 attempt 且不创建草稿；课件末页打开已有作答；刷新/返回维持完成；390/768/1440 视口无横向溢出；键盘可打开回顾；保存阅读进度失败提示且不阻断阅读。
- Freedom：沿用既有组件，可决定提示位置和内部状态组织。
- Dependencies：S-001。

## 4. 风险

- GitNexus MCP 索引缓存落后一提交、前端引用边缺失，影响报告为 UNKNOWN；用源码调用关系补查，不能把零调用当作无风险。detect_changes(all) 返回 CRITICAL（30 个符号、20 条流程），包括既有 AGENTS/CLAUDE 修改及旧索引行号偏移；源码 diff 复核确认业务修改仅涉及课堂投影、生成资料状态、阅读进度及回顾入口，matchesFilters/decodeCursor/作答快照写入函数未改动。通过针对这些路径的 API/浏览器回归降低发布风险。
- 旧纯课件没有关联测验引用时，不能按章节标题推断完成；保留学习中/待学习，避免误匹配其他任务。
- 阅读进度保存复用现有 mark-studied 接口，不将其作为完成证据。任务/生成资料读取共用算法，避免后续漂移。
- 上线无需数据迁移；部署后刷新列表即可重新计算历史状态。回滚代码即可恢复原展示，历史答案不被修改。

## 验证记录

- 前端 `npm run build`（TypeScript + Vite）通过；后端 `npm run build` 通过。Vite 保留既有大包体积提示，本次不做打包重构。
- 后端 `npm test`：111/111 通过，其中新增 6 个状态服务场景和 1 个真实本地 HTTP roundtrip 场景。真实接口写操作仅使用临时 SQLite 夹具，不调用外部模型、不写生产数据。
- API：播放→学习中→提交→完成；课件 mark-studied→学习中→随堂提交→完成；试卷草稿→交卷→已有 attempt 回顾。历史和新任务一致，跨学生读取拒绝，答案快照与作答记录数量不变。
- Playwright 新状态检查 25/25、已有完成测验回归 19/19：三视口（390/768/1440）、键盘打开回顾、刷新原答案、返回课堂即时状态、需巩固标记、失败任务重试、阅读进度保存失败不阻断、考试两种回顾地址返回课堂、不触发新草稿或批改接口。
- 浏览器使用受控 API 夹具，不能作为已部署到生产的证明。生产仅进行前述 GET 根因核查；本轮尚未推送或部署。
- 验收产物：`output/playwright/completed-learning-status-oct12-check.cjs`、`completed-status-list-{width}.png`、`completed-status-review-{width}.png`。
- 上线后验证：刷新生产智慧课堂，所述听力任务应显示已完成并直接打开原三题作答；抽查已交卷考试和已完成课件关联测验。不需要迁移、重生成或改写历史数据。
