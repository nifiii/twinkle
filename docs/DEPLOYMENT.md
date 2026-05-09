# 闪闪 部署指南

**适用环境**: Ubuntu 20.04+ / Debian 12+ / CentOS 8+
**服务器规格**: 2核4G（推荐），50GB 存储
**最后更新**: 2026-05-09

---

## 目录

- [1. 快速部署](#1-快速部署)
- [2. Nginx 反向代理配置](#2-nginx-反向代理配置)
- [3. 数据备份](#3-数据备份)
- [4. 日常运维](#4-日常运维)
- [5. 故障排查](#5-故障排查)

---

## 1. 快速部署

### 1.1 前置要求

服务器需要安装：
- **Docker**（≥ 20.x）
- **curl**
- 开放入站端口：`80`（HTTP），`443`（HTTPS，可选）

安装 Docker（如未安装）：
```bash
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
```

### 1.2 获取 API Key

访问 [火山引擎控制台](https://console.volcengine.com/ark/region:ark+cn-beijing/endpoint) 申请：
- `ARK_API_KEY`：豆包 API 密钥
- `ARK_MODEL_ID`：文本模型 endpoint ID（如 `ep-xxx-xxx`）
- `ARK_VISION_MODEL_ID`：（可选）视觉模型 endpoint ID；未配置时回退到 `ARK_MODEL_ID`

TTS（语音合成）相关配置参见 `.env.example`。

### 1.3 部署步骤

```bash
# 1. 克隆项目（选择你的实际部署目录）
git clone <your-repo-url> twinkle
cd twinkle

# 2. 配置环境变量
cp .env.example .env
vim .env    # 至少填写 ARK_API_KEY 和 ARK_MODEL_ID

# 3. 执行一键部署
chmod +x deploy.sh
sudo ./deploy.sh
```

`deploy.sh` 自动完成：
1. 前置检查（Docker / .env 存在性 / 必填变量）
2. 创建数据目录 `/opt/twinkle/data`
3. 构建 Docker 镜像（三阶段：前端 Vite + 后端 TypeScript + 运行环境）
4. 停止并移除旧容器，启动新容器
5. 循环健康检查（最多等待 20 秒）

**部署完成后**，服务监听在 `127.0.0.1:3000`，通过 Nginx 对外提供服务。

### 1.4 容器参数说明

| 参数 | 值 | 说明 |
|------|----|------|
| 容器名 | `twinkle` | 固定命名，日常运维命令参照 |
| 端口映射 | `127.0.0.1:3000:3000` | 仅绑定本机，外网流量须经 Nginx |
| 数据卷 | `/opt/twinkle/data:/opt/twinkle/data` | 持久化 SQLite / 原始文件 |
| 重启策略 | `unless-stopped` | 宿主机重启后自动恢复 |
| .env 注入 | `--env-file .env` | 所有环境变量从项目根 .env 注入 |

---

## 2. Nginx 反向代理配置

### 2.1 HTTP（基础配置）

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # （可选）Basic Auth 家庭访问控制，详见 SECURITY.md
    # auth_basic "闪闪";
    # auth_basic_user_file /etc/nginx/.htpasswd;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;

        # 大文件上传超时（PDF 上传 + OCR 最长 30 分钟）
        proxy_read_timeout    1800;
        proxy_send_timeout    1800;
        client_max_body_size  200m;
    }
}
```

### 2.2 HTTPS（使用 acme.sh）

```bash
# 安装 acme.sh
curl https://get.acme.sh | sh -s email=your@email.com
source ~/.bashrc

# 签发证书（需 80 端口可用）
~/.acme.sh/acme.sh --issue -d your-domain.com --webroot /var/www/html

# 安装证书
~/.acme.sh/acme.sh --install-cert -d your-domain.com \
  --key-file  /etc/nginx/ssl/your-domain.com.key \
  --fullchain-file /etc/nginx/ssl/your-domain.com.crt \
  --reloadcmd "nginx -s reload"
```

HTTPS Nginx 配置：
```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate     /etc/nginx/ssl/your-domain.com.crt;
    ssl_certificate_key /etc/nginx/ssl/your-domain.com.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-GCM-SHA256;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-Proto https;
        proxy_read_timeout    1800;
        proxy_send_timeout    1800;
        client_max_body_size  200m;
    }
}

server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}
```

---

## 3. 数据备份

所有持久化数据位于 `/opt/twinkle/data/`：

```
/opt/twinkle/data/
├── hlos.db              SQLite 数据库（用户/图书/错题/课件/测验/结果）
├── obsidian/covers/     图书封面缩略图
├── originals/books/     原始 PDF/EPUB/TXT 文件
└── originals/images/    拍题原始图片
```

### 手动备份

```bash
tar czf twinkle-backup-$(date +%F).tar.gz -C /opt/twinkle data
```

### 定时备份（crontab）

```bash
# 每天凌晨 3 点备份，保留最近 30 天
0 3 * * * tar czf /opt/twinkle/backups/twinkle-$(date +\%F).tar.gz -C /opt/twinkle data
0 4 * * * find /opt/twinkle/backups -name "*.tar.gz" -mtime +30 -delete
```

---

## 4. 日常运维

```bash
# 查看容器状态
docker ps | grep twinkle

# 查看实时日志
docker logs -f twinkle

# 查看最近 100 行日志
docker logs --tail 100 twinkle

# 手动重启容器
docker restart twinkle

# 代码更新后重新部署（在项目目录执行）
git pull
sudo ./deploy.sh

# 进入容器调试
docker exec -it twinkle sh

# 查看数据库（容器内）
docker exec -it twinkle sqlite3 /opt/twinkle/data/hlos.db ".tables"
```

### 更新代码不丢数据

`deploy.sh` 重新部署时会停止并删除旧容器，但**数据卷 `/opt/twinkle/data` 挂载在宿主机**，不受容器生命周期影响，数据全部保留。

---

## 5. 故障排查

### 5.1 容器启动失败

```bash
docker logs twinkle
```

常见原因：
- `.env` 缺少 `ARK_API_KEY` 或 `ARK_MODEL_ID`
- 端口 3000 被占用（`lsof -i :3000`）
- `better-sqlite3` 编译失败（检查 Docker 构建日志）

### 5.2 健康检查失败

```bash
# 手动测试
curl -v http://127.0.0.1:3000/api/health
```

期望响应：`{"status":"ok","timestamp":...,"version":"1.0.0"}`

### 5.3 上传超时（413 / 504）

- 413 Entity Too Large → 检查 Nginx `client_max_body_size`，设为 `200m`
- 504 Gateway Timeout → 检查 Nginx `proxy_read_timeout`，设为 `1800`（30 分钟）

### 5.4 TTS 朗读无声音

- 检查 `VOLCANO_TTS_API_KEY` / `VOLCANO_TTS_RESOURCE_ID` 配置
- 浏览器控制台查看 `/api/tts` 请求的响应
- TTS 失败时自动回退到浏览器 Web Speech API（无声音说明浏览器也不支持）

### 5.5 OCR 结果为空

- 检查 `ARK_VISION_MODEL_ID` 是否配置（未配置会使用文本模型，无图像理解能力）
- 查看容器日志中 `[Doubao][Vision]` 行
- 单张图片 OCR 耗时 30~450 秒，前端长时间 loading 属正常现象

### 5.6 扫描版 PDF 提取失败

容器内已包含 `poppler-utils`（`pdftoppm` 命令）。若提示 `pdftoppm 未找到`：

```bash
docker exec -it twinkle which pdftoppm
# 应输出 /usr/bin/pdftoppm
```

若为空，说明 Dockerfile 安装失败，重新构建镜像：
```bash
sudo docker build --no-cache -t twinkle:latest . 
```

---

**相关文档**:
- [技术架构](./ARCHITECTURE.md) - 系统架构详解
- [安全配置](./SECURITY.md) - Basic Auth / HTTPS 加固
- [用户手册](./USER_GUIDE.md) - 功能使用说明
