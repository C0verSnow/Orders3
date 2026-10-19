import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
export default defineConfig({ plugins: [react(), tailwind()], server: { proxy: { '/api': { target: 'http://127.0.0.1:8090', changeOrigin: false }, '/health': 'http://127.0.0.1:8090' } }, build: { outDir: '../../dist/web', emptyOutDir: true } });
