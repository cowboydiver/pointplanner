import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // Served from https://cowboydiver.github.io/pointplanner/ on GitHub Pages,
  // so production assets need the repo-name base. Dev stays at root.
  base: command === 'build' ? '/pointplanner/' : '/',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
  },
}))
