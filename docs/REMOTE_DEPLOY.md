# 闪闪 远程部署指南

## 1. 背景

本项目采用**单容器 Docker 部署**：前端静态资源、后端 Express、SQLite 数据库全部封装在一个镜像内。宿主机仅需 Docker + Nginx 两项依赖。

## 2. 目标

任何全新 Linux 服务器（Ubuntu 20.04+ / Debian 11+ / CentOS 8+），按本文档执行后能够通过 `http://<域名>` 访问到完整可用的闪闪。

## 3. 方案

### 3.1 硬件最低要求

| 项 | 最低 | 推荐 |
|---|---|---|
| CPU | 2 核 | 2 核 |
| 内存 | 2 GB | 4 GB |
| 硬盘 | 20 GB | 50 GB |
| 网络 | 公网 IP，开放 80（如启用 HTTPS 还需 443） | 同左 |

> 镜像构建时峰值内存约 1.2 GB；2 GB 机器请预留 swap，否则 `npm ci` 阶段可能 OOM。

### 3.2 软件依赖（宿主）

| 组件 | 用途 | 安装命令 |
|---|---|---|
| Docker | 跑容器 | `curl -fsSL https://get.docker.com \| sh && systemctl enable --now docker` |
| Nginx | 反向代理入口 | `apt-get install -y nginx` 或 `yum install -y nginx` |
| curl | 健康检查 | 通常已预装 |

宿主**不需要** Node.js（编译在容器内完成）。

### 3.3 全新机器部署步骤

#### Step 1 · 装依赖

```bash
# Docker
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

# Ubuntu/Debian
apt-get update
apt-get install -y curl git

# CentOS/RHEL
# yum install -y curl git
# systemctl enable --now nginx
```

#### Step 2 · 防火墙开放 80

```bash
# Ubuntu (ufw)
ufw allow 80/tcp

# CentOS (firewalld)
# firewall-cmd --permanent --add-service=http && firewall-cmd --reload
```

#### Step 3 · DNS 解析

将你的域名（如 `learn.example.com`）的 A 记录指向服务器公网 IP，等待生效（`dig +short learn.example.com` 能返回 IP 即可）。

> 没有域名也可以：在 Nginx 配置文件中将 server_name 设为公网 IP 或者 _，即可通过 IP 直接访问。

#### Step 4 · 拉代码

```bash
git clone <repo-url> && cd twinkle
```

放在任何目录均可（如 `/root/twinkle`、`/srv/twinkle`），`deploy.sh` 自动定位脚本所在目录。

#### Step 5 · 配置 `.env`

```bash
cp .env.example .env
chmod 600 .env
vim .env
```

`.env` 位于项目根目录，已在 `.gitignore` 与 `.dockerignore` 中，不会被提交或打入镜像。

**必填字段**：

| 变量 | 说明 | 获取方式 |
|---|---|---|

| `ARK_API_KEY` | 火山引擎豆包 Key | https://console.volcengine.com/ark |
| `ARK_MODEL_ID` | 豆包文本模型 endpoint id | 火山引擎控制台 → 在线推理 → 自定义推理接入点 |
| `ARK_VISION_MODEL_ID` | 豆包视觉模型 endpoint id（OCR 用） | 同上 |

**可选字段**（不填则相应功能降级或不可用）：

| 变量 | 说明 |
|---|---|
| `VOLCANO_TTS_API_KEY` | 豆包 TTS Key（语音播报） |
| `VOLCANO_TTS_RESOURCE_ID` | 默认 `seed-tts-2.0` |
| `VOLCANO_TTS_CLUSTER` | 默认 `volcano_mega` |
| `VOLCANO_TTS_VOICE_TYPE` | 默认 `zh_female_shuangkuai_emo_bigtts` |

> `--env-file` 不支持值中带引号、不展开 `$`。直接写明文，等号两侧不要空格。

#### Step 6 · 部署

```bash
sudo ./deploy.sh
```

脚本会：
1. 校验依赖与项目根 `.env` 必填项
2. 创建 `/opt/twinkle/data`
3. `docker build -t twinkle:latest .`（首次约 5–8 分钟）
4. 替换/启动容器 `twinkle`，挂载数据卷，绑定 `127.0.0.1:3000`
5. 健康检查 `/api/health`

#### Step 7 · 验证

```bash
curl http://127.0.0.1:3000/api/health   # 容器直连
curl http://<YOUR_DOMAIN>/health        # 经 Nginx
```

浏览器访问 `http://<YOUR_DOMAIN>` 应看到登录/选角色界面。

### 3.4 更新

```bash
cd twinkle && git pull && sudo ./deploy.sh
# 或远程一行: ssh root@<host> "cd /path/to/twinkle && git pull && ./deploy.sh"
```

