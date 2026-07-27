# 教材驱动学习与测评：前端实现契约（Gate 3）

状态：已确认

## 1. 背景

现有前端采用 `App.tsx` Hash 路由和 `AIClassroom` 内部视图。新能力不能将资源、考试和结果继续堆进单一组件，否则状态恢复和移动端布局将不可维护。

## 2. 目标

以最小路由扩展增加学习中心，并将试卷编辑、考试、PDF 预览和诊断拆分为单一职责组件；不改变现有资源、课堂和历史深链。

## 3. 方案

### 3.1 路由与页面归属

| Hash 路由 | 页面组件 | 责任 |
| --- | --- | --- |
| `#learn` | `LearningHub` | 教材、章节、行动入口和最近任务。 |
| `#learn/package/:id` | `LearningPackage` | 听力、视频、复习大纲和学习完成状态。 |
| `#learn/assessment/new` | `AssessmentComposer` | 范围、难度、蓝图和生成。 |
| `#learn/paper/:id` | `PaperExam` | 网页考试、草稿与交卷。 |
| `#learn/paper/:id/print` | `PaperPreview` | A4 预览与 PDF 下载。 |
| `#learn/attempt/:id` | `AttemptDiagnosis` | 诊断、评分证据、复核和改判。 |

### 3.2 组件边界

| 组件 | 数据依赖 | 不负责 |
| --- | --- | --- |
| `BookChapterPicker` | `books`、`currentUser` | 生成任何内容。 |
| `LearningActionGrid` | 教材锚点、资源可用性 | 路由解析。 |
| `AssessmentBlueprintForm` | 蓝图草稿 | 提交作答。 |
| `PaperRenderer` | 结构化试卷、渲染模式 `web|print|answer` | 保存和批改。 |
| `AttemptAnswerForm` | 试卷、草稿 | 评分。 |
| `RubricBreakdown` | 诊断结果 | 修改分数。 |
| `ReviewDrawer` | 单题结果、权限 | 重新批改整张试卷。 |

### 3.3 状态与 API 边界

- 服务端保存学习包、试卷、作答、导出任务和批改状态；客户端只保留展示状态和未提交草稿。
- `currentUser.ownerId` 仅为单设备内的资料选择上下文：前端切换时重新筛选和请求对应数据，不得将其描述或实现为登录、权限控制或跨学生安全隔离。
- 作答草稿按 `paperAttemptId` 和 `ownerId` 保存，刷新后从服务端恢复；每 5 秒最多一次防抖保存，离开页面主动保存。
- 试卷生成、PDF 导出和主观题批改返回任务 ID；轮询仅在 `queued/running` 状态执行，终态停止，网络错误最多重试 3 次。
- `PaperRenderer` 使用相同结构化模型渲染网页与打印版，禁止由浏览器截图生成 PDF。
- 外链只由后端返回经过审核的 URL；前端不拼接搜索地址、不保存第三方 token。

### 3.4 响应式与无障碍

- 在 390px 宽度下，题号栏和分段难度控件可横向滚动但不能压缩文字；答题区最小高度 160px。
- 弹窗、抽屉和交卷确认必须锁定焦点、支持 Esc 关闭（交卷确认除外）并恢复触发点焦点。
- 下载、保存、批改、复核等异步结果使用 `aria-live="polite"`。

### 3.5 前端非目标

- 不引入 React Router、全局状态库或新的组件库。
- 不在浏览器做 LLM 阅卷、PDF 排版或第三方视频检索。

## 4. 风险

在 `AIClassroom` 继续增加学习中心会让 `ActiveView` 的联合类型和数据请求耦合扩大。新路由应复用现有 Layout 与用户上下文，但独立管理学习状态。

## 5. 回滚

新增 `#learn` 路由可独立移除；旧 `#dashboard`、`#resources/*`、`#tutor/*` 不改路径和行为。

## 6. FAQ

### 是否替换现有 QuizExam？

不在 MVP 直接替换。新 `PaperExam` 先服务结构化试卷；现有 `QuizExam` 保持章节测验兼容，后续再迁移。
