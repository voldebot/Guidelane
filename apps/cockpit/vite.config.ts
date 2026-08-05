import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const loopbackTarget = (value: string | undefined): string => {
  if (!value) return 'http://127.0.0.1:43123'
  let url: URL
  try { url = new URL(value) } catch { throw new Error('COCKPIT_API_TARGET must be an explicit loopback URL') }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/') {
    throw new Error('COCKPIT_API_TARGET must be an explicit http://127.0.0.1:<port> URL')
  }
  return url.origin
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'COCKPIT_')
  const target = loopbackTarget(env.COCKPIT_API_TARGET)
  return {
    plugins: [react(), tailwindcss()],
    server: {
      proxy: {
        '/api': { target, changeOrigin: true, ws: true },
      },
    },
  }
})
