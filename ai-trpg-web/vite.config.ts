import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const devPort = Number(env.VITE_DEV_PORT || 5174)
  const previewPort = Number(env.VITE_PREVIEW_PORT || 4173)
  const apiTarget = env.VITE_DEV_API_TARGET || 'http://127.0.0.1:3000'

  return {
    plugins: [react()],
    server: {
      port: devPort,
      strictPort: true,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
        '/socket.io': {
          target: apiTarget,
          ws: true,
          changeOrigin: true,
        },
      },
    },
    preview: {
      port: previewPort,
      strictPort: true,
    },
  }
})
