# UI 重组方案 v2 — 轻量赛博 · 三 Tab 收敛

> 版本：v2 · 日期：2026-05-07 · 状态：**待用户最终确认后实施**
>
> 本文档遵循 CLAUDE.md §5.2 文档结构（背景 / 目标 / 方案 / 风险 / 回滚 / FAQ），以及 §12 工程纪律（KISS、根因优先、现有功能保护）。

---

## 1. 背景

### 1.1 v1 重构失败回顾
v1 方案（迭代 0–4，已 rollback 到 `v1.9.0-ia-redesign-proposal`）失败的核心原因：

- **跑得太快**：未与用户逐页对齐细节就开始改 IA，导致"几个主要功能没实现，有些功能页面错乱"
- **任务粒度过粗**：一个迭代覆盖多个组件，难以独立验收
- **页面映射不明确**：未事先约定"嵌入既有组件 + props"的边界，导致部分功能丢失

### 1.2 当前状态
- 代码库回退至 `v1.9.0`，5 项导航：`概览 / 图书馆 / 拍题 / AI 课堂 / 智慧工坊`
- 所有功能模块独立可用、相互未耦合
- Tailwind 已具备 `neon-blue (#00d4ff)`、`neon-purple (#a855f7)`、`shadow-glow` 等基础 token

---

## 2. 目标

### 2.1 信息架构目标
将 5 项顶层 Tab 收敛为 **3 项**，更贴合家长 / 孩子两类用户的使用动线：

| 顶层 Tab | 主要使用者 | 包含的子页面 |
|---|---|---|
| **概览** | 家长 / 孩子 | （无子页，原 Dashboard） |
| **xx 的学习资料** | 家长 | 我的书架 / 错题作业本 / 课堂小助手 |
| **AI 课堂** | 孩子 | （无子页，原 AIClassroom，三个内部 Tab 不变） |

### 2.2 视觉目标
**轻量赛博**风格：

- 背景：深藏青 → 青紫渐变（`#0a1628` → `#1a1145`）
- 强调色：`#00D4FF`（霓虹青，已有 `neon-blue`）+ `#FFD66B`（暖黄，新增 `neon-amber`）
- 卡片：玻璃拟态（半透明 + backdrop-blur）+ 1px 青色描边
- 动效：浮游光点（CSS `animate-float` 已有）+ CTA 发光（`shadow-glow` 已有）
- 字体：Inter + 苹方（已配置）

### 2.3 工程目标（必须满足）
- **零功能丢失**：CaptureModule / LibraryHub / StudyRoom / AIClassroom / Dashboard 的所有现有交互、状态、API 调用 100% 保留
- **小步快跑**：每个任务独立可 build / 可视觉验收，便于及时回滚
- **KISS**：嵌入既有组件 + props 控制，不重写业务逻辑

---

## 3. 方案

### 3.1 顶层 IA

```
顶部 / 侧边导航：
  ┌─ 概览（dashboard）
  ├─ xx 的学习资料（resources）  ← 新增容器页
  └─ AI 课堂（tutor）

资源页内部横向 TabBar：
  我的书架（library） · 错题作业本（capture） · 课堂小助手（workshop）
```

**Hash 协议（硬切换，不兼容旧链接）：**
```
#dashboard
#resources                    → 默认子页 library
#resources/library
#resources/capture
#resources/workshop
#tutor                        → 不变
#tutor/courseware/<id>        → 不变
#tutor/wrong/<id>             → 不变
#tutor/quiz/<id>              → 不变
#tutor/history                → 不变
```

旧 hash（`#library_hub` / `#capture` / `#study_room` / `#exams`）回退到 `#dashboard`，不做兼容。

### 3.2 路由层改造（App.tsx）

```ts
const VALID_TABS = new Set(['dashboard', 'resources', 'tutor']);

interface ParsedHash {
  tab: string;        // 顶层 Tab
  resourcesSub: string; // 'library' | 'capture' | 'workshop'，仅 resources 用
  tutorSubPath: string; // 仅 tutor 用，沿用旧协议
}
```

