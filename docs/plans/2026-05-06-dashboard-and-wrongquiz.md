# 概述页重构 + 错题测验生成器

## 1. 背景

当前概述页（`components/Dashboard.tsx`）展示"今日收录 / 本周收录 / 最近7天趋势 / 最近学习 / 快捷入口"等静态运营指标，用户反馈这些信息**与学情判断无关**，希望页面以"待学习/待订正/待测验/掌握率变化"为核心。

同时识别到一个新功能缺口：**错题录入后无配套测验**，用户无法验证"是否真的会做了这道题"。需要在 AI 课堂体系内补齐"错题→讲解+测验"的闭环。

## 2. 目标

### 2.1 重构概述页

- 删除：今日收录、本周收录、最近 7 天趋势、最近学习、快捷入口、顶部假 "75%" 进度块
- 新增：基于真实学情数据的 4 张统计卡 + 掌握率趋势 + 3 张清单（待学课件/待订正错题/待完成测验）
- 清单点击需跳转到 AI 课堂对应 Tab + 选中条目

### 2.2 新增"错题测验生成器"

- 入口：智慧工坊（StudyRoom），与"教材→课件+测验"并列
- 操作流程：选学科 → 列出该学科**未生成过测验的错题单题** → 用户多选 → 提交生成
- 产物（每勾选错题）：① 1 条**错题讲解** `classroom_items(type='courseware')`；② 1 条**错题测验** `classroom_items(type='quiz')`，含 3 道同类型测验题
- 归属：AI 课堂新增第 4 个 Tab "错题测验"，独立列出 source='wrong_problem' 的条目

### 2.3 不做（KISS）

- 不做后端缓存（包括聚合接口）
- 不做错题测验自动批量生成（必须用户手动勾选）
- 不做按学段分组、不做多语言、不做学科枚举服务端校验
- 概述页不做 SSE/WebSocket 实时推送，单次页面加载拉一次

## 3. 方案

### 3.1 实施阶段（强依赖序列）

| 阶段 | 标题 | 依赖 | 工作量 |
|---|---|---|---|
| **B** | 课件"已学习"状态埋点 | 无 | 0.5 day |
| **C** | 错题测验生成器 + 错题 Tab | B | 2-3 day |
| **D** | AIClassroom 深链 hash 路由 | C | 0.5 day |
| **A** | 概述页重构 | B、C、D | 1 day |

每阶段**独立 PR、独立部署、独立验证**，避免大爆破。

---

### 3.2 阶段 B — 课件"已学习"状态

#### DB 改动

```sql
ALTER TABLE classroom_items ADD COLUMN lastStudiedAt INTEGER;  -- null=未学
```

#### 后端

```
POST /api/classroom/:id/mark-studied
  → UPDATE classroom_items SET lastStudiedAt = strftime('%s','now')*1000 WHERE id=?
  → 200 { success: true }
```

#### 前端埋点

`components/AIClassroom.tsx` 中 `CoursewareNarrator.fetchAndPlayChunk(idx=0)` 首次成功播放（onended 触发或 SpeechSynthesis 完成）后，调用一次 `/api/classroom/:id/mark-studied`，使用 `useRef` 防止重复调用。

#### 判定语义

- 任意一段（含 V3 火山 / Web Speech 任一通路）成功播放 = 已学
- 多次播放：覆盖 `lastStudiedAt`（KISS，累计需另开字段）

---

### 3.3 阶段 C — 错题测验生成器

#### DB 改动

```sql
-- classroom_items 加 source 与来源题目关联
ALTER TABLE classroom_items ADD COLUMN source TEXT DEFAULT 'manual';  -- 'manual' | 'wrong_problem'
ALTER TABLE classroom_items ADD COLUMN sourceProblemId TEXT;          -- scanned_items.id + problemIndex 拼接，用于过滤已生成

-- 关联表（避免污染主表 problemsJson）
CREATE TABLE IF NOT EXISTS wrong_problem_quiz_links (
  id TEXT PRIMARY KEY,                     -- uuid
  scannedItemId TEXT NOT NULL,             -- 错题扫描件 id
  problemIndex INTEGER NOT NULL,           -- problemsJson 数组下标
  ownerId TEXT NOT NULL,
  coursewareId TEXT NOT NULL,              -- 生成的讲解 classroom_items.id
  quizId TEXT NOT NULL,                    -- 生成的测验 classroom_items.id
  createdAt INTEGER NOT NULL,
  UNIQUE(scannedItemId, problemIndex, coursewareId)
);
CREATE INDEX IF NOT EXISTS idx_wpql_owner ON wrong_problem_quiz_links(ownerId);
CREATE INDEX IF NOT EXISTS idx_wpql_source ON wrong_problem_quiz_links(scannedItemId, problemIndex);
```

