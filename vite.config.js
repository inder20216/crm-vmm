import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/crm-vmm/',
  server: {
    proxy: {
      '/webhook': {
        target: 'https://automation.openmindhelpline.com',
        changeOrigin: true,
        secure: true,
      },
      '/cloud-webhook': {
        target: 'https://inder20216.app.n8n.cloud',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/cloud-webhook/, '/webhook'),
      }
    }
  }
})
