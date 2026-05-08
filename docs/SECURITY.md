# 闪闪 安全配置指南

**文档版本**: v1.0.0
**最后更新**: 2026-01-21

---

## 目录

- [1. Nginx Basic Auth](#1-nginx-basic-auth)
- [2. HTTPS配置](#2-https配置)
- [3. 防火墙配置](#3-防火墙配置)
- [4. 安全加固](#4-安全加固)
- [5. 数据备份](#5-数据备份)

---

## 1. Nginx Basic Auth

### 1.1 设计理念

**✅ 优势**：
- **简单可靠**：Nginx内置功能，无需额外开发
- **安全性高**：HTTP Basic Authentication协议成熟
- **家庭友好**：单个密码，全家人共享
- **无角色区分**：信任和信息平等，避免权限复杂性

**❌ 不需要**：
- ❌ 复杂的用户角色管理（管理员/学生）
- ❌ 前端登录框和PIN码输入
- ❌ Session管理和过期处理
- ❌ 多租户隔离（家庭单租户场景）

### 1.2 快速开始

#### 安装 htpasswd 工具

**Ubuntu/Debian**:
```bash
sudo apt-get update
sudo apt-get install -y apache2-utils
```

**CentOS/RHEL**:
```bash
sudo yum install -y httpd-tools
```

#### 创建密码文件

```bash
# 1. 创建密码文件目录
sudo mkdir -p /etc/nginx/auth

# 2. 生成密码文件（用户名: family）
sudo htpasswd -c /etc/nginx/auth/.htpasswd family

# 3. 输入密码并确认
New password: 你的密码
Re-type new password: 你的密码

# 4. 验证文件创建
cat /etc/nginx/auth/.htpasswd
```

**输出示例**:
```
family:$apr1$ZwEqEj5z$XxHxHxHxHxHxHxHxHxHxHx
```

### 1.3 配置 Nginx

**编辑 nginx 配置**:
```bash
sudo nano /etc/nginx/sites-available/hl-os
```

**添加 basic auth 配置**:
```nginx
server {
    listen 80;
    server_name your-domain.com;  # 或 IP地址

    # Basic Auth 配置
    auth_basic "闪闪 - 家庭访问";
    auth_basic_user_file /etc/nginx/auth/.htpasswd;

    # 前端静态文件
    location / {
        root /opt/hl-os/dist;
        try_files $uri $uri/ /index.html;
        index index.html;
    }

    # API 反向代理
    location /api/ {
        auth_basic "闪闪 - 家庭访问";
        auth_basic_user_file /etc/nginx/auth/.htpasswd;

        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 1.4 测试并重启

```bash
# 测试 Nginx 配置语法
sudo nginx -t

# 重启 Nginx
sudo systemctl restart nginx

# 验证 Nginx 运行状态
sudo systemctl status nginx
```

### 1.5 访问测试

**步骤**：
1. 打开浏览器，访问 `http://your-server-ip/`
2. 应弹出登录提示框
3. 输入用户名：`family`
4. 输入密码：你设置的密码
5. 点击"登录"或"确定"

**预期结果**：
- ✅ 登录成功后进入闪闪
- ✅ 可以正常使用所有功能
- ✅ 关闭浏览器后需重新登录

### 1.6 密码管理

**修改密码**:
```bash
# 更新现有用户密码
sudo htpasswd /etc/nginx/auth/.htpasswd family

# 重启 Nginx 使更改生效
sudo nginx -s reload
```

**添加多个家庭成员（可选）**:
```bash
# 添加爸爸
sudo htpasswd /etc/nginx/auth/.htpasswd dad

# 添加妈妈
sudo htpasswd /etc/nginx/auth/.htpasswd mom

# 添加大宝
sudo htpasswd /etc/nginx/auth/.htpasswd child1

# 添加二宝
sudo htpasswd /etc/nginx/auth/.htpasswd child2
```

---

## 2. HTTPS配置

### 2.1 为什么需要 HTTPS

**HTTP Basic Auth 的安全问题**：
- ❌ 密码Base64编码，几乎等同于明文传输
- ❌ 容易被网络嗅探拦截
- ❌ 不适合公网部署

**HTTPS 的优势**：
- ✅ 加密传输，保护密码安全
- ✅ 防止中间人攻击
- ✅ 适合公网部署

### 2.2 使用 Let's Encrypt 免费 SSL

**安装 Certbot**:
```bash
# Ubuntu/Debian
sudo apt-get install -y certbot python3-certbot-nginx

# CentOS/RHEL
sudo yum install -y certbot python3-certbot-nginx
```

**获取 SSL 证书**:
```bash
# 停止 Nginx 容器（如果使用Docker）
docker-compose stop nginx

# 使用 Certbot 申请证书
sudo certbot certonly --standalone -d your-domain.com -d www.your-domain.com

# 按提示输入邮箱（用于续期通知）
# 证书生成路径:
# /etc/letsencrypt/live/your-domain.com/fullchain.pem
# /etc/letsencrypt/live/your-domain.com/privkey.pem
```

### 2.3 配置 Nginx HTTPS

**复制证书到项目目录**:
```bash
# 创建 SSL 目录
sudo mkdir -p /opt/hl-os/ssl

# 复制证书
sudo cp /etc/letsencrypt/live/your-domain.com/fullchain.pem /opt/hl-os/ssl/cert.pem
sudo cp /etc/letsencrypt/live/your-domain.com/privkey.pem /opt/hl-os/ssl/key.pem

# 修改权限
sudo chown -R 1000:1000 /opt/hl-os/ssl
```

**编辑 nginx 配置**:
```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Basic Auth 配置
    auth_basic "闪闪 - 家庭访问";
    auth_basic_user_file /etc/nginx/auth/.htpasswd;

    # 其他配置与 HTTP server 块相同
    location / {
        root /opt/hl-os/dist;
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
    }
}

# HTTP 重定向到 HTTPS
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}
```

### 2.4 配置自动续期

**创建续期脚本**:
```bash
cat > /usr/local/bin/renew-cert.sh <<'EOF'
#!/bin/bash
docker-compose -f /opt/hl-os/docker-compose.yml stop nginx
certbot renew --quiet
cp /etc/letsencrypt/live/your-domain.com/fullchain.pem /opt/hl-os/ssl/cert.pem
cp /etc/letsencrypt/live/your-domain.com/privkey.pem /opt/hl-os/ssl/key.pem
docker-compose -f /opt/hl-os/docker-compose.yml start nginx
EOF

chmod +x /usr/local/bin/renew-cert.sh
```

**添加到 crontab（每月1号凌晨3点执行）**:
```bash
(crontab -l 2>/dev/null; echo "0 3 1 * * /usr/local/bin/renew-cert.sh >> /var/log/certbot-renew.log 2>&1") | crontab -
```

---

## 3. 防火墙配置

### 3.1 CentOS/RHEL (firewalld)

```bash
# 检查 firewalld 状态
sudo systemctl status firewalld

# 如果未启动，启动 firewalld
sudo systemctl start firewalld
sudo systemctl enable firewalld

# 允许 HTTP/HTTPS
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https

# 如果需要暴露 AnythingLLM 管理界面（不推荐生产环境）
# sudo firewall-cmd --permanent --add-port=3001/tcp

# 重载配置
sudo firewall-cmd --reload

# 查看已开放端口
sudo firewall-cmd --list-all
```

### 3.2 Ubuntu/Debian (UFW)

```bash
# 启用 UFW
sudo ufw enable

# 允许 HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# 允许 SSH（防止锁死）
sudo ufw allow 22/tcp

# 查看状态
sudo ufw status
```

### 3.3 SELinux 配置（CentOS/RHEL）

```bash
# 查看 SELinux 状态
getenforce

# 如果遇到权限问题，可临时关闭（不推荐生产环境）
sudo setenforce 0

# 永久关闭 SELinux（需重启）
sudo sed -i 's/SELINUX=enforcing/SELINUX=disabled/' /etc/selinux/config

# 推荐做法：配置 SELinux 策略而不是关闭
sudo setsebool -P httpd_can_network_connect 1
```

---

## 4. 安全加固

### 4.1 密码强度

**推荐做法**：
- ✅ 使用12位以上密码
- ✅ 包含大小写字母、数字、符号
- ✅ 定期更换（建议每3-6个月）

**示例强密码**：
```
HappyFamily@2024!
HomeLearning#8848
```

**不推荐做法**：
- ❌ 使用简单密码（123456, password）
- ❌ 使用家庭生日或车牌号
- ❌ 告诉家庭成员以外的人

### 4.2 网络安全

**内网部署**（推荐）：
- ✅ 仅在内网使用（192.168.x.x）
- ✅ 关闭公网访问端口（80/443）
- ✅ 使用路由器防火墙

**公网部署**（需HTTPS）：
- ⚠️ 必须配置 HTTPS
- ⚠️ 使用强密码
- ⚠️ 定期更新系统
- ⚠️ 配置防火墙（UFW/Fail2ban）

### 4.3 内容安全策略

**Nginx CSP 配置**:
```nginx
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https:; frame-ancestors 'self';";
```

### 4.4 限制后端访问

在 `hl-backend.service` 或 Nginx 配置中添加：

```nginx
location /api/ {
    # 仅允许本地访问
    allow 127.0.0.1;
    allow 192.168.1.0/24;  # 内网
    deny all;

    proxy_pass http://localhost:3000;
}
```

### 4.5 备份密码文件

```bash
# 创建备份目录
sudo mkdir -p /opt/hl-os/backups

# 备份密码文件
sudo cp /etc/nginx/auth/.htpasswd /opt/hl-os/backups/.htpasswd.backup

# 设置定时备份（可选）
echo "0 2 * * * cp /etc/nginx/auth/.htpasswd /opt/hl-os/backups/.htpasswd.$(date +\%Y\%m\%d)" | sudo crontab -
```

---

## 5. 数据备份

### 5.1 备份策略

**建议备份频率**:
- AnythingLLM 向量数据: 每周备份
- 用户上传的图书文件: 实时备份（或每日备份）
- 配置文件: 版本控制（Git）

### 5.2 自动备份脚本

创建 `/opt/hl-os/scripts/backup.sh`:

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

# 备份 Nginx 配置
cp /etc/nginx/auth/.htpasswd "$BACKUP_DIR/"

echo "备份完成: $BACKUP_DIR"
```

**设置 Cron 定时任务**:
```bash
# 编辑 crontab
crontab -e

# 添加每日凌晨3点备份
0 3 * * * /opt/hl-os/scripts/backup.sh

# 保留最近30天
0 4 * * * find /opt/hl-os/backups -type d -mtime +30 -exec rm -rf {} \;
```

### 5.3 恢复备份

```bash
# 停止服务
docker-compose stop anythingllm

# 删除旧数据
rm -rf /opt/hl-os/anythingllm-storage/*

# 解压备份
tar -xzf /opt/hl-os/backups/20260120/anythingllm.tar.gz -C /

# 重启服务
docker-compose start anythingllm
```

---

## 6. 故障排查

### 6.1 登录框不弹出

**原因**：
- 浏览器已缓存密码
- Nginx配置未生效

**解决方案**：
```bash
# 1. 清除浏览器缓存
# Chrome: F12 → Network → Disable cache
# Firefox: Ctrl+Shift+Delete

# 2. 使用无痕/隐私模式测试

# 3. 验证 Nginx 配置
sudo cat /etc/nginx/sites-available/hl-os | grep auth_basic

# 4. 重新加载 Nginx
sudo nginx -s reload
```

### 6.2 密码验证失败

**原因**：
- 密码文件路径错误
- 密码文件权限不正确
- Nginx进程用户无读取权限

**解决方案**：
```bash
# 1. 检查密码文件是否存在
ls -lh /etc/nginx/auth/.htpasswd

# 2. 检查文件权限（应该是644或更严格）
sudo chmod 644 /etc/nginx/auth/.htpasswd

# 3. 检查文件所有者
sudo chown www-data:www-data /etc/nginx/auth/.htpasswd

# 4. 如果需要，调整所有者
sudo chown -R nginx:nginx /etc/nginx/auth/
```

### 6.3 HTTPS 配置问题

**问题**：证书无法获取

**原因**：
- 域名DNS未指向服务器
- 80端口被防火墙阻止
- 端口被其他程序占用

**解决方案**：
```bash
# 1. 验证DNS解析
nslookup your-domain.com

# 2. 检查80端口开放
sudo ufw status
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# 3. 检查端口占用
sudo netstat -tlnp | grep :80

# 4. 查看Certbot日志
sudo cat /var/log/letsencrypt/letsencrypt.log
```

---

**相关文档**:
- [技术架构](./ARCHITECTURE.md) - 系统架构设计
- [部署指南](./DEPLOYMENT.md) - 部署步骤详解
- [用户手册](./USER_GUIDE.md) - 功能使用说明
