# 学习小助手重构发布证据

日期：2026-07-28<br>
范围：T-010 学习内容详情与站内视频适配、T-011 集成验收与发布门禁<br>
结论：通过本地发布门禁，可进入人工发布流程。

## 1. 背景

本次验收覆盖学习小助手与智慧课堂之间的内容继续学习路径，并补充两项已确认的代码实现 bug：已失效视频未变为资源不可用、课堂任务缺少教材筛选。

## 2. 目标

以四年级数学教材和隔离测试数据验证任务详情、站内视频、安全嵌入、资源失效、旧地址下线、响应式布局与键盘操作；用后端回归覆盖听力、错题、课件、试卷、奥数、PDF 和诊断的领域契约。

## 3. 方案与证据

### 环境

- 隔离学生：`child_1`（大宝）。
- 教材：`义务教育教科书 数学四年级上册`，章节 `第一单元 大数的认识`。
- 视频：经审核、健康、适龄且允许嵌入的公开视频资源；验收后在隔离数据库改为 `blocked` 验证失效路径。
- 本地验证服务：前端 `127.0.0.1:5178`，后端 `127.0.0.1:3001`。未使用生产数据或用户正在使用的服务。

### 命令结果

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 前端类型检查与生产构建 | 通过 | `npm run build`，Vite 转换 2777 个模块并完成构建。 |
| 后端完整回归 | 通过 | `backend/npm test`：55 通过，0 失败。 |
| GitNexus 影响复核 | 已复核 | 刷新当前分支索引后执行 `detect_changes(scope=all)`；关键级影响仅覆盖预期的课堂查询、路由和内容详情调用链，已由本表的回归和浏览器证据覆盖。 |
| 视频任务详情 API | 通过 | `GET /api/learning-tasks/task-video-1?ownerId=child_1` 在健康时返回审核的 `embedUrl`。 |
| 视频失效 API | 通过 | 将隔离资源设为 `blocked` 后返回 `generationStatus=resource_unavailable`、`errorCode=resource_unavailable`、`videoResource=null`。 |
| 三视口人工与浏览器验收 | 通过 | 390x844、768x1024、1440x900 截图均已检查。 |
| 键盘筛选 | 通过 | `Tab` 到原生学科选择器时焦点 `outline=auto`；`ArrowDown` 选中“数学”且任务数保持为 1。 |

截图：

- 390px：[智慧课堂移动端](screenshots/learning-task-hub-390.png)
- 768px：[智慧课堂平板端](screenshots/learning-task-hub-768.png)
- 1440px：[智慧课堂桌面端](screenshots/learning-task-hub-1440.png)

### AC-001 至 AC-016

| 验收项 | 结果 | 可复核证据 |
| --- | --- | --- |
| AC-001 导航顺序与移除学习中心 | 通过 | 三视口快照均显示“我的看板、学习资料、学习小助手、智慧课堂”，无“学习中心”。 |
| AC-002 旧 `#learn/*` 下线 | 通过 | 浏览器访问 `#learn/legacy-example` 显示“页面已下线”和两个新入口；网络记录仅为用户、教材和扫描项读取，无旧内容接口。 |
| AC-003 错题学科与排除 | 通过 | `wrongReviewService.test.ts` 聚合来源测试与跨学科/跨学生拒绝测试通过。 |
| AC-004 多错题聚合任务 | 通过 | `reads and aggregates selected scanned and classroom wrong problems into one task` 通过。 |
| AC-005 教材章节必填 | 通过 | `textbookTaskService.test.ts` 的章节动作与任务创建测试通过。 |
| AC-006 合格视频与站内播放 | 通过 | 视频资源测试、`creates an embedded-video task only for a selected reviewed resource`、真实任务详情 iframe 验收通过；iframe 只使用后端 `embedUrl`。 |
| AC-007 英语听力两次播放 | 通过 | `persists at most two completed listening plays and submission` 与章节正文锚定测试通过。 |
| AC-008 奥数年级匹配 | 通过 | 匹配资料生成、不同年级拒绝、普通试卷独立生成测试通过。 |
| AC-009 多学科视频与模拟考试 | 通过 | 数学、语文视频资源契约与教材章节能力矩阵测试通过。 |
| AC-010 原创与风格边界 | 通过 | 试卷测试验证只使用章节正文和审核风格元数据，不暴露样卷全文；奥数测试只使用匹配资料元数据。 |
| AC-011 新任务与旧版本不可变 | 通过 | 幂等任务、不可变试卷版本、导出重试审计测试通过。 |
| AC-012 课堂归档与继续学习 | 通过 | 统一索引、课件归档、视频详情和课堂继续学习浏览器路径通过。 |
| AC-013 诊断、复核与改判 | 通过 | 评分过程证据、低置信复核、非破坏性改判审计、作答提交测试通过。 |
| AC-014 家庭档案上下文 | 通过 | `accepts ownerId only as a bounded local learning context` 与 shared 教材查询路径通过；界面未出现登录、角色或授权管理。 |
| AC-015 网页作答与 A4 | 通过 | 独立试卷/答案卷导出、中文与公式渲染、作答草稿和提交测试通过。 |
| AC-016 响应式与键盘 | 通过 | 三张截图无文本遮挡；键盘焦点和学科筛选键盘操作已实测。 |

### 视频详情安全验证

合格视频 iframe 实测属性：

```text
src=https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ
sandbox=allow-scripts allow-same-origin allow-presentation
allow=autoplay; encrypted-media; picture-in-picture
referrerPolicy=strict-origin-when-cross-origin
```

资源从 `healthy` 改为 `blocked` 后，详情显示“资源不可用”和“该视频资源已失效或不再允许嵌入”，不再渲染播放器。

## 4. 风险

- 构建通过但 `.env` 中的 `NODE_ENV=production` 会触发 Vite 警告；应从 `.env` 移除该值，改由部署环境注入，避免开发与构建语义混淆。
- 主前端产物约 1.59 MB（gzip 约 520 KB），Vite 提示超过默认阈值。当前不阻断发布，但应在后续性能任务中按页面拆分动态加载。
- 第三方视频的实际播放仍受源站嵌入策略和网络状态影响；健康检查持续是可用性的唯一准入条件。
- `ownerId` 是家庭学习档案上下文，不构成安全隔离边界；不得把当前模型用于多租户或不可信设备场景。

## 5. 回滚

1. 设置 `LEARNING_TASKS_ENABLED=false` 并重新部署后端，停止新任务创建与读取。
2. 隐藏学习小助手和智慧课堂入口，不删除 `learning_tasks`、链接、事件、试卷、作答或历史实体。
3. 保持 `#learn/*` 下线状态，不恢复学习中心或重定向旧地址。
4. 若只需撤回视频展示，先将目标 `external_resources.linkHealthStatus` 设为 `blocked`；既有任务应显示资源不可用而不替换来源。

## 6. FAQ

### 为什么资源失效仍保留课堂任务？

任务记录属于学习历史。删除或替换会造成已完成学习的证据丢失；显示资源不可用能说明原因，同时阻止播放不再合格的外链。

### 为什么没有把 ownerId 当作权限系统？

本产品是家庭单设备学习软件。当前 `ownerId` 仅用于选定学生档案和共享教材的查询范围；若扩展到多家庭或不可信终端，必须先回到技术设计补充真实认证与授权边界。
