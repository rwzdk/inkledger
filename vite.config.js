import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// base 用相对路径，保证构建产物在任意子路径下都能部署（Qoder Sites / Cloudflare Pages / 仓库 Pages 等）
export default defineConfig({
  base: './',
  plugins: [vue()],
  build: {
    target: 'es2018',
    chunkSizeWarningLimit: 1200
  }
})