`renderContent` 简化为 3 路：
- `dashboard` → `<Dashboard />`
- `resources` → `<ResourcesShell sub={resourcesSub}>` 内部按 sub 渲染 `LibraryHub` / `CaptureModule` / `StudyRoom`
- `tutor` → `<AIClassroom subPath={tutorSubPath} />`

**Dashboard 跳转目标全部更新到新路由**：
- `tutor/courseware` → 不变
- `tutor/wrong` → 不变
- `tutor/quiz` → 不变
- `tutor/history` → 不变
- `study_room` → `resources/workshop`
- `library_hub` → `resources/library`

### 3.3 容器页：ResourcesShell（新增）

文件：`components/ResourcesShell.tsx`

```tsx
interface ResourcesShellProps {
  currentUser: UserProfile;
  books: EBook[];
  scannedItems: ScannedItem[];
  sub: 'library' | 'capture' | 'workshop';
  onSubChange: (sub: string) => void;
  onScanComplete: (item: ScannedItem) => void;
  onDeleteScannedItem: (id: string) => Promise<void>;
}
```

布局：
```
┌──────────────────────────────────────┐
│ 📚 大宝的学习资料                      │ ← 标题（动态 currentUser.name）
│ ─────────────────────────             │
│ [我的书架] [错题作业本] [课堂小助手]    │ ← 横向 TabBar
├──────────────────────────────────────┤
│                                      │
│  （子页内容，hideHeader=true 嵌入）    │
│                                      │
└──────────────────────────────────────┘
```

### 3.4 三个子页改造细节

#### 3.4.1 我的书架（嵌入 LibraryHub）
- **新 props**：`hideHeader?: boolean`（默认 false，单独使用时不影响）
- **行为**：
  - `hideHeader=true` 时不渲染原有"📚 图书馆"标题区（L324–333）
  - 全屏子模式（read / upload / edit）保持现状，仅将"← 返回图书馆"文案改为"← 返回书架"
  - 全屏子模式下父级 TabBar 由 ResourcesShell 自行隐藏（监听一个回传的 isFullScreen 信号 / 或 LibraryHub 暴露当前 viewMode）
- **零业务逻辑改动**

#### 3.4.2 错题作业本（嵌入 CaptureModule）
- **新 props**：
  - `hideHeader?: boolean`
  - `lockedSubTab?: 'wrong_problems' | 'archived_docs'`（锁定可见子 Tab，隐藏 'capture' 子 Tab）
  - `onTriggerCapture?: () => void`（暴露"+ 拍题"动作给父级 Header）
- **行为**：
  - `hideHeader=true` 时不渲染顶部标题栏
  - `lockedSubTab` 存在时：隐藏内部 'capture' 子 Tab；将拍题入口改为父级 Header 右上角的 `+ 拍题` 按钮（点击触发 `onTriggerCapture` → CaptureModule 内部仍走原 `setActiveSubTab('capture')` 流程或暴露专用方法）
  - 子 Tab 仅显示 `错题 / 归档` 二选一切换
  - **保留**：所有 OCR、批量多页、Review Modal、KnowledgeHub 跳转逻辑
- **MVP 实现策略**：先用最小改动——加 `hideHeader` + `lockedSubTab` 两个 prop，"+ 拍题"按钮直接调用 CaptureModule 暴露的 `goToCaptureSubTab` ref 方法

#### 3.4.3 课堂小助手（嵌入 StudyRoom）
- **新 props**：`hideHeader?: boolean`
- **行为**：
  - `hideHeader=true` 时不渲染原标题栏
  - 保留 `textbook | wrong` 两种模式 + `select | courseware | quiz` 三步流程
  - 仅做样式赛博化，业务流程零改动

### 3.5 视觉系统（轻量赛博）

#### 3.5.1 新增 Tailwind token

