# 智慧工坊 错题三步骤生成器 + 章节单选 + AI课堂课件/测验合并

> 上位计划：`docs/plans/2026-05-06-dashboard-and-wrongquiz.md`（阶段 C 已完成版本）
> 本文为该计划在用户实操后提出的二轮优化方案。

## 1. 背景

阶段 C 已上线"错题→讲解+测验"一次性生成器（`WrongProblemQuizGenerator.tsx` + `/api/wrong-problem-quiz/generate`），用户实操后反馈以下问题：

| # | 现象 | 影响 |
|---|---|---|
| P1 | 错题列表只显示 50 字 snippet，无法判断要不要选 | 选错题时盲选，命中率低 |
| P2 | 一次提交即同时生成"讲解+测验"且无预览，质量不满意只能整体重做 | 模型调用浪费、用户挫败感 |
| P3 | 智慧工坊章节多选（最多 3）但教学侧消费场景从来都是"一节一节学"，导致同一卡片跨章节，难定位 | AI 课堂"课程学习"中找不到具体某章的内容 |
| P4 | "课程学习"和"课程测验"两个 Tab 把同一章节的课件与配套测验拆开摆放，复习路径割裂 | 学完即测的闭环断 |
| P5 | "第一步：选择学习内容"措辞冗长 | 信息密度低 |

## 2. 目标

### 2.1 错题生成器三步骤

```
[Step 1 选择错题]  多选错题 + 每条可"查看详情" → 确认选择
        ↓
[Step 2 错题讲解]  生成预览 → 不满意可整体重新生成 → 保存（入 AI 课堂）→ 自动进 Step 3
        ↓
[Step 3 错题测验]  生成预览 → 不满意可整体重新生成 → 保存（入 AI 课堂）→ 完成
```

- 多选保留（≤10）
- "查看详情"展示与 `KnowledgeHub` 错题详情视图等价的结构（题目/学生作答/标准答案/老师批注/订正/知识点）
- 生成中**全屏遮罩**禁用所有操作

### 2.2 章节单选 + AI 课堂合并

- 智慧工坊"教材→课件+测验"流程改为**单章节**生成
- AI 课堂删除"课程测验" Tab，**课程学习** Tab 内按章节分组卡片，每张卡片同时挂"看课件"和"做测验"两个入口
- 旧 hash `#tutor/quiz/:id` 兼容重定向到课程学习 Tab 并定位条目
- 错题相关 Tab、测验记录 Tab 保持不动

### 2.3 文案

- `第一步：选择学习内容` → `章节选择`

### 2.4 不做（KISS）

- 不做"逐题独立重新生成"：**整批重新生成**即可（与"重新生成"语义对齐，避免状态机复杂化）
- 不做讲解-测验"草稿持久化"：用户离开页面即丢弃未保存的预览（再生成成本可控）
- 不做"已生成的章节课件计数"展示
- 不做后端的"覆盖式重生成"——保存即新增 classroom_items 记录，旧记录由用户在 AI 课堂内删除（已有删除入口）

## 3. 方案

### 3.1 实施分组（独立 PR / 独立验证）

| 组 | 内容 | 改动面 | 工作量 |
|---|---|---|---|
| **G1** | 文案修改 + 章节单选 | `StudyRoom.tsx`、`ChapterSelector.tsx` | 0.2 day |
| **G2** | AI 课堂"课程测验" Tab 合并到"课程学习" | `AIClassroom.tsx`、`App.tsx` hash 兼容 | 0.5 day |
| **G3** | 错题三步骤前端 + 后端接口拆分 | `WrongProblemQuizGenerator.tsx` 重写、`backend/routes/wrongProblems.ts` 拆 4 个端点 | 1.5 day |

**强依赖序列**：G1 → G2 → G3。G3 不依赖 G1/G2，理论可并行，但单人开发推荐串行避免冲突。

---

### 3.2 G1 — 文案 + 章节单选

#### G1.1 文案

`components/StudyRoom.tsx:188`：
```diff
- 第一步：选择学习内容
+ 章节选择
```

下方副标题同步：
```diff
- 从图书馆中选择一本教材并勾选 1–3 个章节，AI 将覆盖每个章节的知识点生成课件与测验
+ 从图书馆中选择一本教材并指定 1 个章节，AI 将围绕该章节生成课件与配套测验
```

步骤按钮 `选择章节` → 保留（已对齐）。

#### G1.2 单选

`StudyRoom.tsx`：
- `selectedChapters: ChapterNode[]` → `selectedChapter: ChapterNode | null`
- 调用处 `ChapterSelector maxChapters={1}` 即可让既有多选 UI 退化为单选（已实现"超出限制不再追加"）

