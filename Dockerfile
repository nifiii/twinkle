# 闪闪 单容器多阶段构建
# - Stage 1: 前端编译（Vite）
# - Stage 2: 后端编译（TypeScript）
# - Stage 3: 运行环境（仅必要运行时依赖）
# 编译环境与运行环境严格分离，最终镜像不含编译工具链。

# ================================
# Stage 1: 前端编译
# ================================
FROM node:20-alpine AS frontend-builder

WORKDIR /app

RUN npm config set registry https://registry.npmmirror.com

COPY package.json package-lock.json ./
RUN npm ci

COPY components ./components
COPY services ./services
COPY hooks ./hooks
COPY utils ./utils
COPY src ./src
COPY scripts ./scripts
COPY types.ts App.tsx index.tsx index.html ./
COPY vite.config.ts tsconfig.json tsconfig.node.json ./
COPY tailwind.config.js postcss.config.js ./

RUN echo "API_KEY=placeholder" > .env.local && npm run build && npm run verify:legacy-provider

# ================================
# Stage 2: 后端编译
# ================================
FROM node:20-alpine AS backend-builder

WORKDIR /app

# better-sqlite3 / canvas / pdfjs-dist 等原生模块的编译依赖
RUN apk add --no-cache python3 make g++ cairo-dev jpeg-dev pango-dev giflib-dev

RUN npm config set registry https://registry.npmmirror.com

COPY backend/package.json backend/package-lock.json ./
RUN npm ci

COPY backend/src ./src
COPY backend/scripts ./scripts
COPY scripts/verify-no-legacy-provider.mjs ./verify-no-legacy-provider.mjs
COPY backend/assets ./assets
COPY backend/tsconfig.json ./

RUN npm run build && node verify-no-legacy-provider.mjs

# 验证目标仅在 CI/本地显式 --target backend-test 时执行，避免测试依赖进入生产镜像。
FROM backend-builder AS backend-test

COPY backend/test ./test

RUN npm test

# ================================
# Stage 3: 运行环境
# ================================
FROM node:20-alpine AS production

WORKDIR /app

# 运行时依赖：
# - poppler-utils: pdftoppm（PDF 封面提取）
# - cairo/jpeg/pango/giflib: canvas/pdfjs 运行时共享库
# - python3/make/g++/dev 头文件: 仅当生产依赖中存在 better-sqlite3 等需重新编译的原生模块时需要
RUN apk add --no-cache \
      poppler-utils \
      cairo jpeg pango giflib \
      python3 make g++ \
      cairo-dev jpeg-dev pango-dev giflib-dev

RUN npm config set registry https://registry.npmmirror.com

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# 编译完成后剥离编译工具链以瘦身
RUN apk del python3 make g++ cairo-dev jpeg-dev pango-dev giflib-dev

COPY --from=backend-builder /app/dist ./dist
COPY --from=backend-builder /app/assets ./assets
COPY --from=frontend-builder /app/dist ./public

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/opt/twinkle/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/index.js"]
