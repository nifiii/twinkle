# 学科枚举常量化（消除硬编码散落）

## 1. 背景

学科下拉框的 option 列表在多个组件中**硬编码重复**：

| 文件 | 位置 | 当前学科集合 |
|---|---|---|
| `components/BookEditor.tsx` | L24 数组 | 含 `科学` |
| `components/BookMetadataEditor.tsx` | L95-106 `<option>` | **本次刚补 `科学`** |
| `components/BookMetadataModal.tsx` | L198-209 `<option>` | **本次刚补 `科学`** |

历史上已经因此漏改过两次：
- 2026-05-06：用户反馈"图书馆 → 编辑图书"无 `科学` → 定位到 `BookMetadataEditor` 漏加
- 同日：上传时确认元数据用的是 `BookMetadataModal`，同样漏加

每次新增 / 调整学科都需要改 N 处，必然继续漏。属典型 DRY 违反。

## 2. 目标

- 学科枚举**单一来源**（single source of truth）
- 三个组件全部从该来源读取
- 顺序在所有页面一致：`语文 / 数学 / 英语 / 科学 / 物理 / 化学 / 生物 / 历史 / 地理 / 政治 / 其他`
- 后端 / 数据库**不强校验**（保持向后兼容，已存数据中如有 `科学` 之外的字符串不报错）

## 3. 方案

### 3.1 文件位置

新建 `constants/subjects.ts`（与既有 `types.ts` 同级；不放 `src/` 是为与前端 components 共享）：

```ts
// 学科枚举唯一来源；新增 / 调序请只改这里
export const SUBJECTS = [
  '语文', '数学', '英语', '科学',
  '物理', '化学', '生物',
  '历史', '地理', '政治',
  '其他',
] as const;

export type Subject = typeof SUBJECTS[number];
```

### 3.2 组件改造

三处 select 统一改为：

```tsx
import { SUBJECTS } from '../constants/subjects';

<option value="">请选择</option>
{SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
```

`BookEditor.tsx` 的内部数组 (L24) 也替换为 `SUBJECTS`。

### 3.3 不做的事（KISS）

- **不**做后端枚举校验：当前后端把 `subject` 当字符串透传，加了反而要写迁移
- **不**做 i18n / 多语言：与现实不符（用户全是中文）
- **不**做按学段分组：当前 UI 没分组需求
- **不**改 DB schema

## 4. 风险

| 风险 | 缓解 |
|---|---|
| 历史数据中有不在新枚举内的 subject 值（理论上没有，但保险起见） | select 渲染时若 `metadata.subject` 不在 SUBJECTS，仍能保留显示（select value 会落到 `''`，但保存时不主动覆盖） |
| 三个组件对枚举顺序有不同期望 | 全部改为 SUBJECTS，统一顺序——影响极小，仅观感 |
| import 路径错（components 与 constants 相对路径） | 测试编译验证 |

## 5. 回滚

仅 4 文件改动（1 新增 + 3 修改），`git revert` 一个 commit 即可。

## 6. FAQ

**Q：为什么不直接放 `types.ts`？**
A：`types.ts` 主要是 TS 类型；运行期常量混入会让 import 链变复杂。单独放 constants 目录更清晰。

**Q：要不要做后端 service 层枚举？**
A：后端无业务逻辑依赖学科值，无需。一旦后端开始按学科分流（如不同学科走不同 prompt），届时再单独建后端常量。

## 7. 任务清单

| # | Task | Status |
|---|---|---|
| 1 | 新建 `constants/subjects.ts` | `[ ]` |
| 2 | `BookMetadataEditor.tsx` 改用 `SUBJECTS.map` | `[ ]` |
| 3 | `BookMetadataModal.tsx` 改用 `SUBJECTS.map` | `[ ]` |
| 4 | `BookEditor.tsx` L24 改用 `SUBJECTS` | `[ ]` |
| 5 | `npm run build` 通过；本地 dev 三处页面下拉肉眼校验顺序一致 | `[ ]` |
| 6 | 部署上线 | `[ ]` |

## 8. 优先级

低。属技术债清理，**当前不阻塞业务**。建议下一次涉及"图书元数据"或"学科"相关需求时一并处理，避免单独占用一个发布窗口。