`tailwind.config.js` 扩展：
```js
colors: {
  cyber: {
    bg: '#0a1628',       // 深藏青
    bg2: '#1a1145',      // 青紫
    surface: '#0f1e3a',  // 卡片底
    border: '#1e3a5f',   // 描边
    text: '#e0f2fe',     // 主文字
    muted: '#7a99c4',    // 次文字
  },
  neon: {
    // 已存在的保留
    amber: '#FFD66B',    // 新增暖黄
  }
},
boxShadow: {
  'glow-amber': '0 0 20px rgba(255, 214, 107, 0.35)',
  'glow-cyan-lg': '0 0 32px rgba(0, 212, 255, 0.45)',
},
backgroundImage: {
  'cyber-gradient': 'linear-gradient(135deg, #0a1628 0%, #1a1145 100%)',
}
```

#### 3.5.2 全局背景层
- `Layout.tsx` 最外层 div 改为 `bg-cyber-gradient`，并在其上叠加 1 个绝对定位的 `<FloatingDots />` 组件（5–8 个 `animate-float` 的小光点，纯装饰）
- 现有 `bg-gradient-to-br from-slate-50 via-white to-sky-50/30` 替换

#### 3.5.3 卡片
- 现有 `Card` 组件加可选 `variant="cyber"` prop（默认仍为亮色，逐步迁移）
- `cyber` 变体：`bg-cyber-surface/60 backdrop-blur-md border border-cyber-border text-cyber-text`

#### 3.5.4 移动端底部导航
- 三均分 / 大图标 + 文字 / 图标 24–26px / 文字 11px
- 选中态：`text-neon-blue` + `drop-shadow-[0_0_8px_rgba(0,212,255,0.6)]` + 顶部 2px 高亮条

### 3.6 删除项
- `components/ExamCenter.tsx`（dead code，无后端）
- `App.tsx` 中对 ExamCenter 的 `import` 与 `case 'exams'` 分支
- `docs/产品功能与UI重组方案_v1.md` 不删除（作历史记录）

---

## 4. 任务拆分（细粒度，逐项验收）

> 每个任务独立可 build / 可视觉确认。完成一项再启动下一项。

### Phase A：基础设施（视觉无感，仅准备）
- **A1** 删除 ExamCenter（文件 + App.tsx 引用 + types 中相关类型）
- **A2** Tailwind 扩展 cyber/neon-amber/glow tokens
- **A3** App.tsx 路由改造：VALID_TABS 改为 3 项，parseHash 拆分 resourcesSub 与 tutorSubPath，旧 hash 回退到 dashboard

### Phase B：容器与子页接入（功能可用，样式仍亮色）
- **B1** 新建 `ResourcesShell.tsx`（横向 TabBar + 三子页路由占位）
- **B2** LibraryHub 加 `hideHeader` prop，接入 ResourcesShell 的 library 子页
- **B3** StudyRoom 加 `hideHeader` prop，接入 ResourcesShell 的 workshop 子页
- **B4** CaptureModule 加 `hideHeader` + `lockedSubTab` + `onTriggerCapture` prop，接入 ResourcesShell 的 capture 子页；Header "+ 拍题"按钮联调
- **B5** Layout.tsx navItems 改为 3 项；Dashboard 跳转目标更新到新路由
- 验收：所有原功能可用，URL 切换正常

### Phase C：视觉赛博化（不改逻辑）
- **C1** Layout 全局背景 + FloatingDots
- **C2** Layout 顶部 Logo / 侧边栏 / 移动端底部导航 赛博样式
- **C3** Dashboard 卡片与图表赛博样式（StatCards、TrendCard、列表 Row）
- **C4** ResourcesShell TabBar 赛博样式
- **C5** AIClassroom 卡片与 Tab 赛博样式
- **C6** LibraryHub 网格 / 筛选条 / BookCard 赛博样式
- **C7** StudyRoom 步骤卡片与生成器 UI 赛博样式
- **C8** CaptureModule 二选一 Tab + 列表项赛博样式
- 验收：每完成一项独立截图比对