进一步：`ChapterSelector` 增加 `mode?: 'single' | 'multi'` 仅作为 UI 微调（单选时 checkbox → radio，"已选 X/1"折成"已选"），但**逻辑层不重写**——保持 `onConfirm(book, chapters[])` 原 API 兼容。

`CoursewareGenerator` / `QuizGenerator` 入参类型保持 `selectedChapters: ChapterNode[]`，调用方传 `[selectedChapter]`，**避免下游改动**。

#### G1.3 行为保持

- 已存在的多章节课件/测验记录在 AI 课堂正常展示（chapter 字段是字符串 join，不解析）
- 后端无改动

---

### 3.3 G2 — AI 课堂合并课程学习/测验

#### G2.1 Tab 改动

`components/AIClassroom.tsx`：

```ts
// 旧
type ActiveTab = 'courseware' | 'quiz' | 'wrong' | 'history';
// 新
type ActiveTab = 'courseware' | 'wrong' | 'history';
```

- 删除 Tab 渲染中"课程测验"项（`AIClassroom.tsx:766`）
- `quizList` state、`loadList('quiz')` 调用**保留**——课程学习 Tab 仍要消费它进行分组渲染
- `cwSubject/quizSubject/wrongSubject` 三套学科筛选合并为 `cwSubject` 一套（错题/历史保留）

#### G2.2 课程学习 Tab 渲染：按章节分组平铺

数据结构：
```ts
type ChapterGroup = {
  key: string;                  // bookTitle + '||' + chapter
  bookTitle: string;
  chapter: string;
  subject: string;
  courseware?: ClassroomListItem;   // 同一章节理论上 1 条；多条取最新
  quiz?: ClassroomListItem;
  latestAt: number;
};

function groupByChapter(cw: ClassroomListItem[], qz: ClassroomListItem[]): ChapterGroup[]
```

UI（每张卡片）：
```
┌──────────────────────────────────────────────┐
│ 《人教版三年级语文上册》  · 语文              │
│ 第 5 课 · 铺满金色巴掌的水泥道                │
│ ─────────────────────────────────────────── │
│  [课件 8 节]    [测验 5 题]                  │
│  📘 看课件      📝 做测验                    │
└──────────────────────────────────────────────┘
```

- 仅有课件无测验：测验按钮显示"未生成"灰态
- 仅有测验无课件：同理（旧数据兼容）
- 排序：`latestAt` 倒序

#### G2.3 Hash 路由兼容

`App.tsx` 的 `getTabFromHash` 已支持 `#tutor/quiz/:id`：
- `subPath` 形如 `quiz/abc-123` 时，`AIClassroom` 内部仍能消费
- 改动：在 `AIClassroom.tsx` 的 `SUBPATH_TABS`：
```ts
const SUBPATH_TABS: Record<string, ActiveTab> = {
  courseware: 'courseware',
  quiz: 'courseware',         // 旧链接重定向到合并 Tab
  wrong: 'wrong',
  history: 'history',
};
```
- 并在打开条目逻辑里同时在 `coursewareList` 和 `quizList` 中查找 id 匹配项

#### G2.4 删除"课程测验" Tab 的影响清单

| 模块 | 改动 |
|---|---|
| `Dashboard.tsx` "待完成测验"清单跳转 `#tutor/quiz/:id` | 自动重定向到课程学习 Tab + 定位测验项，OK |
| `AIClassroom.tsx` 渲染逻辑 `activeTab === 'quiz'` | 删除分支或并入 'courseware' |
| 删除条目 `loadList('quiz')` | 保留（用于分组数据源） |
| 测验答题完成后跳回 | `loadList('quiz') + loadHistory()` 行为保持 |

---

### 3.4 G3 — 错题三步骤

#### G3.1 后端接口拆分

| 方法 | 路径 | 入参 | 输出 | 副作用 |
|---|---|---|---|---|
| POST | `/api/wrong-problem-quiz/generate-courseware` | `{ ownerId, items: [{scannedItemId, problemIndex}] }` | `{ generated: [{scannedItemId, problemIndex, slides[]}], failed: [...] }` | 仅 LLM 调用，**不落库** |
| POST | `/api/wrong-problem-quiz/save-courseware` | `{ ownerId, userName, items: [{scannedItemId, problemIndex, slides[]}] }` | `{ saved: [{scannedItemId, problemIndex, coursewareId}] }` | INSERT classroom_items(type=courseware,source=wrong_problem)。**不写 link 表** |
| POST | `/api/wrong-problem-quiz/generate-quiz` | `{ ownerId, items: [{scannedItemId, problemIndex}] }` | `{ generated: [{scannedItemId, problemIndex, questions[]}], failed: [...] }` | 仅 LLM，不落库 |
| POST | `/api/wrong-problem-quiz/save-quiz` | `{ ownerId, userName, items: [{scannedItemId, problemIndex, coursewareId, questions[]}] }` | `{ saved: [{scannedItemId, problemIndex, quizId}] }` | 事务 INSERT classroom_items(type=quiz) + wrong_problem_quiz_links(coursewareId, quizId, ...) |

