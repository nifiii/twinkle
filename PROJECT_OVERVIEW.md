# 闪闪 (Twinkle) - 项目概览

**版本**: v1.4.0
**最后更新**: 2026-01-21
**项目状态**: 生产就绪 (Production Ready)

---

## 1. 项目概述

### 1.1 产品定位

**闪闪** 是一个自主把控的教材学习AI小助手，旨在解决以下核心痛点：

- **纸质资料数字化**：将教材、笔记、错题、试卷等纸质资料高效数字化
- **个性化学习**：基于 AI 分析学生学习数据，生成个性化学习内容和测验
- **多子女管理**：支持多个孩子独立使用，数据隔离，互不干扰
- **家庭友好设计**：简单易用，无需技术背景，信任平等的信息透明理念

### 1.2 目标用户

**主要用户**：
- 有多个子女的家庭（2-3个孩子）
- 孩子年龄段：小学高年级至高中（10-18岁）
- 重视教育，有数字化学习需求

**使用场景**：
- 日常错题整理和复习
- 教材电子化归档
- 个性化课件学习
- AI 智能测验生成

### 1.3 核心价值

1. **效率提升**：OCR 自动识别，无需手动录入错题和笔记
2. **个性化**：基于历史错题生成针对性学习内容
3. **数据隔离**：多子女数据严格隔离，方便各自管理
4. **简单易用**：一键切换用户，直观的移动端体验

---

## 2. 核心功能清单

### 2.1 多角色逻辑隔离 (Multi-Profile)

**功能描述**：支持多子女家庭，每个孩子有独立的数据空间

**实现细节**：
- **快速切换按钮**
  - 位置：顶部导航栏右侧
  - 显示：当前用户头像 + "切换到：{用户名}"
  - 交互：点击展开下拉菜单，选择目标用户

- **下拉菜单**
  - 列出所有可选用户（大宝、二宝等）
  - 当前用户高亮显示（sky-50 背景 + ✓ 对勾）
  - 显示用户头像、名字、年级
  - 点击外部自动关闭

- **Toast 提示**
  - 触发时机：用户切换成功后
  - 内容："✅ 已切换到{用户名}的视图"
  - 样式：渐变背景（from-sky-400 to-mint-400）
  - 动画：滑入（y: -100 → 0），停留2秒，淡出消失
  - 使用 Framer Motion 实现动画

- **智能记忆**
  - 存储键：`lastUsedUserId`
  - 逻辑：应用启动时读取 localStorage，自动设置为上次使用的用户
  - 容错：带 try-catch 处理，隐私模式下降级为默认用户

**数据隔离规则**：
- **个人数据**（仅当前用户可见）：
  - 错题本（Knowledge Hub）
  - 学习笔记
  - 原始图片（拍题录入）
  - AI 课件（Study Room）
  - AI 测验
  - OCR 试卷作业
  - Dashboard 统计数据

- **共享数据**（所有用户可见）：
  - 图书馆电子教材（Library Hub）

### 2.2 智能拍题录入 (AI Capture & OCR)

**功能描述**：拍照或上传图片，AI 自动识别并结构化提取内容

**技术实现**：
- **AI 引擎**：`gemini-3-flash-preview` (Vision)
- **四层提取协议**：
  1. 原始印刷内容（教材、试卷、讲义）
  2. 红笔批改痕迹（老师批注、评语）
  3. 学生手写答案（做题过程）
  4. 订正闭环判定（是否已掌握）

- **识别内容**：
  - 文字内容（包括数学公式 LaTeX）
  - 学科分类（数学、物理、化学等）
  - 章节线索（根据内容推断）
  - 知识点标签
  - 文档类型（错题、笔记、教材、试卷）

- **数据结构**：
  - 遵循 `StructuredMetaData` TypeScript 接口
  - 使用 JSON Schema 强制约束 AI 输出
  - 无需正则解析，数据稳定性高

