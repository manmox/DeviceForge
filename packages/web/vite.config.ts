import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:7321', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:7321', ws: true },
    },
  },
});
