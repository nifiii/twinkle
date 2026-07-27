# 闪闪 (Twinkle)

> 自主把控的教材学习AI小助手 | 基于火山引擎豆包大模型构建的个性化教育数字化方案

**闪闪** 是一个自主把控的教材学习AI小助手。利用多模态大模型将纸质学习资料数字化，并基于学生学习数据生成个性化的学习内容与测验。

---

## ✨ 核心功能

| 模块 | 能力 |
|---|---|
| **多角色档案** | 多子女隔离（错题/笔记/课件/测验/统计），共享图书馆 |
| **拍题录入 OCR** | 多图串行识别、四层提取协议（原始/红笔/学生/订正）、试卷分页关联 |
| **图书馆** | 分片上传（5MB/片，断点续传）、PDF 封面提取、AI 元数据/目录解析 |
| **AI 学习园地** | 章节选择 → 课件生成（融合教材+错题）→ 配套测验 |
| **考场 / 看板** | 变式题试卷生成；今日/本周收录、掌握率、7 天趋势 |

---

## 🏗️ 技术架构

```
┌───────────────────────────────────────────────────┐
│  浏览器 → 宿主 Nginx :80 → 容器 twinkle :3000        │
├───────────────────────────────────────────────────┤
│  twinkle 容器                                       │
│    ├─ Express API (/api/*)                        │
│    ├─ 静态前端 (Vite build, /public)               │
│    └─ SQLite (better-sqlite3) → /opt/twinkle/data    │
└───────────────────────────────────────────────────┘
                  ↓ 挂载
            /opt/twinkle/data/      (宿主持久化)
              ├─ hlos.db          SQLite 数据库
              ├─ obsidian/covers  封面图
              ├─ originals/books  原始 PDF
              └─ originals/images 原始图片
```

**技术栈**

- **前端**: React 18 + TypeScript + Vite + Tailwind CSS + Framer Motion
- **后端**: Node 20 + Express + better-sqlite3
- **AI**: 火山引擎豆包（文本 / 视觉 OCR / TTS 语音）
- **工具链**: pdftoppm（封面提取）、pdf-parse / pdfjs-dist、epub2

---

## 🚀 一键部署

部署模型：**单容器（前端+后端+SQLite）+ 宿主 Nginx 反代**。
编译环境与运行环境通过 Dockerfile 多阶段严格分离，最终镜像不含编译工具链。

### 全新服务器（首次）

```bash
# 1. 装 Docker
curl -fsSL https://get.docker.com | sh && systemctl enable --now docker
# Ubuntu / Debian:
apt-get update && apt-get install -y curl git
# CentOS / RHEL:
# yum install -y curl git

# 2. 拉代码（任意目录均可）
git clone <repo-url> && cd twinkle

# 3. 配置环境变量（必填: ARK_API_KEY / ARK_MODEL_ID / ARK_VISION_MODEL_ID）
cp .env.example .env
vim .env

# 4. 部署
sudo ./deploy.sh
```

部署完成后访问配置的域名或IP。

### 后续更新

```bash
cd twinkle && git pull && sudo ./deploy.sh
```

`deploy.sh` 会重新构建镜像、滚动替换容器、做健康检查。容器无状态，数据全部落在宿主 `/opt/twinkle/data`。

### 关键约定

| 项 | 路径/值 |
|---|---|
| 环境变量文件 | 项目根 `.env`（已在 `.gitignore` 中）|
| 数据目录 | `/opt/twinkle/data`（宿主，挂载到容器）|
| 容器端口 | `127.0.0.1:3000`（仅本机，外部经 Nginx）|
| Nginx 配置 | `/etc/nginx/conf.d/twinkle.conf`（需用户自行配置，参考 `nginx.conf.example`）|
| 镜像名 | `twinkle:latest` |
| 容器名 | `twinkle` |

### 数据库

SQLite，**无需手工 SQL**。后端启动时自动：
- 创建表（books / scanned_items / classroom_items / quiz_results / users / analyze_tasks 等）
- 应用历史 schema 迁移
- 首次启动植入默认用户：`大宝` / `二宝`

详见 `backend/src/services/databaseService.ts`。

### 启用 HTTPS（可选）

`nginx.conf.example` 末尾保留了 HTTPS server 块的注释模板。参考启用步骤：

1. 用 acme.sh 或 certbot 签发证书
2. 按照模板中 HTTPS 段填入证书路径
3. 把 80 端口的 `location /` 改为 `return 301 https://$host$request_uri;`

详见 [docs/REMOTE_DEPLOY.md](docs/REMOTE_DEPLOY.md)。

---

## 🛠️ 管理命令

```bash
docker logs -f twinkle               # 查看后端日志
docker restart twinkle               # 重启容器
docker exec -it twinkle sh           # 进入容器

# 备份数据
tar czf hlos-backup-$(date +%F).tar.gz -C /opt/twinkle data

# 重置数据（危险）
docker rm -f twinkle && rm -rf /opt/twinkle/data && ./deploy.sh
```

---

## 🔧 本地开发

```bash
# 前端
npm install
npm run dev          # http://localhost:5173

# 后端
cd backend
npm install
npm run dev          # http://localhost:3000
```

环境变量从项目根 `.env` 读取，开发与生产共用同一文件；生产态由 `deploy.sh` 通过 `--env-file` 注入容器。

---

## 🔒 安全说明

- API Key 仅存在项目根 `.env`（已 gitignore）与容器环境变量中，前端代码不接触
- 容器端口绑 `127.0.0.1`，外部仅能经 Nginx 访问
- `ownerId` 仅用于受信任单设备环境中的本地资料上下文，不提供服务端认证、授权或跨学生安全隔离
- 生产部署强烈建议启用 HTTPS（参见上文）
- 不要将 `.env` 提交到 Git

---

## 📁 关键文件

| 文件 | 用途 |
|---|---|
| `Dockerfile` | 三阶段构建（前端 → 后端 → 运行）|
| `.dockerignore` | 构建上下文排除项 |
| `nginx.conf.example` | Nginx 配置示例（仅供参考，不参与部署）|
| `deploy.sh` | 一键部署脚本 |
| `.env.example` | 环境变量模板 |
| `docs/REMOTE_DEPLOY.md` | 全新机器部署详细指南 |
| `docs/ARCHITECTURE.md` | 架构说明 |
| `docs/SECURITY.md` | 安全配置 |
| `docs/USER_GUIDE.md` | 用户使用指南 |

---

## 📄 License

MIT