### 2.3 图书馆模块 (Library Hub)

**功能描述**：电子教材管理、元数据提取、智能索引

**实现细节**：
- **支持的格式**：PDF, EPUB, TXT（最大 100MB）
- **元数据提取**：
  - 自动提取：书名、作者、学科、类别、年级、标签
  - 智能识别：三级目录树结构（章节 → 小节 → 知识点）
  - 手动编辑：用户可修改所有元数据

- **服务端存储**：
  - 文件路径：`/opt/hl-os/data/originals/books/{ownerId}/`
  - 元数据索引：PostgreSQL 数据库
  - 跨设备同步：多端访问同一数据源

- **分类筛选**：
  - 按学科筛选（数学、物理、化学等）
  - 按类别筛选（教材、教辅、工具书）
  - 按年级筛选（高一、高二、高三等）
  - 全文搜索（书名、作者、标签）

- **向量化索引**：
  - 自动向量化图书内容到 AnythingLLM
  - 支持 RAG 检索和语义搜索
  - 向量引擎：Gemini text-embedding-004
  - 向量存储：LanceDB

### 2.4 AI 学习园地 (Study Room)

**功能描述**：基于教材内容和历史错题生成个性化课件

**三步骤学习流程**：
1. **选择章节**：
   - 从图书列表选择教材
   - 三级目录树选择器（章 → 节 → 知识点）
   - 精准定位学习内容

2. **生成课件**：
   - AI 引擎：`gemini-3-pro-preview`
   - 输入：教材内容 + 历史错题（RAG 检索）
   - 输出：Markdown 格式课件
   - 四种教学风格：严谨讲解、故事化、实践导向、探究式

3. **配套测验**：
   - 自动生成测验题（每知识点 2 道基础 + 1 道提高）
   - 基于教材内容和学习者薄弱点
   - 支持 Markdown 格式下载

**RAG 检索增强**：
- 检索相似错题作为上下文
- 针对性加强薄弱知识点
- 个性化学习路径推荐

### 2.5 数字化知识库 (Knowledge Hub)

**功能描述**：结构化归档，支持 Obsidian 兼容

**分类归档**：
- **错题本**：`docType = WRONG_PROBLEM`
- **笔记**：`docType = NOTE`
- **教材库**：`docType = TEXTBOOK`
- **试卷作业**：`docType = EXAM`

**Obsidian 兼容**：
- 生成标准 Markdown 格式
- 保持目录结构：`Students/{Name}/Wrong_Problems/`, `Students/{Name}/Notes/`
- 支持导出到剪贴板或 Obsidian URI scheme

### 2.6 智能考场 (Smart Exam Center)

**功能描述**：基于历史错题生成个性化试卷

**技术实现**：
- **AI 引擎**：`gemini-3-pro-preview` (Thinking Budget: 4096)
- **RAG 检索**：基于学生历史错题上下文
- **推理命题**：AI 模仿出题人思维，生成变式题
- **试卷结构**：
  - 基础题（60%）
  - 进阶题（30%）
  - 压轴题（10%）
  - 教师版解析

### 2.7 实时统计面板 (Dashboard)

**功能描述**：实时展示学习数据统计

**统计指标**：
- **今日收录**：当天扫描的错题/笔记数量
- **本周收录**：最近7天新增数量
- **待复习（错题）**：状态为 `WRONG` 的题目总数
- **掌握率**：`CORRECT / (CORRECT + WRONG)` 百分比
  - 0-40%：红色（需加强）
  - 40-70%：黄色（进步中）
  - 70-100%：绿色（掌握良好）

**7天学习趋势**：
- 折线图可视化每日收录数量
- 使用 Recharts 图表库
- 动态更新（添加新数据后自动刷新）

**数据隔离**：
- 仅统计当前用户（`currentUser`）的数据
- 自动过滤，无需手动切换

### 2.8 实时语音辅导 (LiveTutor)