### Phase D：收尾
- **D1** 跨设备实测（桌面 / 移动）+ 主流程冒烟（拍题→错题→生成讲解→AI 课堂）
- **D2** 部署到 jia.haokuai.uk

---

## 5. 风险

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 组件嵌入后 layout 错乱（max-w / padding 重复） | 中 | 中 | 每个子页 hideHeader 后单独验收；子页本身 padding 由 ResourcesShell 统一控制 |
| CaptureModule 内部状态机与父级 lockedSubTab 冲突 | 中 | 高 | B4 单独成任务；先用最小 prop 改动（不重写 useState），验证后再优化 |
| 视觉赛博化导致原浅色组件可读性下降 | 中 | 中 | Phase C 拆 8 个子任务逐项验收，每项可独立 revert |
| 旧深链失效引发用户投诉 | 低 | 低 | 用户已确认硬切换；Dashboard 内部跳转已同步更新 |
| BookReader 全屏模式与 ResourcesShell TabBar 叠加 | 中 | 中 | LibraryHub 暴露 viewMode 信号，ResourcesShell 在 read/upload/edit 时隐藏自己的 TabBar |

---

## 6. 回滚

每个 Phase / 子任务独立提交，commit message 形如 `feat(ia-v2): A1 删除 ExamCenter`。

- **完整回滚**：`git reset --hard v1.9.0-ia-redesign-proposal`
- **单 Phase 回滚**：`git revert <phase-起始-commit>..<phase-末尾-commit>`
- **视觉回滚（保留 IA）**：仅 revert Phase C 的 8 个 commit，保留 A/B 阶段的结构性改动

---

## 7. FAQ

**Q1：为什么不直接复用 v1 已经写好的代码？**
A：v1 已 rollback 且 force-push，远端不存在。重新写也强制走"先文档后代码"的流程，避免再次跑偏。

**Q2：移动端 3 项 Tab 会不会比 5 项还拥挤？**
A：相反，3 项均分后每项约占 33% 宽度（5 项时仅 20%），点击区显著扩大；图标也可放大到 26px。

**Q3：ResourcesShell 自己也用赛博样式吗？**
A：是。横向 TabBar 选中态：`text-neon-blue + 底部 2px 发光条`；未选中：`text-cyber-muted`。

**Q4：AIClassroom 里的 3 个内部 Tab（课件/错题/历史）也要改吗？**
A：本轮不动结构，仅在 Phase C5 重做颜色与卡片样式。

**Q5：Dashboard 改了跳转目标，但旧 Tab id（library_hub 等）在哪些地方还在用？**
A：A3 阶段会全局 grep `'library_hub'|'study_room'|'capture'|'exams'` 并替换。Dashboard 的 `onJump('study_room')` 等需同步改为 `onJump('resources', 'workshop')`。

**Q6：CaptureModule 暴露"+ 拍题"按钮的实现方式？**
A：MVP 用 `useImperativeHandle` 暴露 `triggerCapture()` 方法；ResourcesShell 通过 ref 调用。若 ref 复杂度过高，回退方案：在 CaptureModule 内部读取 `lockedSubTab` 时，直接渲染一个 props 控制的浮动按钮，去掉 ref。

---

## 8. 实施前最终确认清单

- [x] 顶层 3 Tab 命名：概览 / xx 的学习资料 / AI 课堂
- [x] 子页命名：我的书架 / 错题作业本 / 课堂小助手
- [x] 视觉风格：轻量赛博
- [x] Dashboard：仅改跳转 + 赛博样式
- [x] AI 课堂：仅赛博样式
- [x] 旧路由：硬切换不兼容
- [x] ExamCenter：删除
- [x] 移动端：三均分大图标 + 文字
- [ ] **本文档用户确认 → 进入 Phase A1**
