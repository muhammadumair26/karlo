import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// One id per build. The app compares it with /version.json to pick up a new release straight away
// (GitHub Pages lets browsers and the phone apps reuse index.html for 10 minutes).
const BUILD_ID = String(Date.now())

const versionFile = (): Plugin => ({
  name: 'karlo-version-file',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ id: BUILD_ID }) })
  },
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), versionFile()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  // Served from the root of https://karlo.orionsoftsol.com (custom domain on GitHub Pages)
  base: '/',
})
