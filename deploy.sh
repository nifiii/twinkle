#!/usr/bin/env bash
# 闪闪 一键部署脚本
# 流程: 前置检查 → 加载项目根 .env → 构建镜像 → 重启容器 → 渲染 Nginx → 健康检查
# 用法: 在项目根目录执行 sudo ./deploy.sh

set -euo pipefail

# ---------- 配置 ----------
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/.env}"
DATA_DIR="${DATA_DIR_OVERRIDE:-/opt/hl-os/data}"
IMAGE="hl-os:latest"
CONTAINER="hl-os"
NGINX_CONF="/etc/nginx/conf.d/hl-os.conf"

# ---------- 颜色 ----------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✅ $*${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $*${NC}"; }
fail() { echo -e "${RED}❌ $*${NC}" >&2; exit 1; }

echo "🚀 闪闪 部署开始"
echo "================================"

# ---------- 1. 前置检查 ----------
[ "$EUID" -eq 0 ] || fail "请使用 root 运行: sudo ./deploy.sh"

command -v docker   >/dev/null 2>&1 || fail "缺少 docker。安装: curl -fsSL https://get.docker.com | sh && systemctl enable --now docker"
command -v nginx    >/dev/null 2>&1 || fail "缺少 nginx。安装: apt-get install -y nginx 或 yum install -y nginx"
command -v envsubst >/dev/null 2>&1 || fail "缺少 envsubst。安装: apt-get install -y gettext-base 或 yum install -y gettext"
command -v curl     >/dev/null 2>&1 || fail "缺少 curl"

[ -f "$ENV_FILE" ] || fail "缺少 $ENV_FILE。执行: cp $SCRIPT_DIR/.env.example $SCRIPT_DIR/.env && vim $SCRIPT_DIR/.env"

# ---------- 2. 加载 .env 并校验 ----------
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

[ -n "${HLOS_DOMAIN:-}" ]  || fail "$ENV_FILE 缺少 HLOS_DOMAIN"
[ -n "${ARK_API_KEY:-}" ]  || fail "$ENV_FILE 缺少 ARK_API_KEY"
[ -n "${ARK_MODEL_ID:-}" ] || fail "$ENV_FILE 缺少 ARK_MODEL_ID"

ok "前置检查通过 (域名: $HLOS_DOMAIN)"

# ---------- 3. 准备数据目录 ----------
mkdir -p "$DATA_DIR"
ok "数据目录就绪: $DATA_DIR"

# ---------- 4. 构建镜像 ----------
echo "🏗️  构建镜像 $IMAGE ..."
cd "$SCRIPT_DIR"
docker build -t "$IMAGE" . || fail "镜像构建失败"
ok "镜像构建完成"

# ---------- 5. 重启容器 ----------
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  echo "🛑 移除旧容器 ..."
  docker rm -f "$CONTAINER" >/dev/null
fi

echo "🚢 启动容器 ..."
docker run -d \
  --name "$CONTAINER" \
  --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -v "$DATA_DIR:/opt/hl-os/data" \
  --env-file "$ENV_FILE" \
  "$IMAGE" >/dev/null

ok "容器已启动"

# ---------- 6. 渲染并应用 Nginx 配置 ----------
echo "🌐 渲染 Nginx 配置 ..."
[ -f "$SCRIPT_DIR/nginx.conf.template" ] || fail "缺少 nginx.conf.template"

# 仅替换 HLOS_DOMAIN，其他 $ 保留给 nginx
export HLOS_DOMAIN
envsubst '${HLOS_DOMAIN}' < "$SCRIPT_DIR/nginx.conf.template" > "$NGINX_CONF"

nginx -t || fail "Nginx 配置语法错误，已写入 $NGINX_CONF"
systemctl reload nginx
ok "Nginx 配置生效"

# ---------- 7. 健康检查 ----------
echo "🏥 健康检查 ..."
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    ok "后端健康检查通过 (容器 :3000)"
    break
  fi
  [ "$i" = "10" ] && {
    docker logs --tail 50 "$CONTAINER" || true
    fail "后端启动超时"
  }
  sleep 2
done

if curl -fsS -H "Host: $HLOS_DOMAIN" http://127.0.0.1/health >/dev/null 2>&1; then
  ok "Nginx 代理检查通过"
else
  warn "Nginx 代理检查失败 (本地探测)，请确认防火墙与 DNS"
fi

# ---------- 8. 总结 ----------
echo ""
echo "================================"
ok "部署完成"
echo ""
echo "📍 访问地址:    http://$HLOS_DOMAIN"
echo "📍 容器日志:    docker logs -f $CONTAINER"
echo "📍 容器重启:    docker restart $CONTAINER"
echo "📍 Nginx 重载:  systemctl reload nginx"
echo "📍 数据目录:    $DATA_DIR"
echo ""