> 重复生成允许（每次新建 classroom_items + link），过滤"已生成"用 EXISTS 子查询，最新一次 link 视为"已覆盖"。

#### 后端新接口

| 接口 | 说明 |
|---|---|
| `GET /api/wrong-problems?subject=xxx&excludeGenerated=1` | 列出该学科错题单题（来自 scanned_items.problemsJson 展开），可选过滤已生成过测验的 |
| `POST /api/wrong-problem-quiz/generate` | body: `{ items: [{scannedItemId, problemIndex}] }` 串行 LLM 调用，每条生成讲解+测验，写 classroom_items + link，progress 通过响应分块（或简单一次返回最终结果）；返回 `{ generated: [{coursewareId, quizId}] }` |

#### LLM 调用

复用既有 `/api/generate-courseware`、`/api/generate-assessment` 的内部 service 函数：
- 讲解：以错题题干 + 答案 + 解析为输入，prompt 模板新增"错题讲解"专用段落（强调"为什么错"和知识点）
- 测验：3 道同类型题，prompt 强制题型一致

风险：单次提交 N 道 = 2N 次 LLM 调用。**前端前置提示用户**"将消耗 ≈ N 次模型调用，是否继续"，并限制单次最多勾选 10 道。

#### 前端

- StudyRoom 新增 "错题测验生成器" 入口 Card
- 选学科 → 列错题单题（题干前 50 字 + 学科 + 录入时间） → 多选 checkbox（≤10）→ "生成"按钮
- 生成中：进度条（基于已完成数 / 总数）；失败单题不阻塞其他
- AIClassroom 新增 Tab "错题测验"，列出 `source='wrong_problem'` 的 classroom_items（讲解 + 测验混合），UI 复用既有 list+article+exam

#### 边界

- 一道错题被勾选时本身不一定有"答案"字段；若 problemsJson 缺答案，**禁用该题勾选**并提示"原题缺解析无法生成"
- 生成失败：写入失败状态 link 记录还是不写？→ **不写 link**，下次仍可勾选

---

### 3.4 阶段 D — AIClassroom 深链 hash 路由

#### Hash 协议

```
#tutor                       → AIClassroom，Tab=courseware（向后兼容）
#tutor/courseware            → 课程学习 Tab
#tutor/courseware/:id        → 课程学习 Tab + 打开该课件
#tutor/quiz                  → 课程测验 Tab
#tutor/quiz/:id              → 课程测验 Tab + 打开该测验
#tutor/wrong                 → 错题测验 Tab
#tutor/wrong/:id             → 错题测验 Tab + 打开该条目
#tutor/history               → 测验记录 Tab
#tutor/history/:id           → 测验记录 Tab + 打开结果详情
```

#### App.tsx 改动

`getTabFromHash` 解析 `#tutor` 前缀部分作 activeTab，剩余路径作 `subPath` 通过 props 传入 AIClassroom。

#### AIClassroom.tsx 改动

监听 props.subPath 变化，初始化时设置 activeTab + 自动调用 `loadList` 后定位到 :id 项并模拟点击进入 view。

---

### 3.5 阶段 A — 概述页重构

#### 删除

`components/Dashboard.tsx` 整体重写（不是局部 edit），保留欢迎条。

#### 新增聚合接口

```
GET /api/dashboard/overview?ownerId=xxx
返回：
{
  stats: {
    pendingCoursewareCount,
    pendingWrongProblemCount,
    pendingQuizCount,
    masteryRate
  },
  trendBySubject: { 语文: [{quizId, gradedAt, percentage}], 数学: [...], 英语: [...], 科学: [...] },
  pendingCourseware: [{id, bookTitle, chapter, subject, createdAt}, ...TOP5],
  pendingWrongProblems: [{scannedItemId, problemIndex, snippet, subject, timestamp}, ...TOP5],
  pendingQuizzes: [{id, bookTitle, chapter, subject, questionCount, createdAt}, ...TOP5]
}
```

每查询用单条 SQL（带 LIMIT 5），整接口 5-7 条 SQL，单次响应即可。

#### 前端

```
┌──────────────────────────────────────────┐
│ 早安，xxx！  日期                          │
├──────────────────────────────────────────┤
│ [待学课件] [待订正错题] [待完成测验] [掌握率]   │
├──────────────────────────────────────────┤
│ 📈 掌握率趋势（语/数/英/科 最近10次）          │
├──────────────────────────────────────────┤
│ 📚 待学习课件 · TOP 5  → #tutor/courseware/:id │
├──────────────────────────────────────────┤
│ ❌ 待订正/复习错题 · TOP 5 → #tutor/wrong       │
├──────────────────────────────────────────┤
│ 📝 待完成测验 · TOP 5  → #tutor/quiz/:id        │
└──────────────────────────────────────────┘
```

