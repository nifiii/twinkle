# 11 项功能升级实施计划

日期：2026-05-06

## 1. 已确认决策

| 编号 | 决策点 | 方案 |
|---|---|---|
| 1.a | 用户名修改范围 | 仅修改 `name`（取消 nickname） |
| 1.b | 用户管理 | 支持新增/删除用户 |
| 1.c | 年级随时间增长 | 基于出生年月自动换算（9 月-次年 8 月为一学年） |
| 2 | 多章节题量 | 线性等比 N × 单章基准 |
| 5 | 三步骤切换 | 空态提示 + 跳回按钮 |
| 7.a | 异步批改实现 | DB status 字段 + setImmediate（不引入 Redis）|
| 7.b | 测试记录入口 | 复用 AI 课堂 → 测验记录 tab |
| 8 | 二次批改范围 | 仅改 isCorrect |
| 10 | TTS 播放方式 | 全课件一键连播，预生成全部节点音频 |
| 11 | 验证生产 | 部署后 curl 验证 |

## 2. 数据模型

### 2.1 新增 users 表

```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar TEXT,
  birthDate TEXT,
  baseGrade INTEGER,
  baseGradeSetAt TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
```

### 2.2 quiz_results 新增字段

```sql
ALTER TABLE quiz_results ADD COLUMN status TEXT DEFAULT 'completed';
ALTER TABLE quiz_results ADD COLUMN gradedAt INTEGER;
ALTER TABLE quiz_results ADD COLUMN userOverridesJson TEXT;
```

## 3. 后端 API 变更

| Method | Path | 说明 |
|---|---|---|
| GET/POST/PATCH/DELETE | `/api/users` | 用户 CRUD |
| POST | `/api/generate-courseware` | 接受 `chapters: string[]` |
| POST | `/api/generate-assessment` | 接受 `chapters: string[]`，题量 N×单章 |
| POST | `/api/grade-quiz` | 改异步：立即返回 resultId+pending |
| PATCH | `/api/quiz-results/:id/override` | 用户二次批改 isCorrect |

## 4. 实施顺序（9 个 Batch）

1. 后端基础（users 表+quiz_results 字段+routes/users.ts）
2. 用户管理前端（userService.ts、App.tsx、UserSwitcher、ProfileEditor）
3. 智慧工坊（多章节选择+三步骤切换）
4. 预览模态 + 全屏阻断
5. 异步批改后端
6. 异步批改前端
7. 解答题答案展示 + 学科顺序
8. TTS 一键连播
9. 构建验证 + 部署

## 5. 部署

```bash
git push
ssh root@jia.haokuai.uk "cd /root/HLOS && git pull && ./deploy.sh"
ssh root@jia.haokuai.uk "journalctl -u hl-backend -n 100 --no-pager"
```