**功能描述**：与 Gemini 2.5 专家模型进行实时语音交流

**技术实现**：
- 语音识别：浏览器 Web Speech API
- AI 对话：Gemini 2.5 Flash
- 语音合成：浏览器 Text-to-Speech API
- 场景：解决学习难题，实时答疑

---

## 3. 技术架构

### 3.1 系统架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        云服务器 (2核4G)                        │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐    │
│  │   Nginx     │→ │   Backend    │→ │  AnythingLLM    │    │
│  │   (80/443)  │  │   (3000)     │  │    (3001)       │    │
│  │   反向代理   │  │  Express API │  │   向量数据库     │    │
│  │  Basic Auth │  │              │  │   (LanceDB)     │    │
│  └─────────────┘  └──────────────┘  └─────────────────┘    │
│         ↓                ↓                     ↓            │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐    │
│  │  React 前端  │  │ Gemini API   │  │   PostgreSQL    │    │
│  │  (静态文件)  │  │  (AI引擎)    │  │   (元数据)      │    │
│  │  UserSwitch  │  │              │  │                 │    │
│  └─────────────┘  └──────────────┘  └─────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 前端技术栈

**核心框架**：
- React 18.3
- TypeScript 5.6
- Vite 5.4（构建工具）

**UI 和样式**：
- Tailwind CSS 3.4（Utility-first CSS）
- Lucide React（图标库）
- Framer Motion 12.27（动画库）
  - Toast 提示动画
  - 页面过渡效果
  - 下拉菜单展开/收起

**状态管理**：
- React Hooks（useState, useEffect, useMemo）
- LocalStorage（用户记忆）
- 无 Redux/Zustand（保持简单）

**数据流**：
- 单向数据流（Props Down, Events Up）
- `App.tsx` 作为唯一数据源
- `scannedItems[]` 存储所有扫描项
- `useMemo` 过滤当前用户数据

### 3.3 后端技术栈

**运行时**：
- Node.js 20 LTS
- Express 4.19

**AI 集成**：
- Google GenAI SDK (`@google/genai`)
- Gemini 3 Flash Preview（视觉识别）
- Gemini 3 Pro Preview（推理生成）
- doubao-seed-1-8-251228（中文图书解析）
- Gemini Embedding 004（向量化）

**文件处理**：
- `pdf-parse`：PDF 解析
- `epub2`：EPUB 解析
- `multer`：文件上传（内存存储，10MB限制）
- **✅ 分片上传**：自定义实现，5MB分片，自动合并
- **✅ 豆包 (Doubao) 集成**：中文图书元数据提取与 Markdown 转换
- **✅ 封面提取**：`pdf-img-convert` 纯 Node.js 方案

**日志**：
- Winston 3.11

**数据库**：
- PostgreSQL（元数据存储）
- LanceDB（向量存储，通过 AnythingLLM）

### 3.4 数据存储架构（三层）

**层级 1：向量数据库（AnythingLLM + LanceDB）**
- 用途：RAG 检索、语义搜索
- 存储：文本内容向量化 + 文件路径元数据
- 向量引擎：Gemini text-embedding-004
- 配置：Chunk Size 800 tokens, Overlap 150 tokens

**层级 2：Obsidian 文件夹（`/opt/hl-os/data/obsidian/`）**
- `Wrong_Problems/`：错题本 Markdown
- `No_Problems/`：试卷作业 Markdown
- `Courses/`：课件测验 Markdown
- `Books/`：电子书全文 Markdown
- 格式：标准 Markdown + YAML Frontmatter

**层级 3：原始文件目录（`/opt/hl-os/data/originals/`）**
- `images/{year}/{month}/`：原始图片（按月归档）
- `books/{ownerId}/`：电子教材 PDF/EPUB
- `covers/`：图书封面缩略图
- 资源占用：~2.5GB（1000份文档 + 100个PDF教材）

### 3.5 部署架构

**容器化**：
- Docker 24.0+
- Docker Compose 2.0+