**旧接口** `/api/wrong-problem-quiz/generate` 保留 1 个版本周期，标记 deprecated（前端不再调用），降低回滚成本。下个迭代删除。

**为什么 link 表写在 save-quiz 而非 save-courseware？**
> link 表语义是"该错题已生成完整的讲解+测验对"，用于"已生成"过滤。仅有讲解算未完成。若用户停在 step 2 关闭页面，该条错题下次仍可被勾选生成。

#### G3.2 LLM Prompt 复用

讲解 prompt 与现有 `wrongProblems.ts:155-176` 一致；测验 prompt 与 `:193-213` 一致。**仅把 try{} 块拆成两个独立函数** `generateCoursewareSlides(item)` / `generateQuizQuestions(item)`，被新旧接口共享调用。

#### G3.3 前端三步骤状态机

```ts
type WPStep = 'select' | 'courseware' | 'quiz';

interface DraftCourseware {
  scannedItemId: string;
  problemIndex: number;
  slides: Slide[];
}
interface DraftQuiz {
  scannedItemId: string;
  problemIndex: number;
  coursewareId: string;
  questions: Question[];
}

const [step, setStep] = useState<WPStep>('select');
const [picks, setPicks] = useState<WrongProblemItem[]>([]);
const [drafts, setDrafts] = useState<DraftCourseware[]>([]);    // step 2 预览
const [savedCwIds, setSavedCwIds] = useState<Map<string, string>>();  // key→coursewareId
const [quizDrafts, setQuizDrafts] = useState<DraftQuiz[]>([]);  // step 3 预览
const [busy, setBusy] = useState<null | 'gen-cw' | 'save-cw' | 'gen-qz' | 'save-qz'>(null);
```

流程：
```
[select]    勾选 → 点"确认选择"  → setPicks → setStep('courseware') → busy='gen-cw' →
            POST /generate-courseware → setDrafts → busy=null
[courseware] 用户预览所有 drafts；
             点"重新生成" → busy='gen-cw' → POST /generate-courseware → setDrafts → busy=null
             点"保存"     → busy='save-cw' → POST /save-courseware → setSavedCwIds →
                          setStep('quiz') → busy='gen-qz' → POST /generate-quiz → setQuizDrafts → busy=null
[quiz]       点"重新生成" → busy='gen-qz' → POST /generate-quiz → setQuizDrafts → busy=null
             点"保存"     → busy='save-qz' → POST /save-quiz → 完成提示 → 重置回 select
```

**全屏遮罩**：当 `busy !== null` 时渲染：
```tsx
<div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center pointer-events-auto">
  <Card>
    <Loader2 className="animate-spin" /> {labelOf(busy)}
  </Card>
</div>
```

#### G3.4 错题详情查看

- 列表条目右侧加 `查看详情` 按钮（区别于多选 checkbox 的点击区）
- 点击弹 `<Modal>` 渲染该 problem 的：
  - `content`（ReactMarkdown，复用 `KnowledgeHub.tsx:262-271` 样式）
  - 学生作答 / 标准答案（红绿底色块）
  - 老师批注 / 订正（amber/indigo 底色块）
  - 知识点 Badges
- 数据来源：列表 API 已返回 `content/standardAnswer/explanation/knowledgePoints`；新增字段 `studentAnswer/teacherComment/correction` 需在 `/api/wrong-problems` 返回中补齐：
```ts
items.push({
  ...,
  studentAnswer: p.studentAnswer || '',
  teacherComment: p.teacherComment || '',
  correction: p.correction || '',
});
```

#### G3.5 预览渲染

讲解预览：复用 AIClassroom `SectionCard`（导出该组件，或在新文件复制一份精简版——倾向**复制**，避免循环依赖）。
测验预览：题目-选项-标答-解析的卡片列表，复用 `QuizExam` 的非答题模式（如不便复用则新建 `<QuizPreview>`）。

#### G3.6 边界

| 场景 | 处理 |
|---|---|
| 单条错题讲解生成失败 | `failed[]` 中列出，预览页显示"失败重试"按钮（仅重新调一次该条），其余正常预览 |
| 全部失败 | 报错，回到 select 步 |
| step 2 保存时部分讲解保存失败 | 已成功保存的 coursewareId 留存；失败的从 picks 剔除并提示，仅成功项进 step 3 |
| 用户在 busy 中切 Tab/关页面 | 不阻止；后端 LLM 调用浪费但无脏数据（未保存即不落库） |

---

## 4. 风险