空态：单条 CTA "去图书馆上传第一本教材"。

## 4. 风险

| # | 风险 | 缓解 |
|---|---|---|
| R1 | LLM 生成"同类型题"质量受 OCR 准确度影响 | 前端勾选时显示原题预览；生成后 Tab 内提供"重新生成单题"按钮（暂不实现，挂在 v2） |
| R2 | 单次提交多道错题撞 LLM RPM 限速 | 后端串行调用 + 限单次 ≤ 10 道；进度条反馈 |
| R3 | Hash 深链与浏览器 popstate 同步可能漏 | useEffect 监听 hash 变更同步内部 view；测试覆盖前进/后退 |
| R4 | `wrong_problem_quiz_links` 关联表反范式还是范式：classroom_items 内已有 source/sourceProblemId | 同时保留：source/sourceProblemId 用于聚合查询，link 表用于"已生成过滤"和未来扩展（多次生成历史） |
| R5 | 概述页 6-8 个 SQL 在错题/测验数据多时变慢 | LIMIT 5 + 索引；监控；不做缓存 |
| R6 | 移除"快捷入口"后新用户首次进入空空如也 | 空态 CTA |
| R7 | 旧 hash `#tutor` 直接进入 | 协议向后兼容，等价 `#tutor/courseware` |
| R8 | 错题原题缺答案/解析时无法生成讲解 | 前端禁用勾选并提示 |

## 5. 回滚

每阶段独立 commit + revert：

| 阶段 | 回滚操作 |
|---|---|
| B | revert commit；DB 字段保留（NULL 兼容） |
| C | revert commit；删除新表（数据保留无副作用） |
| D | revert commit；hash 协议自动 fallback 到 `#tutor` |
| A | revert commit 即恢复旧 Dashboard.tsx |

DB ALTER ADD COLUMN 在 SQLite 不可逆但**新增可空字段对旧代码透明**，无需回滚 schema。

## 6. FAQ

**Q：为什么 B 必须先做？**
A：A 阶段"待学课件数"统计依赖 `lastStudiedAt`。B 不做，A 这张卡片永远显示全量课件。

**Q：为什么不直接把错题测验放进"课程测验"Tab？**
A：用户明确要求新增 Tab 区分。这种学习/复习语义差异显著（错题测验是巩固，课程测验是阶段考核），合并会让 quiz_results 历史混乱。

**Q：为什么概述页不做缓存？**
A：用户量小（个人开发者级），单查询 < 50ms 即可，缓存反而引入失效逻辑复杂度（错题录入/测验完成都要 invalidate）。出现性能问题再加。

**Q：错题测验生成器为什么放 StudyRoom 而不是 AIClassroom？**
A：AIClassroom 是"消费"层，StudyRoom 是"生产"层，与"教材→课件+测验"流程对称。

## 7. 任务清单（与 Task tracker 同步）

| # | Phase | Task | Status |
|---|---|---|---|
| B1 | B | DB migration: classroom_items.lastStudiedAt | `[ ]` |
| B2 | B | POST /api/classroom/:id/mark-studied | `[ ]` |
| B3 | B | CoursewareNarrator 首段播放埋点 | `[ ]` |
| B4 | B | 部署 + 验证（手工触发连播 → 查 DB lastStudiedAt） | `[ ]` |
| C1 | C | DB: classroom_items 加 source/sourceProblemId；新建 wrong_problem_quiz_links | `[ ]` |
| C2 | C | GET /api/wrong-problems | `[ ]` |
| C3 | C | POST /api/wrong-problem-quiz/generate | `[ ]` |
| C4 | C | StudyRoom 错题测验生成器 UI | `[ ]` |
| C5 | C | AIClassroom 新增"错题测验"Tab | `[ ]` |
| C6 | C | 部署 + 验证（生成 → Tab 列出 → 答题归档） | `[ ]` |
| D1 | D | App.tsx hash 协议扩展 | `[ ]` |
| D2 | D | AIClassroom 消费 subPath | `[ ]` |
| D3 | D | 部署 + 验证（前进后退 / 直接复制链接打开） | `[ ]` |
| A1 | A | GET /api/dashboard/overview | `[ ]` |
| A2 | A | Dashboard.tsx 重写（删旧+加新） | `[ ]` |
| A3 | A | 部署 + 验证（4 张卡 + 趋势 + 3 清单） | `[ ]` |

## 8. 优先级

中。当前主流程（图书馆/AI课堂/拍题录入）仍可用；本计划属"信息架构升级 + 错题闭环补齐"，建议按 B → C → D → A 顺序在接下来 1-2 周内逐步上线。