数据卷不动，容器整体替换。

### 3.5 启用 HTTPS

```bash
# 1. 安装 acme.sh
curl https://get.acme.sh | sh
~/.acme.sh/acme.sh --upgrade --auto-upgrade

# 2. 签发证书（HTTP-01 验证，需 80 端口可达）
~/.acme.sh/acme.sh --issue -d <YOUR_DOMAIN> --webroot /var/www/html
# 或用 DNS 验证：参见 acme.sh 文档

# 3. 安装到系统目录
mkdir -p /etc/nginx/ssl
~/.acme.sh/acme.sh --install-cert -d <YOUR_DOMAIN> \
  --fullchain-file /etc/nginx/ssl/fullchain.cer \
  --key-file       /etc/nginx/ssl/privkey.key \
  --reloadcmd      "systemctl reload nginx"

# 4. 改 nginx.conf.example (供参考，配置你实际的 nginx 配置文件):
#    - 取消 HTTPS server 块全部注释
#    - 把 80 端口的 location / 改为:
#        return 301 https://$host$request_uri;
# 5. 重新部署
./deploy.sh
```

## 4. 风险

| 风险 | 影响 | 应对 |
|---|---|---|
| 镜像构建 OOM（2GB 机器） | 部署失败 | 加 swap：`fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile` |
| 国内拉 npm/Docker Hub 慢 | 构建超时 | Dockerfile 已内置 npmmirror；Docker Hub 可配 `daemon.json` 镜像加速 |
| 80 端口被 Apache/旧 Nginx 占用 | Nginx 起不来 | `lsof -i :80` 查占用；停掉冲突服务 |
| `.env` 字段错填 | 容器启动后 API 报 401 | `docker logs twinkle` 看具体报错，改 `.env` 后重跑 `./deploy.sh` |
| SELinux 拒绝挂载 | 容器无法读写 `/opt/twinkle/data` | `chcon -Rt svirt_sandbox_file_t /opt/twinkle/data` 或 `setenforce 0`（临时）|

## 5. 回滚

### 5.1 回滚到上个版本

```bash
cd twinkle
git log --oneline -5            # 找到上个 commit
git reset --hard <commit-sha>
./deploy.sh
```

### 5.2 数据备份与恢复

```bash
# 备份
tar czf /root/hlos-backup-$(date +%F).tar.gz -C /opt/twinkle data

# 恢复
docker rm -f twinkle
rm -rf /opt/twinkle/data
tar xzf /root/hlos-backup-2026-05-08.tar.gz -C /opt/twinkle
./deploy.sh
```

### 5.3 完全清理

```bash
docker rm -f twinkle
docker rmi twinkle:latest
rm -rf /opt/twinkle
rm /etc/nginx/conf.d/twinkle.conf
systemctl reload nginx
# 项目代码与 .env 保留在原 git 目录，按需手动删除
```

## 6. FAQ

### Q1 容器启动失败，怎么定位？
```bash
docker logs --tail 100 twinkle
docker inspect twinkle --format '{{.State.Status}} {{.State.Error}}'
```
常见原因：`.env` 缺关键 Key、`/opt/twinkle/data` 权限不对、端口 3000 被占。

### Q2 Nginx 502 Bad Gateway？
容器没起来或没监听 3000：
```bash
docker ps | grep twinkle                          # 状态
docker exec twinkle wget -q -O- http://localhost:3000/api/health
ss -tlnp | grep 3000                            # 端口
```

### Q3 上传大文件 413 Request Entity Too Large？
`nginx.conf.example` 已设 `client_max_body_size 1024M`。如仍触发，确认 `nginx -T | grep client_max_body_size` 输出当前生效值。

### Q4 数据库被锁/损坏怎么办？
```bash
docker stop twinkle
sqlite3 /opt/twinkle/data/hlos.db "PRAGMA integrity_check;"
# 严重损坏时从备份恢复（见 5.2）
docker start twinkle
```

### Q5 怎么查看后端实时请求日志？
```bash
docker logs -f twinkle
```
拍题轮询日志已被屏蔽，看到的都是有效请求。

### Q6 我想改容器端口（不用 3000）？
`.env` 改 `PORT=4000`；`deploy.sh` 中 `-p 127.0.0.1:3000:3000` 同步改成 `-p 127.0.0.1:4000:4000`；Nginx 配置中 `proxy_pass http://127.0.0.1:3000;` 同步改。三处必须一致。

### Q7 想跑多实例（蓝绿/灰度）？
本项目是个人/家庭使用场景，**不建议**多实例 —— SQLite 不支持多写并发。如确有需要，迁到 PostgreSQL 后再讨论。