| # | 风险 | 缓解 |
|---|---|---|
| R1 | step 2 保存讲解后用户关页导致"孤儿讲解"（无配套测验） | classroom_items 内独立 courseware 仍可在错题相关 Tab 看到；不影响功能；下次该错题仍可被勾选（link 未写）→ 多次生成时会产生重复 courseware，由用户手动删除。**接受**。 |
| R2 | LLM 重新生成 N 次 = N×K 次调用，超 RPM | 前端按钮 disable 期间禁止重复点击；保留单次最多 10 道；遮罩期不可操作 |
| R3 | 删除"课程测验" Tab 后旧 Dashboard 链接断 | hash 路由 `quiz/:id` 重定向到 courseware Tab + 定位 |
| R4 | ChapterSelector 同时被多处调用，单选改动可能波及其他场景 | 保持 API 兼容（`maxChapters=1` 即单选），不改 onConfirm 签名；grep 调用方仅 StudyRoom 一处 |
| R5 | AI 课堂分组渲染对 chapter 字符串完全相等敏感（多空格/全半角） | 渲染前 `chapter.trim().normalize('NFKC')`；不做激进归一化 |
| R6 | 旧接口 `/generate` 保留期内若被前端误调，多写一份重复数据 | 接口内日志警告 deprecated；下个迭代删除 |
| R7 | 错题详情字段在旧 scanned_items 数据中可能缺失（studentAnswer 等） | 渲染时全部空值兜底"(暂无)"，与 KnowledgeHub 行为一致 |

## 5. 回滚

每组独立 commit：

| 组 | 回滚操作 |
|---|---|
| G1 | revert commit 即可；DB 无改动 |
| G2 | revert commit；hash 协议向后兼容（`quiz/:id` 路由由 AIClassroom 解析，恢复后自动找回旧 Tab） |
| G3 | revert 前端 commit 即恢复旧 WrongProblemQuizGenerator；后端新增 4 接口保留无副作用，旧 `/generate` 仍可用 |

DB schema 无改动（沿用 `classroom_items` 既有字段 + `wrong_problem_quiz_links` 既有结构）。

## 6. FAQ

**Q：为什么不让用户每条错题独立重新生成？**
A：状态机复杂度↑（每条独立 draft + busy 状态），UI 噪声大；用户实际诉求是"这一批 AI 写得不行"——批量重生成解决 90% 场景。挂 v2。

**Q：为什么 save-courseware 不写 link 表？**
A：link 表用于"已生成过滤"——若仅写讲解就标已生成，下次错题列表会被错误过滤。等量挂在 save-quiz 完成后写入，语义干净。

**Q：为什么不在 step 2 → step 3 切换时缓存讲解 draft 到本地？**
A：保存才入库；离开即丢弃是显式行为，避免"以为保存了实际没保存"的认知陷阱。重新生成成本可控（几秒一题）。

**Q：章节单选后，老用户多选生成的旧课件怎么办？**
A：不动。AI 课堂内 `chapter` 字段原样展示（如"第3章+第5章"），分组卡片归在该字符串下，不与新单章节卡片混淆。

**Q：合并课程学习/测验 Tab 是否破坏既有的"看完课立即测"流程？**
A：不破坏，反而强化。合并卡片把两个入口并置，复习路径更短。

## 7. 任务清单

| # | 组 | 任务 | 状态 |
|---|---|---|---|
| 1 | G1 | StudyRoom 文案+章节单选（maxChapters=1） | `[ ]` |
| 2 | G1 | ChapterSelector 单选 UI 微调（可选） | `[ ]` |
| 3 | G2 | AIClassroom 删除"课程测验" Tab + 课程学习按章节分组 | `[ ]` |
| 4 | G2 | hash 路由 `quiz/:id` 重定向兼容 | `[ ]` |
| 5 | G3 | 后端 4 接口拆分（generate-courseware / save-courseware / generate-quiz / save-quiz） | `[ ]` |
| 6 | G3 | `/api/wrong-problems` 返回字段补齐 studentAnswer/teacherComment/correction | `[ ]` |
| 7 | G3 | 前端三步骤状态机 + 全屏遮罩 | `[ ]` |
| 8 | G3 | 错题"查看详情"弹窗 | `[ ]` |
| 9 | G3 | 讲解 / 测验 预览组件 | `[ ]` |
| 10 | 全 | 部署 + 回归验证（教材路径 + 错题路径） | `[ ]` |

## 8. 上线注意事项

- 数据库迁移：**无**
- 部署顺序：先后端（4 个新接口），再前端，最后 deprecation 旧 `/generate`
- 验证项见任务 #10：单选生成课件/测验 → AI 课堂课程学习卡片正确分组 → 错题三步骤完整跑通
- 监控：观察 LLM 调用计数，若用户频繁"重新生成"需要在 v2 加节流提示
