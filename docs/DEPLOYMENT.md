# 闪闪 部署指南

**适用环境**: CentOS 8.2 / Ubuntu 20.04
**服务器规格**: 2核4G (推荐)
**最后更新**: 2026-01-21

---

## 目录

- [1. 快速部署](#1-快速部署)
- [2. 混合部署方案](#2-混合部署方案)
- [3. 容器化编译](#3-容器化编译)
- [4. 数据持久化功能](#4-数据持久化功能)
- [5. 故障排查](#5-故障排查)

---

## 1. 快速部署

### 1.1 服务器规格

**目标配置**（已验证）:
- **CPU**: 2 核
- **内存**: 4GB
- **硬盘**: 50GB
- **操作系统**: CentOS 8.2 或 Ubuntu 20.04
- **网络**: 公网 IP + 80/443 端口开放

### 1.2 前置准备

1. **获取 API Key**:
   - 访问 [Google AI Studio](https://aistudio.google.com/)
   - 申请 Gemini API Key
   - 记录 API Key（后续配置时需要）

2. **SSH 登录服务器**:
   ```bash
   ssh root@your-server-ip
   ```

### 1.3 一键部署 (Ubuntu/CentOS)

```bash
# 1. 安装 Git（如果未安装）
yum install -y git          # CentOS
# apt-get install -y git    # Ubuntu

# 2. 克隆项目
git clone <your-repo-url>
cd HL-os

# 3. 配置环境变量
cp .env.example .env
vim .env  # 填写 GEMINI_API_KEY 等

# 4. 执行部署脚本
chmod +x deploy.sh
sudo ./deploy.sh
```

部署脚本会自动完成：
1. 检测并安装 Docker 和 Docker Compose
2. 配置系统优化参数
3. 构建前端和后端
4. 启动 Docker 容器
5. 执行健康检查

**部署完成后**，访问 `http://your-server-ip` 即可使用。

---

## 2. 混合部署方案

### 2.1 架构对比

| 组件 | 全 Docker 方案 | 混合部署方案 | 理由 |
|------|--------------|------------|------|
| **前端** | Nginx 容器 | 系统 Nginx | 静态文件无需容器隔离 |
| **后端** | Node 容器 | systemd 服务 | 减少容器开销，原生性能 |
| **AnythingLLM** | 容器 | 容器 | 第三方服务，隔离更安全 |

### 2.2 资源消耗对比（2核4G 服务器）

```
全 Docker 方案:
├── Nginx 容器:      50MB
├── Node 容器:       250MB + 容器层开销 100MB
├── AnythingLLM:     800MB
└── Docker Daemon:   150MB
    总计:            ~1.35GB

混合部署方案:
├── 系统 Nginx:      10MB
├── Node 进程:       200MB
├─��� AnythingLLM:     800MB
└── Docker Daemon:   50MB (仅一个容器)
    总计:            ~1.06GB

节省: ~300MB 内存 + ~15% CPU
```

### 2.3 前置准备（混合部署）

```bash
# 1. 安装 Node.js 20
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -  # CentOS
# curl -fsSL https://deb.nodesource.com/setup_20.x | bash -  # Ubuntu
yum install -y nodejs
# apt-get install -y nodejs

# 2. 安装 Nginx
yum install -y nginx
# apt-get install -y nginx
systemctl enable nginx
systemctl start nginx

# 3. 安装 Docker & Docker Compose
curl -fsSL https://get.docker.com | bash
systemctl enable docker
systemctl start docker

# 安装 Docker Compose
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" \
  -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose
```

### 2.4 执行混合部署

```bash
# 1. 上传代码到服务器
scp -r HL-os/ root@your-server:/root/

# 2. 进入项目目录
cd /root/HL-os

# 3. 配置环境变量
cp .env.example .env
vim .env  # 填写 GEMINI_API_KEY 等

# 4. 执行混合部署
chmod +x deploy-hybrid.sh
sudo ./deploy-hybrid.sh
```

### 2.5 运维命令（混合部署）

```bash
# 查看后端日志（实时）
journalctl -u hl-backend -f

# 重启后端
systemctl restart hl-backend

# 重载 Nginx 配置
nginx -t && systemctl reload nginx

# 管理 AnythingLLM
docker-compose -f docker-compose.anythingllm.yml logs -f
docker-compose -f docker-compose.anythingllm.yml restart
```

### 2.6 Systemd服务配置

**hl-backend.service**:
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

# 停止服务
sudo systemctl stop hl-backend

# 查看状态
sudo systemctl status hl-backend

# 查看日志
sudo journalctl -u hl-backend -f
```

---

## 3. 容器化编译

### 3.1 问题背景

在服务器直接执行 `npm run build` 时遇到以下错误：

```
SyntaxError: Unexpected token ?
    at Module._compile (internal/modules/cjs/loader.js:723:23)
```

**根本原因**:
- 服务器 Node.js 版本过低（v10.x）
- TypeScript 5.2.2 使用了 ES2020 的空值合并运算符 `??`
- Node.js v10 不支持 ES2020 语法

### 3.2 解决方案

使用 **Docker 多阶段构建**，在容器内使用 Node.js 20 进行编译。

### 3.3 一键编译

```bash
# 赋予执行权限
chmod +x build.sh

# 执行容器化编译
./build.sh
```

脚本会自动：
1. 构建前端编译容器
2. 复制前端产物到 `build-output/frontend/dist/`
3. 构建后端编译容器
4. 复制后端产物到 `build-output/backend/dist/`
5. 销毁所有编译容器
6. 生成构建报告 `build-output/build-report.txt`

### 3.4 编译产物位置

```
build-output/
├── frontend/
│   └── dist/                    # 前端静态文件
│       ├── index.html
│       ├── assets/
│       └── ...
├── backend/
│   └── dist/                    # 后端编译后的 JS
│       ├── index.js
│       ├── routes/
│       └── services/
└── build-report.txt             # 构建报告
```

### 3.5 性能数据

| 阶段 | 耗时 | 磁盘占用 |
|------|------|----------|
| 前端依赖安装 | ~2 分钟 | 300MB |
| 前端 TypeScript 编译 | ~30 秒 | - |
| 前端 Vite 构建 | ~1 分钟 | - |
| 前端产物大小 | - | ~5MB |
| 后端依赖安装 | ~1 分钟 | 150MB |
| 后端 TypeScript 编译 | ~15 秒 | - |
| 后端产物大小 | - | ~500KB |
| **总耗时** | **~5 分钟** | **~460MB** |

---

## 4. 数据持久化功能

### 4.1 功能概述

已完成的功能：
- ✅ 扫描项（错题/笔记）保存到服务器文件系统
- ✅ 教材文件保存到服务器文件系统
- ✅ Obsidian 格式 Markdown 自动生成
- ✅ AnythingLLM 向量数据库自动索引
- ✅ 前端从服务器加载数据（移除 IndexedDB）
- ✅ **分片上传**：支持大文件上传（5MB分片），带进度显示和重试机制
- ✅ **多图片上传**：支持多页试卷，串行OCR处理
- ✅ **临时文件清理**：自动清理24小时前的过期分片文件

### 4.2 三层存储架构

```
┌─────────────────────────────────────────────────────────┐
│  层级1: AnythingLLM (向量数据库 - 热数据/可搜索)          │
│  ├─ LanceDB 向量存储 (嵌入容器内)                        │
│  ├─ Gemini text-embedding-004 向量化                    │
│  └─ 用途: RAG检索、语义搜索                              │
└─────────────────────────────────────────────────────────┘
                      ↓ 元数据包含文件路径
┌─────────────────────────────────────────────────────────┐
│  层级2: Obsidian文件夹 (结构化内容/永久存储)              │
│  ├─ Wrong_Problems/    (错题本 Markdown)                │
│  ├─ No_Problems/       (试卷&作业 Markdown)             │
│  └─ Courses/           (课件&测验 Markdown)             │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  层级3: 原始文件目录 (原始资源/存证备份)                   │
│  ├─ images/  (原始图片 - 按月归档)                       │
│  └─ books/   (电子教材 PDF/EPUB/TXT)                    │
└─────────────────────────────────────────────────────────┘
```

### 4.3 创建数据目录

```bash
# SSH 登录服务器
ssh user@your-server

# 创建数据目录
sudo mkdir -p /opt/hl-os/data
sudo chown -R www-data:www-data /opt/hl-os

# 子目录会自动创建：
# /opt/hl-os/data/obsidian/
# /opt/hl-os/data/originals/
# /opt/hl-os/data/metadata.json
```

### 4.4 更新 Docker Compose 配置

确保 `docker-compose.yml` 包含数据卷挂载：

```yaml
backend:
  volumes:
    - ./data:/opt/hl-os/data  # 数据持久化
    - ./uploads:/app/uploads  # 分片上传目录
  environment:
    - DATA_DIR=/opt/hl-os/data
    - UPLOAD_DIR=/app/uploads
```

### 4.5 验证服务

```bash
# 健康检查
curl http://localhost:3000/api/health

# 预期响应：
# {"status":"ok","timestamp":1737360000000,"version":"1.0.0"}
```

### 4.6 数据备份

**自动备份脚本** (`/opt/hl-os/scripts/backup.sh`):

```bash
#!/bin/bash
DATE=$(date +%Y%m%d)
BACKUP_DIR="/opt/hl-os/backups/$DATE"

mkdir -p "$BACKUP_DIR"

# 备份 Obsidian 文件夹
tar -czf "$BACKUP_DIR/obsidian.tar.gz" /opt/hl-os/data/obsidian/

# 备份原始文件
tar -czf "$BACKUP_DIR/originals.tar.gz" /opt/hl-os/data/originals/

# 备份 AnythingLLM
tar -czf "$BACKUP_DIR/anythingllm.tar.gz" /opt/hl-os/anythingllm-storage/

# 备份元数据
cp /opt/hl-os/data/metadata.json "$BACKUP_DIR/"

echo "备份完成: $BACKUP_DIR"
```

**设置定时任务**:
```bash
# 编辑 crontab
crontab -e

# 添加每日凌晨3点备份
0 3 * * * /opt/hl-os/scripts/backup.sh

# 保留最近30天
0 4 * * * find /opt/hl-os/backups -type d -mtime +30 -exec rm -rf {} \;
```

---

## 5. 故障排查

### 5.1 容器启动失败

**症状**: `docker-compose up -d` 后容器未运行

**排查步骤**:
```bash
# 查看容器状态
docker-compose ps

# 查看详细日志
docker-compose logs <service-name>

# 检查配置文件语法
docker-compose config
```

**常见原因**:
- 端口被占用（80, 443, 3000, 3001）
- 环境变量未配置（GEMINI_API_KEY）
- 磁盘空间不足

### 5.2 后端健康检查失败

**症状**: `curl http://localhost/api/health` 返回 502 Bad Gateway

**排查步骤**:
```bash
# 检查 backend 容器是否运行
docker-compose ps backend

# 查看 backend 日志
docker-compose logs backend

# 检查环境变量
docker-compose exec backend env | grep GEMINI_API_KEY
```

**解决方案**:
```bash
# 重启 backend 服务
docker-compose restart backend

# 如果环境变量未配置，检查 .env 文件
vim .env

# 重新部署
docker-compose down
docker-compose up -d
```

### 5.3 AnythingLLM 内存溢出

**症状**: `docker stats` 显示 AnythingLLM 内存使用接近 2GB，容器频繁重启

**解决方案**:
```bash
# 调整内存限制（编辑 docker-compose.yml）
vim docker-compose.yml

# 修改 AnythingLLM 内存限制:
# limits.memory: 2G → 2.5G

# 或减少并发分块数:
# MAX_CONCURRENT_CHUNKS: 2 → 1

# 重启服务
docker-compose down
docker-compose up -d
```

### 5.4 图像识别超时

**症状**: 拍题模块识别超时，提示 "网络层解构失败"

**排查步骤**:
```bash
# 测试 Gemini API 连通性
curl -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"Hello"}]}]}' \
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=YOUR_API_KEY"
```

**解决方案**:
- 检查服务器是否能访问 Google API（部分地区可能受限）
- 使用代理服务器或 API 中继服务
- 调整 Nginx 超时时间（`nginx.conf` 中 `proxy_read_timeout`）

### 5.5 磁盘空间不足

**症状**: `df -h` 显示根分区使用率超过 90%

**解决方案**:
```bash
# 清理 Docker 资源
docker system prune -af

# 清理日志文件
journalctl --vacuum-time=7d

# 检查大文件
du -sh /* | sort -rh | head -10
```

### 5.6 分片上传失败

**症状**: 大文件上传卡住或失败

**排查步骤**:
```bash
# 检查后端日志
docker-compose logs backend | grep -i "upload"

# 检查磁盘空间
df -h /opt/hl-os/data/uploads

# 检查临时目录
ls -lh /opt/hl-os/data/uploads/temp/
```

**常见原因**:
- 磁盘空间不足（清理临时文件）
- 分片索引超出范围
- 文件名包含非法字符

**解决**:
```bash
# 手动清理临时文件
rm -rf /opt/hl-os/data/uploads/temp/*

# 检查 cleanup 工具是否运行
docker-compose logs backend | grep -i "cleanup"
```

---

## 6. 系统优化

### 6.1 启用 Swap 交换空间

```bash
# 检查是否已有 Swap
swapon --show

# 创建 2GB Swap 文件
dd if=/dev/zero of=/swapfile bs=1M count=2048
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile

# 永久生效（写入 /etc/fstab）
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# 调整 Swap 使用策略
sysctl vm.swappiness=10
echo 'vm.swappiness=10' >> /etc/sysctl.conf
```

### 6.2 优化文件描述符限制

```bash
# 永久生效
cat >> /etc/security/limits.conf <<EOF
* soft nofile 65535
* hard nofile 65535
EOF
```

### 6.3 调整内核参数

```bash
cat >> /etc/sysctl.conf <<EOF
# 网络优化
net.core.somaxconn = 1024
net.ipv4.tcp_max_syn_backlog = 2048
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 30

# 内存优化
vm.overcommit_memory = 1
vm.max_map_count = 262144
EOF

# 应用配置
sysctl -p
```

### 6.4 Docker 镜像加速

```bash
# 创建 Docker 配置目录
mkdir -p /etc/docker

# 配置镜像加速
cat > /etc/docker/daemon.json <<EOF
{
  "registry-mirrors": [
    "https://mirror.ccs.tencentyun.com",
    "https://docker.mirrors.ustc.edu.cn"
  ],
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m",
    "max-file": "3"
  }
}
EOF

# 重启 Docker
systemctl daemon-reload
systemctl restart docker
```

---

**相关文档**:
- [技术架构](./ARCHITECTURE.md) - 系统架构设计
- [安全配置](./SECURITY.md) - 安全加固指南
- [用户手册](./USER_GUIDE.md) - 功能使用说明
