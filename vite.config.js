import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [vue(), viteSingleFile()],
  // DBX 用 srcdoc 加载沙箱页面，发行包必须自包含。
  build: { outDir: 'ui', emptyOutDir: true, target: 'es2022' },
  server: { host: '127.0.0.1', port: 5173 },
});
