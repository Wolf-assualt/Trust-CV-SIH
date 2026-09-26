import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const isTest = mode === 'test'
  return {
    plugins: [react()],
    test: isTest ? {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      css: true,
      include: ['src/**/*.test.tsx', 'src/**/*.test.ts'],
      exclude: ['node_modules', 'dist'],
    } : undefined,
    server: {
      port: 5173,
      host: true,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
          secure: false,
        }
      }
    }
  }
})
