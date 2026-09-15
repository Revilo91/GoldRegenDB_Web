import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Aktuelle Version für die Sidebar-Anzeige. Priorität:
// 1. APP_VERSION (vom Docker-Build / CI aus dem Git-Tag gesetzt)
// 2. `git describe` im lokalen Checkout (z. B. "v0.1.17-47-g7527a58")
// 3. "dev" als Fallback, wenn kein Git verfügbar ist
function resolveAppVersion() {
  if (process.env.APP_VERSION) return process.env.APP_VERSION.trim()
  try {
    return execSync('git describe --tags --always --dirty', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim()
  } catch {
    return 'dev'
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  envDir: '..',
  define: {
    __APP_VERSION__: JSON.stringify(resolveAppVersion()),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setupTests.js',
    testTimeout: 10000,
  },
})
