import { defineConfig, loadEnv } from 'vite';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  // 저장소 루트의 .env (GEMINI_API_KEY, GEMINI_MODEL) 로드 — CI에서는 GitHub Secrets 환경변수 사용
  const env = loadEnv(mode, path.resolve(process.cwd(), '..'), '');
  const apiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';
  const model = env.GEMINI_MODEL || process.env.GEMINI_MODEL || 'gemini-pro-latest';
  return {
    base: './',
    build: {
      outDir: 'dist',
      target: 'es2020',
      rollupOptions: {
        input: {
          index: path.resolve(__dirname, 'index.html'),   // 랜딩 (Run System → app.html)
          app: path.resolve(__dirname, 'app.html')        // main.ts 시뮬레이션
        }
      }
    },
    define: {
      __GEMINI_API_KEY__: JSON.stringify(apiKey),
      __GEMINI_MODEL__: JSON.stringify(model)
    }
  };
});