**服务配置**：
- **Nginx**（Alpine）
  - 端口：80/443
  - Basic Auth 访问控制
  - 静态资源缓存 1 年
  - 反向代理到后端

- **Backend**（Node.js 20 Alpine）
  - 端口：3000
  - 内存限制：512MB
  - 健康检查：`/api/health`

- **AnythingLLM**
  - 端口：3001
  - 内存限制：2GB
  - 向量数据库：LanceDB

**目标环境**：
- CentOS 8.2 / Ubuntu 20.04+
- 2 核 4GB 内存
- 50GB 硬盘

---

## 4. 数据流说明

### 4.1 用户切换数据流

```
用户点击"切换到：大宝"
  ↓
UserSwitcher 组件展开下拉菜单
  ↓
用户选择"二宝"
  ↓
onUserSwitch('child_2')
  ↓
App.tsx: handleUserSwitch()
  ↓
1. setCurrentUser(二宝)
2. saveLastUsedUser('child_2')
3. setSwitchToast('✅ 已切换到二宝的视图')
  ↓
useMemo 重新计算 filteredItems
  ↓
所有组件自动更新为二宝的数据
  ↓
显示 Toast 提示（2秒后消失）
```

### 4.2 拍题录入数据流

```
用户拍照/上传图片
  ↓
CaptureModule.tsx 显示预览
  ↓
调用 geminiService.analyzeImage(imageUrl)
  ↓
发送到 Gemini API（JSON Schema 约束）
  ↓
AI 返回结构化数据（StructuredMetaData）
  ↓
ScannedItem 对象创建
  - id: UUID
  - ownerId: currentUser.id
  - timestamp: new Date()
  - imageUrl: imagePath
  - meta: AI 提取的结构化数据
  ↓
handleScanComplete(item)
  ↓
setScannedItems([item, ...prev])
  ↓
自动保存到服务端（API POST /api/items）
  ↓
KnowledgeHub 自动显示新录入的错题
```

### 4.3 数据过滤逻辑

**App.tsx 中的过滤**：
```typescript
const filteredItems = useMemo(() => {
  return scannedItems.filter(item =>
    item.ownerId === currentUser.id || item.ownerId === 'shared'
  );
}, [scannedItems, currentUser.id]);
```

**Dashboard 统计自动隔离**：
```typescript
// Dashboard.tsx
const Dashboard: React.FC<DashboardProps> = ({ items, currentUser }) => {
  const stats = useDashboardStats(items);
  // items 已在 App.tsx 中按 currentUser.id 过滤
  // 所以统计自动隔离
};
```

---

## 5. UI/UX 设计

### 5.1 设计原则

**KISS 原则（Keep It Simple, Stupid）**：
- 不引入复杂的权限系统
- 不添加家长/学生角色区分
- 保持信息透明和信任平等
- 最小化改动，最大化体验改进

**移动端优先（Mobile First）**：
- 所有功能在手机上完美运行
- 触控友好的大按钮
- 底部导航栏（移动端）+ 侧边栏（桌面端）
- 针对刘海屏优化（`viewport-fit=cover`）

### 5.2 用户切换 UX

**设计目标**：
- 简单、快速、一键切换
- 明确的视觉反馈
- 记住上次使用的用户

**实现细节**：
- **切换按钮位置**：顶部导航栏右侧（始终可见）
- **按钮样式**：圆角矩形（rounded-xl），浅色背景（bg-gray-100）
- **下拉菜单**：宽度 200px，最大高度 300px（超出滚动）
- **当前用户高亮**：背景色（bg-sky-50）+ 对勾标记（✓）
- **Toast 提示**：渐变背景（from-sky-400 to-mint-400），滑入动画

### 5.3 色彩系统

