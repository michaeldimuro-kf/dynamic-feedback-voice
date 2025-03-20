import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/socket.io': {
        target: 'ws://localhost:3000',
        ws: true,
        changeOrigin: true,
      },
    },
    hmr: {
      overlay: true
    },
  },
  define: {
    // Ensure consistent socket.io path for both development and production
    'process.env.SOCKET_URL': JSON.stringify(''), // Empty string means same origin
    // Make debug flag available in client code
    '__DEBUG_WEBRTC__': JSON.stringify(true),
  }
})
