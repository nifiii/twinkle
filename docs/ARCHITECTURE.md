# 闪闪 技术架构文档

**版本**: v2.0.0
**最后更新**: 2026-05-09

---

## 目录

- [1. 系统架构](#1-系统架构)
- [2. 技术栈](#2-技术栈)
- [3. 数据模型](#3-数据模型)
- [4. API设计](#4-api设计)
- [5. 部署架构](#5-部署架构)
- [6. 图书元数据提取流程](#6-图书元数据提取流程)

---

## 1. 系统架构

### 1.1 整体架构图

```
┌──────────────────────────────────────────────────────────────┐
│                      浏览器 (Browser)                         │
│  React 18 + TypeScript + Vite + Tailwind CSS + Framer Motion │
│                                                              │
│  3个顶级 Tab:                                                │
│  ┌────────────┬──────────────────────┬────────────────────┐  │
│  │ Dashboard  │ Resources            │ Tutor (AI课堂)     │  │
│  │            │  └─ 我的书架         │  └─ 课程学习       │  │
│  │            │  └─ 错题本           │  └─ 错题讲解       │  │
│  │            │  └─ 学习小助手       │  └─ 历史记录       │  │
│  └────────────┴──────────────────────┴────────────────────┘  │
│                   API Service Layer (fetch /api/*)            │
└──────────────────────────────────────────────────────────────┘
                          │ HTTP/HTTPS
                          ▼
┌──────────────────────────────────────────────────────────────┐
│                   Nginx (宿主反向代理)                        │
│                :80 / :443 → 容器 :3000                       │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│              Docker 容器: twinkle                             │
│  Node.js 20 + Express.js                                     │
│  ├─ 静态文件服务 (React 构建产物 /public)                    │
│  ├─ API 路由 (/api/*)                                        │
│  └─ better-sqlite3 (SQLite 数据库)                           │
└──────────────────────────────────────────────────────────────┘
          │ 数据挂载 /opt/twinkle/data
          ▼
┌──────────────────────────────────────────────────────────────┐
│           宿主持久化目录: /opt/twinkle/data/                 │
│  ├─ hlos.db              (SQLite 数据库主文件)              │
│  ├─ obsidian/covers/     (图书封面缩略图)                   │
│  ├─ originals/books/     (原始 PDF/EPUB/TXT)               │
│  └─ originals/images/    (拍题原始图片)                    │
└──────────────────────────────────────────────────────────────┘
          │ HTTPS API 调用
          ▼
┌──────────────────────────────────────────────────────────────┐
│               火山引擎 (Volcengine) 外部服务                  │
│  ├─ Doubao 文本模型 (ARK_MODEL_ID)   — 课件/测验/元数据      │
│  ├─ Doubao 视觉模型 (ARK_VISION_MODEL_ID) — OCR 图像分析    │
│  └─ Doubao TTS (VOLCANO_TTS_*)       — 课件语音朗读          │
└──────────────────────────────────────────────────────────────┘
```

### 1.2 数据存储架构

项目使用 **单一 SQLite 数据库** 存储所有结构化数据，文件系统仅用于存放原始二进制文件（图片、PDF）和生成的 Markdown 文件。

```
SQLite: /opt/twinkle/data/hlos.db
  ├─ users              (用户档案：姓名/头像/年级/生日)
  ├─ books              (图书元数据：标题/学科/年级/目录)
  ├─ scanned_items      (拍题归档：OCR结果/题目结构化数据)
  ├─ classroom_items    (AI课堂条目：课件slides/测验questions)
  ├─ quiz_results       (测验结果归档：得分/批改详情/AI建议)
  ├─ wrong_problem_quiz_links  (错题→课件/测验关联)
  └─ analyze_tasks      (拍题异步任务状态跟踪)

文件系统: /opt/twinkle/data/
  ├─ obsidian/covers/   封面 .jpg 缩略图 (PDF 第一页截图)
  ├─ originals/books/   原始教材文件
  ├─ originals/images/  拍题原始图片
  └─ obsidian/Wrong_Problems/  错题 Markdown 文件
```

> ⚠️ 项目**不使用** AnythingLLM、向量数据库（RAG），也不依赖 Gemini。所有 AI 能力均通过火山引擎豆包 API 提供。

---

## 2. 技术栈

### 2.1 前端技术栈

| 技术 | 用途 |
|------|------|
| **React 18** | UI框架，函数式组件 + Hooks |
| **TypeScript** | 类型安全 |
| **Vite** | 构建工具，开发服务器 (HMR) |
| **Tailwind CSS** | 原子化样式系统 |
| **Framer Motion** | 页面切换/卡片动画 |
| **Lucide React** | SVG 图标库 |
| **Canvas Confetti** | OCR完成时的庆祝动画 |

**路由方案**：Hash 路由（无框架），协议如下：
```
#dashboard
#resources/<library|capture|workshop>
#tutor/<courseware|wrong|history>/<item-id>
```

### 2.2 后端技术栈

| 技术 | 用途 |
|------|------|
| **Node.js 20** | 运行时 |
| **Express.js** | RESTful API 框架 |
| **TypeScript** | 后端类型安全 |
| **better-sqlite3** | SQLite 数据库（同步 API，性能好） |
| **openai (SDK)** | 调用豆包 API（兼容 OpenAI 协议）|
| **pdf-parse / pdfjs-dist** | PDF 文本提取 |
| **epub2** | EPUB 格式解析 |
| **Multer** | 文件上传中间件 (100MB 限制) |
| **poppler-utils (pdftoppm)** | PDF → 图片（封面提取、扫描版OCR）|

### 2.3 外部服务

| 服务 | 环境变量 | 用途 |
|------|----------|------|
| 豆包文本模型 | `ARK_API_KEY` + `ARK_MODEL_ID` | 课件生成、测验出题、元数据提取、Markdown 转换 |
| 豆包视觉模型 | `ARK_VISION_MODEL_ID` | 拍题 OCR 图像识别（4层解构）|
| 豆包 TTS | `VOLCANO_TTS_*` | 课件全文语音朗读（分段串行播放）|

> TTS 降级策略：豆包 TTS 失败时自动回退到浏览器内置 Web Speech API（`zh-CN`）。

---

## 3. 数据模型

### 3.1 核心 TypeScript 类型

#### UserProfile（用户档案）
```typescript
interface UserProfile {
  id: string;          // 'child_1' | 'child_2'（数据库主键）
  name: string;        // '大宝' | '二宝'
  avatar: string;      // Emoji，如 '👦' '👧'
  grade: string;       // 后端根据 birthDate/baseGrade 推算，如 '小学五年级'
  birthDate?: string;  // YYYY-MM
  baseGrade?: number;  // 1-12，手动覆写年级时存储
}
```

#### ScannedItem（拍题归档）
```typescript
interface ScannedItem {
  id: string;
  ownerId: string;           // 数据隔离键
  timestamp: number;
  imageUrl: string;          // 原始图片路径
  rawMarkdown: string;       // AI OCR 生成的 Markdown
  meta: StructuredMetaData;  // 结构化元数据 + 题目数组
  status: ProcessingStatus;
  parentExamId?: string;     // 多页试卷关联
  pageNumber?: number;
  totalPages?: number;
}
```

#### EBook（图书）
```typescript
interface EBook {
  id: string;
  title: string;
  subject: string;           // '数学' | '语文' | ...
  category: string;          // '教材' | '教辅' | ...
  grade: string;
  tags: string[];
  tableOfContents: ChapterNode[];  // 层级目录（AI提取）
  ownerId: string;
  fileFormat: 'pdf' | 'epub' | 'txt';
  coverUrl?: string;         // 封面缩略图 URL
}
```

### 3.2 SQLite 数据库表结构

| 表名 | 主要字段 | 说明 |
|------|----------|------|
| `users` | id, name, avatar, birthDate, baseGrade | 用户档案，替代 localStorage |
| `books` | id, title, subject, grade, tableOfContents, ownerId | 图书元数据 |
| `scanned_items` | id, type, subject, problemsJson, ownerId | 拍题归档及题目结构化数据 |
| `classroom_items` | id, type(courseware\|quiz), bookTitle, chapter, contentJson | AI课堂课件和测验 |
| `quiz_results` | id, correctCount, total, percentage, resultsJson, suggestions | 测验完成后的永久归档 |
| `wrong_problem_quiz_links` | scannedItemId, problemIndex, coursewareId, quizId | 错题→课件/测验关联 |
| `analyze_tasks` | id, status, result, error | 拍题异步OCR任务状态 |

> **迁移机制**：`initDatabase()` 启动时自动检查字段并 `ALTER TABLE` 补全，兼容历史数据。迁移记录存于 `_migrations` 表，一次性 migration 不重复执行。

---

## 4. API设计

### 4.1 通用规范

**基础 URL**: `/api`

**响应格式**:
```json
{ "success": true, "data": {} }
{ "success": false, "error": "错误描述" }
```

### 4.2 API 端点一览

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET/POST | `/api/users` | 获取/创建用户 |
| PATCH | `/api/users/:id` | 更新用户资料 |
| DELETE | `/api/users/:id` | 删除用户 |
| GET | `/api/books` | 获取图书列表（按 ownerId 过滤）|
| POST | `/api/upload-chunk` | 分片上传（单片）|
| POST | `/api/upload-chunk?action=merge` | 合并所有分片 |
| POST | `/api/upload-book` | 完整图书上传（小文件）|
| POST | `/api/save-book` | 保存图书元数据 |
| PATCH | `/api/books/:id` | 编辑图书信息 |
| DELETE | `/api/books/:id` | 删除图书 |
| POST | `/api/analyze` | 发起拍题 OCR（异步任务）|
| GET | `/api/analyze-task/:id` | 轮询 OCR 任务状态 |
| POST | `/api/save-scanned-item` | 保存 OCR 归档结果 |
| GET | `/api/scanned-items` | 获取拍题列表 |
| DELETE | `/api/scanned-items/:id` | 删除拍题记录 |
| GET | `/api/classroom` | 获取课件/测验列表（支持 type/source 过滤）|
| GET | `/api/classroom/:id` | 获取单个课件或测验详情 |
| DELETE | `/api/classroom/:id` | 删除课件或测验 |
| POST | `/api/classroom/:id/mark-studied` | 标记课件已学（记录时间戳）|
| POST | `/api/generate-courseware` | 生成章节课件（保存到 classroom_items）|
| POST | `/api/generate-assessment` | 生成章节测验（保存到 classroom_items）|
| POST | `/api/wrong-problems/:id/courseware` | 针对单道错题生成讲解课件 |
| GET | `/api/quiz-results` | 获取测验历史列表 |
| GET | `/api/quiz-results/:id` | 获取测验详情 |
| PATCH | `/api/quiz-results/:id/override` | 用户二次批改某道题 |
| POST | `/api/tts` | 文字转语音（豆包 TTS，Base64 MP3）|
| GET | `/api/dashboard` | 获取看板统计数据 |

### 4.3 拍题异步流程（重要）

OCR 识别耗时约 30~450 秒，采用异步任务模式：

```
POST /api/analyze     → 返回 { taskId }
           ↓
GET /api/analyze-task/:taskId  （前端每 3 秒轮询）
           ↓
status: pending → processing → done | failed
           ↓ done
POST /api/save-scanned-item   → 持久化到数据库
```

### 4.4 分片上传流程

```
文件 > 5MB 时自动触发：

1. 前端将文件切为 5MB/片
2. 逐片 POST /api/upload-chunk（附带 fileId / chunkIndex / totalChunks）
3. 全部上传后 POST /api/upload-chunk?action=merge
4. 后端合并 → 触发 AI 元数据提取 → 返回 book 对象
```

---

## 5. 部署架构

### 5.1 单容器模型

```
宿主机 (Linux)
  ├─ Nginx         → 反向代理，监听 :80/:443
  ├─ Docker Engine → 运行 twinkle 容器
  └─ /opt/twinkle/data/  → 持久化数据卷（挂载到容器）

twinkle 容器 (node:20-alpine)
  ├─ Express.js    → :3000（仅绑定 127.0.0.1）
  ├─ 静态文件      → React 构建产物 (/app/public)
  └─ poppler-utils → pdftoppm（PDF 封面提取 / 扫描版 OCR）
```

### 5.2 Dockerfile 三阶段构建

| 阶段 | 基础镜像 | 产物 |
|------|----------|------|
| frontend-builder | node:20-alpine | React 构建产物 (dist/) |
| backend-builder | node:20-alpine + 原生编译工具 | 后端 JS (dist/) |
| production | node:20-alpine + poppler-utils | 最终运行镜像（不含编译工具链）|

> 编译工具链（python3/make/g++/dev 头文件）在最终 stage 会被 `apk del` 清除，减小镜像体积。

### 5.3 关键配置约定

| 项 | 值 |
|---|---|
| 容器名 | `twinkle` |
| 镜像名 | `twinkle:latest` |
| 监听端口 | `127.0.0.1:3000`（仅本机） |
| 数据目录（宿主） | `/opt/twinkle/data` |
| 数据库文件 | `/opt/twinkle/data/hlos.db` |
| 环境变量文件 | 项目根 `.env`（已 gitignore） |

---

## 6. 图书元数据提取流程

### 6.1 文字版 PDF（可复制文本）

```
上传 PDF
    ↓
pdfjs-dist 提取前 4 页文本（最多 8000 字）
    ↓
调用豆包文本模型 → 返回结构化元数据 JSON
    ↓
（如有全文）并发调用豆包文本模型逐片（6000字/片）转 Markdown
    ↓
保存到 books 表 + 文件写入 originals/books/
```

### 6.2 扫描版 PDF（图片式）

```
上传 PDF
    ↓
pdftoppm 将 PDF 逐页转为 JPEG 图片
    ↓
调用豆包视觉模型（多模态），前 4 页图片 → 提取元数据
    ↓
全本图片分批（3张/批，≤3并发）→ 豆包 Vision OCR → 逐批转 Markdown
    ↓
保存到 books 表 + 文件写入 originals/books/
```

> 扫描版 PDF 需要宿主或容器中安装 `poppler-utils`（提供 `pdftoppm` 命令）。Dockerfile 已默认安装。

### 6.3 AI 提取字段

| 字段 | 说明 |
|------|------|
| title | 书名（必提取） |
| author | 作者/编者（选填） |
| subject | 学科分类（数学/物理/英语等）|
| category | 图书类型（教材/教辅/竞赛资料等）|
| grade | 年级（一年级上～高三下） |
| publisher | 出版社名称 |
| publishDate | 出版时间（YYYY-MM）|
| tableOfContents | 章节目录树（level 1=章, 2=节）|

---

**相关文档**:
- [部署指南](./REMOTE_DEPLOY.md) - 全新机器部署详细步骤
- [安全配置](./SECURITY.md) - Nginx 鉴权与 HTTPS
- [用户手册](./USER_GUIDE.md) - 功能使用说明