**品牌色**：
- Primary：Sky Blue (#4A90E2)
- Secondary：Mint Green (#5FD4A0)
- Accent：Brand Red (#FB7185)

**功能色**：
- Success：Green-10 (#10B981)
- Warning：Yellow-500 (#FFB84D)
- Error：Red-600 (#DC2626)

**渐变色**：
- Sky to Mint：from-sky-400 to-mint-400（Toast 提示）
- User Avatar：from-sky-400 to-mint-400（用户头像）

---

## 6. 已实现功能清单

### 6.1 核心功能（✅ 已完成）

- [x] **多用户数据隔离**
  - [x] 用户切换功能
  - [x] 快速切换按钮（下拉菜单）
  - [x] Toast 视觉反馈
  - [x] LocalStorage 智能记忆
  - [x] 数据隔离规则（个人 vs 共享）

- [x] **智能拍题 OCR**
  - [x] 图片上传/拍照
  - [x] AI 结构化提取
  - [x] 四层提取协议
  - [x] 学科自动分类

- [x] **图书馆模块**
  - [x] PDF/EPUB/TXT 上传
  - [x] 元数据自动提取
  - [x] 三级目录树
  - [x] 分类筛选
  - [x] 全文搜索
  - [x] 向量化索引（AnythingLLM）

- [x] **AI 学习园地**
  - [x] 章节选择器
  - [x] 个性化课件生成
  - [x] 四种教学风格
  - [x] RAG 检索增强
  - [x] 配套测验生成

- [x] **数字化知识库**
  - [x] 错题本归档
  - [x] 笔记归档
  - [x] 分类浏览
  - [x] Obsidian 兼容

- [x] **智能考场**
  - [x] 个性化试卷生成
  - [x] 基础/进阶/压轴题
  - [x] 教师版解析
  - [x] Markdown 下载

- [x] **实时统计面板**
  - [x] 今日收录
  - [x] 本周收录
  - [x] 待复习统计
  - [x] 掌握率计算
  - [x] 7天学习趋势图

- [x] **实时语音辅导**
  - [x] 语音识别
  - [x] AI 对话
  - [x] 语音合成

### 6.2 基础设施（✅ 已完成）

- [x] **访问控制**
  - [x] 移除前端 PIN 认证
  - [x] Nginx Basic Auth
  - [x] 家庭单密码模式
  - [x] 信任平等设计

- [x] **容器化部署**
  - [x] Docker 镜像
  - [x] Docker Compose 配置
  - [x] Nginx 反向代理
  - [x] 健康检查

- [x] **数据存储**
  - [x] PostgreSQL 数据库
  - [x] LanceDB 向量数据库
  - [x] 三层存储架构
  - [x] 文件系统管理

- [x] **性能优化**
  - [x] 2核4G 服务器优化
  - [x] AnythingLLM 内存限制
  - [x] Nginx 静态资源缓存
  - [x] 分块策略优化

---

## 7. 设计原则和最佳实践

### 7.1 代码规范

**TypeScript 严格模式**：
- 所有组件使用 TypeScript 接口
- 启用 `strict: true`
- 无 `any` 类型（除非必要）

**KISS 原则**：
- 优先选择最简单可行方案
- 最少抽象层级
- 最少文件与模块拆分
- 50行能解决的不用200行

**YAGNI 原则（You Aren't Gonna Need It）**：
- 不过度设计
- 不为未来假设场景增加复杂度
- 满足当前需求即可

### 7.2 安全最佳实践

**访问控制**：
- Nginx Basic Auth（简单可靠）
- API Key 存储在服务器环境变量
- 前端无法访问敏感信息

**数据隐私**：
- 用户数据通过 `ownerId` 严格隔离
- LocalStorage 仅存储非敏感用户选择
- 容器隔离：敏感信息仅在内部网络传递

**注意事项**：
- ❌ 切勿将 `.env` 文件提交到 Git
- ❌ 切勿在前端代码中硬编码密钥
- ⚠️ 图片会上传至 Google 服务器进行 OCR

### 7.3 性能优化

**前端优化**：
- `useMemo` 缓存过滤结果
- Framer Motion 硬件加速动画
- Vite 按需加载
- 静态资源长期缓存

**后端优化**：
- Docker 内存限制
- 分块策略（Chunk Size: 800, Overlap: 150）
- 并发控制（2个并发分块）
- Winston 日志轮转

---

## 8. 技术亮点

### 8.1 AI 技术创新

1. **四层 OCR 提取协议**：
   - 原始印刷内容 → 红笔批改 → 学生答案 → 订正闭环
   - 完美还原数学公式（LaTeX）
   - 保留原文排版

2. **RAG 检索增强**：
   - Gemini Embedding 向量化
   - LanceDB 高效向量存储
   - 基于语义相似度的智能检索

3. **System Instruction**：
   - 内置"资深教育数字化专家" Persona
   - 内置"资深学科命题组长" Persona
   - 确保 AI 输出的专业性和教学价值

4. **JSON Schema 约束**：
   - 强制 AI 输出符合 TypeScript 接口
   - 无需正则解析，数据稳定性高

### 8.2 工程实践

1. **2核4G 服务器优化**：
   - Docker 内存限制
   - 分块策略优化
   - Nginx 静态资源缓存

2. **用户体验优化**：
   - 快速切换按钮（下拉菜单）
   - Toast 视觉反馈（动画）
   - LocalStorage 智能记忆
   - 移动端优先设计

3. **数据隔离**：
   - `ownerId` 过滤
   - `useMemo` 缓存
   - Dashboard 统计自动隔离

---

## 9. 维护和运维

### 9.1 日常维护

**Docker 容器管理**：
```bash
# 查看容器状态
docker-compose ps

# 查看日志
docker-compose logs -f backend
docker-compose logs -f nginx

# 重启服务
docker-compose restart
```

**数据备份**：
```bash
# 备份 PostgreSQL
docker-compose exec postgres pg_dump -U user hl_os > backup.sql

# 备份 AnythingLLM
tar -czf anythingllm-backup-$(date +%Y%m%d).tar.gz ./anythingllm-storage
```

### 9.2 故障排查

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 容器启动失败 | 端口占用 | `sudo lsof -i :80` 检查端口 |
| 后端健康检查失败 | API Key 未配置 | 检查 `.env` 文件 |
| AnythingLLM 无法访问 | 容器未启动 | `docker-compose logs anythingllm` |
| 图像识别超时 | 图片过大 | 压缩图片至 5MB 以下 |
| 内存不足 | 并发请求过多 | 调整 `docker-compose.yml` 内存限制 |

---

## 10. 未来规划

### 10.1 短期优化（1-3个月）

- [ ] 添加"切换动画"（页面过渡效果）
- [ ] 添加"使用统计"（记录每个孩子的使用时长）
- [ ] 优化移动端触摸体验
- [ ] 添加离线模式支持

### 10.2 中期功能（3-6个月）

- [ ] 学习进度分析
- [ ] 知识图谱可视化
- [ ] 家长监控面板（可选）
- [ ] 多孩子协作功能（如"一起学习"模式）

### 10.3 长期愿景（6-12个月）

- [ ] 学习报告生成（按孩子分别生成）
- [ ] AI 学习路径推荐
- [ ] 社区分享功能（可选）
- [ ] 多语言支持（英文版）

---

## 11. 联系和支持

**文档资源**：
- README.md：快速开始指南
- docs/NGINX_BASIC_AUTH.md：访问控制配置
- docs/plans/：功能设计和实施计划

**问题反馈**：
- 提交 Issue 到 GitHub 仓库
- 联系维护者

**贡献指南**：
- 遵循 TypeScript 严格模式
- 使用 ESLint + Prettier 格式化代码
- 提交前执行 `npm run build` 确保无编译错误

---

**文档版本**: v1.4.0
**最后更新**: 2026-01-21
**维护者**: Claude (AI Assistant)
