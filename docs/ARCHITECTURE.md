# 闪闪 技术架构文档

**版本**: v1.2.0
**最后更新**: 2026-01-21

---

## 目录

- [1. 系统架构](#1-系统架构)
- [2. 技术栈](#2-技术栈)
- [3. 数据模型](#3-数据模型)
- [4. API设计](#4-api设计)
- [5. 部署架构](#5-部署架构)

---

## 1. 系统架构

### 1.1 整体架构图

```
┌─────────────────────────────────────────────────────────────┐
│                     浏览器 (Browser)                         │
│  ┌───────────────────────────────────────────────────────┐  │
│  │           Vite + React 18 + TypeScript                 │  │
│  │  ┌─────────┬─────────┬─────────┬─────────┬─────────┐  │  │
│  │  │Dashboard│ Library │ Capture │StudyRoom│ Tutor  │  │  │
│  │  └─────────┴─────────┴─────────┴─────────┴─────────┘  │  │
│  │  ┌──────────��────────────────────────────────────────┐  │  │
│  │  │    API Service Layer (apiService.ts)             │  │  │
│  │  │    - fetchBooks()                                │  │  │
│  │  │    - fetchScannedItems()                         │  │  │
│  │  │    - saveScannedItemToServer()                   │  │  │
│  │  │    - saveBookToServer()                          │  │  │
│  │  └───────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │ HTTPS/API
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  Nginx (Reverse Proxy)                       │
│           :80/:443 → 后端 :3000, AnythingLLM :3001         │
└─────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┴───────────────────┐
        ▼                                       ▼
┌──────────────────┐                  ┌──────────────────────┐
│  Node.js Backend │◄─────────────────┤  AnythingLLM RAG     │
│  Express.js      │  Index API       │  (LanceDB + Gemini)  │
│  :3000           │                  │  :3001               │
└─────────┬────────┘                  └──────────────────────┘
         │
         ├───► [Doubao Service] (元数据/Markdown)
         │
         ▼
┌──────────────────────────────────────────────────┐
│     服务端文件系统 (/opt/hl-os/data/)            │
│  ├─ obsidian/          (Obsidian Markdown)       │
│  │  ├─ Wrong_Problems/  (错题本)                │
│  │  ├─ No_Problems/     (试卷作业)              │
│  │  ├─ Courses/         (课件测验)              │
│  │  └─ Books/           (电子书全文)            │
│  ├─ originals/         (原始文件)                │
│  │  ├─ images/          (原始图片)              │
│  │  ├─ books/           (电子教材)              │
│  │  └─ covers/          (图书封面)              │
│  └─ metadata.json      (元数据索引)             │
└──────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────┐
│           AI Services API                        │
│  - Google Gemini 3 (图像分析/课件/推理)           │
│  - Doubao-seed-1-8-251228 (PDF元数据/Markdown转换)│
└──────────────────────────────────────────────────┘
```

### 1.2 三层存储架构

```
┌─────────────────────────────────────────────────────────┐
│  层级1: AnythingLLM (向量数据库 - 热数据/可搜索)          │
│  ├─ LanceDB 向量存储 (嵌入容器内)                        │
│  ├─ Gemini text-embedding-004 向量化                    │
│  ├─ 存储: 文本内容 + 元数据(含文件路径链接)              │
│  └─ 用途: RAG检索、语义搜索                              │
└─────────────────────────────────────────────────────────┘
                      ↓ 元数据包含文件路径
┌─────────────────────────────────────────────────────────┐
│  层级2: Obsidian文件夹 (结构化内容/永久存储)              │
│  ├─ Wrong_Problems/    (错题本 Markdown)                │
│  ├─ No_Problems/       (试卷&作业 Markdown)             │
│  └─ Courses/           (课件&测验 Markdown)             │
│  路径: /opt/hl-os/data/obsidian/                         │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  层级3: 原始文件目录 (原始资源/存证备份)                   │
│  ├─ images/  (原始图片 - 按月归档)                       │
│  └─ books/   (电子教材 PDF/EPUB/TXT)                    │
│  路径: /opt/hl-os/data/originals/                        │
└─────────────────────────────────────────────────────────┘
```

**数据流向**：
1. 用户上传 → 后端保存原始文件到 `originals/` + Obsidian Markdown到 `obsidian/`
2. 后端推送元数据到 AnythingLLM（包含文件路径链接）
3. 前端通过 API 查询 AnythingLLM → 获取文件路径 → 读取 Markdown/PDF 内容

---

## 2. 技术栈

### 2.1 前端技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| **React** | 18.2.0 | UI框架，函数式组件 + Hooks |
| **TypeScript** | 5.6.3 | 类型安全，ES2020目标 |
| **Vite** | 5.0.8 | 构建工具，开发服务器 (HMR) |
| **Tailwind CSS** | 3.4.1 | 原子化样式系统 |
| **Framer Motion** | 12.27.1 | 声明式动画库 |
| **Lucide React** | 0.263.1 | 图标库 (2000+ SVG图标) |
| **React Markdown** | 8.0.7 | Markdown渲染 (课件/试卷) |
| **Canvas Confetti** | 1.9.4 | 庆祝动画效果 |
| **API Service Layer** | 自定义 | 服务端API调用封装 (apiService.ts) |

### 2.2 后端技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| **Node.js** | 20.x | 运行时环境 |
| **Express.js** | 4.21.2 | RESTful API框架 |
| **TypeScript** | 5.7.2 | 后端类型安全 |
| **@google/genai** | 1.37.0 | Gemini API客户端SDK |
| **openai** | 4.x | Doubao API 客户端 (兼容层) |
| **pdf-img-convert** | 1.x | PDF 封面提取 (无依赖) |
| **Multer** | 1.4.5-lts.1 | 文件上传中间件 (100MB限制) |
| **pdf-parse** | 1.1.1 | PDF文本提取 |
| **epub2** | 3.0.2 | EPUB电子书解析 |
| **cors** | 2.8.5 | 跨域资源共享 |
| **fileStorage.ts** | 自定义 | 文件系统服务 (Obsidian + originals) |

### 2.3 外部服务集成

| 服务 | 用途 | 配置 |
|------|------|------|
| **Google Gemini API** | 视觉识别/推理/向量化 | GEMINI_API_KEY |
| **ByteDance Doubao API** | 中文元数据/Markdown转换 | ARK_API_KEY, ARK_MODEL_ID |
| **AnythingLLM** | RAG向量数据库 | ANYTHINGLLM_ENDPOINT, API_KEY |

---

## 3. 数据模型

### 3.1 核心类型定义

#### UserProfile (用户档案)
```typescript
interface UserProfile {
  id: string;              // 'child_1' | 'child_2' | 'shared'
  name: string;            // '大宝' | '二宝'
  avatar: string;          // 头像URL或Emoji
  grade: string;           // '高中二年级' | '初中一年级'
}
```

#### ScannedItem (扫描项)
```typescript
interface ScannedItem {
  id: string;                          // UUID
  ownerId: string;                     // 'child_1' | 'child_2' | 'shared'
  timestamp: number;                   // Unix时间戳
  imageUrl: string;                    // base64 或 URL
  rawMarkdown: string;                 // AI生成的Markdown文本
  meta: StructuredMetaData;            // 结构化元数据
  status: ProcessingStatus;            // 处理状态
  anythingLlmIndexed?: boolean;        // 是否已索引到RAG

  // 多页试卷关联字段
  parentExamId?: string;               // 父试卷ID（多页共享）
  pageNumber?: number;                 // 当前页码（从1开始）
  totalPages?: number;                 // 总页数
  multiPageSource?: boolean;           // 是否来自多页试卷
}
```

#### StructuredMetaData (AI解析元数据)
```typescript
interface StructuredMetaData {
  type: DocType;                       // 文档类型枚举
  subject: string;                     // '数学' | '语文' | '英语' | '物理' ...
  chapter_hint?: string;               // 章节提示 (AI推测)
  knowledge_status?: '已经掌握' | '未掌握' | '需加强';
  frontmatter?: string;                // Obsidian YAML前置
  problems?: ProblemUnit[];            // 题目数组
}
```

#### ProblemUnit (题目单元)
```typescript
interface ProblemUnit {
  id: string;                          // UUID
  questionNumber: string;              // '1' | '(1)' | 'a)'
  content: string;                     // 题目文本 (可含LaTeX)
  studentAnswer: string;               // 学生答案
  teacherComment: string;              // 教师批注
  status: ProblemStatus;               // 'CORRECT' | 'WRONG' | 'CORRECTED'
}
```

#### EBook (电子教材)
```typescript
interface EBook {
  id: string;
  title: string;
  author?: string;
  fileFormat: 'pdf' | 'epub' | 'txt';
  fileSize: number;                    // 字节数
  uploadedAt: number;                  // Unix时间戳
  ownerId: string;

  // AI提取的元数据
  subject: string;
  category: string;                    // '教材' | '参考书' | '习题集'
  grade: string;
  tags: string[];

  // 目录结构
  tableOfContents: ChapterNode[];

  // RAG集成
  indexStatus: IndexStatus;            // 'PENDING' | 'INDEXING' | 'INDEXED' | 'FAILED'
  anythingLlmDocId?: string;
}
```

### 3.2 枚举类型

#### DocType (文档类型)
```typescript
enum DocType {
  TEXTBOOK = 'textbook',               // 教材内容
  NOTE = 'note',                       // 学习笔记
  WRONG_PROBLEM = 'wrong_problem',     // 错题本
  EXAM_PAPER = 'exam_paper',           // 考卷
  COURSEWARE = '学习完成的课件',        // AI生成课件
  KNOWLEDGE_CARD = '知识卡片',          // 知识点卡片
  MOCK_EXAM = '模拟考试',               // 模拟考试
  HOMEWORK = '作业',                    // 日常作业
  TUTOR_SESSION = '辅导记录',           // AI辅导记录
  UNKNOWN = 'unknown'
}
```

#### ProcessingStatus (处理状态)
```typescript
enum ProcessingStatus {
  IDLE = 'idle',                       // 未开始
  SCANNING = 'scanning',               // 扫描中
  PROCESSED = 'processed',             // 已处理
  ERROR = 'error',                     // 处理失败
  INDEXING = 'indexing',               // 索引中
  ARCHIVED = 'archived'                // 已归档
}
```

#### ProblemStatus (题目状态)
```typescript
enum ProblemStatus {
  CORRECT = 'CORRECT',                 // 正确
  WRONG = 'WRONG',                     // 错误
  CORRECTED = 'CORRECTED'              // 已订正
}
```

### 3.3 目录结构设计

```bash
/opt/hl-os/data/
├── obsidian/                    # Obsidian文件夹（Markdown存储）
│   ├── Wrong_Problems/          # 错题本
│   │   ├── 大宝/
│   │   │   ├── 数学/
│   │   │   │   └── 2026-01-20_三角函数诱导公式_abc123.md
│   │   │   ├── 物理/
│   │   │   └── 英语/
│   │   ├── 二宝/
│   │   └── shared/              # 共享错题（全家可见）
│   │
│   ├── No_Problems/             # 试卷作业（无错题）
│   │   ├── 大宝/
│   │   │   ├── 数学/
│   │   │   │   └── 2026-01-18_期末考试卷_def456.md
│   │   │   └── 语文/
│   │   └── 二宝/
│   │
│   └── Courses/                 # AI生成的课件和测验
│       ├── 大宝/
│       │   ├── 数学/
│       │   │   ├── 2026-01-19_第二章三角函数课件.md
│       │   │   └── 2026-01-19_第二章配套测验.md
│       │   └── 物理/
│       └── 二宝/
│
├── originals/                   # 原始文件存储
│   ├── images/                  # 原始图片（按月归档）
│   │   └── 2026-01/             # YYYY-MM/
│   │       ├── 20_143022_abc123.jpg      # 20号14:30:22上传
│   │       ├── 20_150830_def456.jpg
│   │       └── 21_091510_ghi789.png
│   │
│   └── books/                   # 电子教材（按月归档）
│       └── 2026-01/
│           ├── 高中数学必修1.pdf
│           ├── 高中英语必修3.epub
│           └── 初中物理八年级.txt
│
└── metadata.json                # 轻量级元数据索引（可选）
```

---

## 4. API设计

### 4.1 API基础信息

**基础URL**:
- 开发环境: `http://localhost:3000/api`
- 生产环境: `https://<your-domain>/api`

**通用响应格���**:
```typescript
{
  success: boolean;
  data?: any;              // 成功时的数据
  error?: string;          // 失败时的错误消息
}
```

### 4.2 核心API端点

#### 1. POST /api/upload-chunk (分片上传)

**请求** (multipart/form-data):
```
chunk: <分片文件数据>
chunkIndex: 0                           // 当前分片索引
totalChunks: 10                          // 总分片数
fileId: "timestamp-filename"            // 上传会话ID
fileName: "large-book.pdf"               // 原始文件名
ownerId: "child_1"                       // 所有者ID
```

**响应**:
```json
{
  "success": true
}
```

**特性**:
- 重试机制：指数退避（1秒 → 2秒 → 3秒）
- 最多重试3次
- 自动跳过已上传分片

#### 2. POST /api/upload-chunk?action=merge (合并分片)

**请求** (application/json):
```json
{
  "fileId": "timestamp-filename",
  "fileName": "large-book.pdf",
  "ownerId": "child_1"
}
```

**响应**:
```json
{
  "success": true,
  "filePath": "/uploads/files/uuid.pdf"
}
```

#### 3. POST /api/analyze-image (图像分析)

**请求**:
```json
{
  "base64Image": "data:image/jpeg;base64,/9j/4AAQSkZJRg..."
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "text": "# 数学错题\n\n## 第1题\n...",
    "meta": {
      "type": "wrong_problem",
      "subject": "数学",
      "chapter_hint": "三角函数",
      "knowledge_status": "需加强",
      "frontmatter": "---\ntags: [三角函数, 诱导公式]\n---",
      "problems": [...]
    }
  }
}
```

**错误码**:
- 400: 请求格式错误
- 429: Gemini API配额超限
- 503: 网络连接失败

#### 4. POST /api/generate-courseware (生成课件)

**请求**:
```json
{
  "bookTitle": "高中数学必修1",
  "chapter": "第二章 三角函数",
  "studentName": "大宝",
  "subject": "数学",
  "teachingStyle": "rigorous",
  "wrongProblems": [...]
}
```

**响应**:
```json
{
  "success": true,
  "data": "# 第二章 三角函数\n\n## 2.1 弧度制\n\n### 核心概念\n..."
}
```

#### 5. POST /api/generate-assessment (生成测验)

**请求**:
```json
{
  "bookTitle": "高中数学必修1",
  "subject": "数学",
  "chapter": "第二章 三角函数",
  "studentName": "大宝",
  "wrongProblems": [...],
  "coursewareContent": "# 第二章 三角函数\n\n..."
}
```

**出题规则**:
- 每个核心知识点: 2道基础题 + 1道提高题
- 难度分配: 70%基础 + 30%提高
- 若有历史错题: 针对薄弱环节出变式

#### 6. POST /api/upload-book (教材上传)

**请求** (multipart/form-data):
```
file: <PDF/EPUB/TXT文件>
ownerId: 'child_1'
```

**文件限制**:
- 最大文件大小: 100MB
- 支持格式: PDF, EPUB, TXT

#### 7. POST /api/anythingllm/index-book (RAG索引)

**请求**:
```json
{
  "bookId": "uuid-123",
  "title": "高中数学必修1",
  "content": "...",
  "metadata": {...}
}
```

---

## 5. 部署架构

### 5.1 生产环境 (Docker Compose)

**docker-compose.yml**:
```yaml
version: '3.8'

services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
      - ./frontend/dist:/usr/share/nginx/html
    depends_on:
      - backend
      - anythingllm
    networks:
      - hl-network

  backend:
    build: ./backend
    environment:
      - NODE_ENV=production
      - PORT=3000
      - GEMINI_API_KEY=${GEMINI_API_KEY}
      - ANYTHINGLLM_ENDPOINT=http://anythingllm:3001
      - ANYTHINGLLM_API_KEY=${ANYTHINGLLM_API_KEY}
    ports:
      - "3000:3000"
    volumes:
      - ./backend/uploads:/app/uploads
    networks:
      - hl-network

  anythingllm:
    image: mintplexlabs/anythingllm:latest
    environment:
      - STORAGE_DIR=/app/storage
    ports:
      - "3001:3001"
    volumes:
      - anythingllm_data:/app/storage
    networks:
      - hl-network

networks:
  hl-network:
    driver: bridge

volumes:
  anythingllm_data:
```

### 5.2 Nginx配置

**nginx.conf**:
```nginx
upstream backend {
    server backend:3000;
}

upstream anythingllm {
    server anythingllm:3001;
}

server {
    listen 80;
    server_name hl-os.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name hl-os.example.com;

    ssl_certificate /etc/nginx/ssl/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;

    # 静态资源
    location / {
        root /usr/share/nginx/html;
        try_files $uri $uri/ /index.html;
    }

    # API代理
    location /api/ {
        proxy_pass http://backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        # 大文件上传
        client_max_body_size 100M;
        proxy_request_buffering off;
    }

    # AnythingLLM代理
    location /anythingllm/ {
        proxy_pass http://anythingllm/;
        proxy_set_header Host $host;
    }
}
```

### 5.3 混合部署方案 (可选)

**架构对比**:

| 组件 | 全 Docker 方案 | 混合部署方案 | 理由 |
|------|--------------|------------|------|
| **前端** | Nginx 容器 | 系统 Nginx | 静态文件无需容器隔离 |
| **后端** | Node 容器 | systemd 服务 | 减少容器开销，原生性能 |
| **AnythingLLM** | 容器 | 容器 | 第三方服务，隔离更安全 |

**资源消耗对比（2核4G 服务器）**:
```
全 Docker 方案:       ~1.35GB
混合部署方案:         ~1.06GB
节省: ~300MB 内存 + ~15% CPU
```

**Systemd服务配置**:
```ini
[Unit]
Description=HL-OS Backend Service
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/hl-os/backend
Environment="NODE_ENV=production"
Environment="PORT=3000"
EnvironmentFile=/opt/hl-os/backend/.env
ExecStart=/usr/bin/node /opt/hl-os/backend/dist/index.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

**管理命令**:
```bash
# 启动服务
sudo systemctl start hl-backend

# 查看状态
sudo systemctl status hl-backend

# 查看日志
sudo journalctl -u hl-backend -f
```

---

---

## 6. 图书元数据提取流程

### 6.1 技术实现

图书上传后的元数据提取采用**AI 智能识别**方案：

1. **PDF 解析**: 使用 `pdfjs-dist` (Mozilla PDF.js) 提取前 4 页文本内容
2. **AI 分析**: 使用 Gemini 2.0 Flash 从前 4 页文本中提取结构化元数据
3. **字段映射**: AI 返回的 JSON 映射到数据库字段
4. **降级处理**: AI 失败时使用文件名作为默认书名

### 6.2 元数据字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| title | string | ✅ | 书名 |
| author | string | ❌ | 作者或编者 |
| subject | string | ❌ | 学科（语文/数学/英语/物理/化学/生物/历史/地理/政治/其他） |
| grade | string | ❌ | 年级（一年级上~高三下） |
| category | string | ❌ | 类型（教科书/培训资料/工具书/课外读物） |
| publisher | string | ❌ | 出版社名称 |
| publishDate | string | ❌ | 出版时间（YYYY-MM 格式） |
| tags | string[] | ❌ | 标签（默认添加用户名） |

### 6.3 存储策略

- **原始文件**: `/opt/hl-os/data/originals/books/{ownerId}/{uuid}.pdf`
- **封面图片**: Base64 存储在元数据中（当前版本未实现提取）
- **元数据索引**: 通过 API 返回给前端，未来将同步到 AnythingLLM

### 6.4 AI 提示词设计

Gemini AI 使用结构化提示词提取元数据：

```
你是一个专业的图书元数据提取助手。请从以下教材 PDF 的前 4 页文本中，提取图书的基本信息。

【提取规则】
1. 书名：优先从封面或版权页提取
2. 学科：必须是限定选项之一
3. 年级：识别"X年级X学期"或"X年级X册"格式
4. 类型：教材类图书默认选择"教科书"
5. 出版社：查找"出版社出版"关键词
6. 出版时间：查找"202X年X月"，转换为 YYYY-MM
7. 置信度：信息充足 0.8-1.0，缺失较多 0.3-0.7
```

**相关文档**:
- [部署指南](./DEPLOYMENT.md) - 详细部署步骤
- [安全配置](./SECURITY.md) - 安全加固指南
- [用户手册](./USER_GUIDE.md) - 功能使用说明
