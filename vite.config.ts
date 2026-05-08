
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Use (process as any).cwd() to resolve the TypeScript error where 'cwd' is not found on the Process type
  const env = loadEnv(mode, (process as any).cwd(), '');
  return {
    plugins: [react()],
    define: {
      // 兼容代码中使用的 process.env.API_KEY
      'process.env.API_KEY': JSON.stringify(env.API_KEY)
    },
    server: {
      proxy: {
        // 开发环境：将 /api 请求代理到后端服务器
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
          secure: false
        }
      }
    },
    build: {
      outDir: 'dist',
      sourcemap: false
    }
  };
});
