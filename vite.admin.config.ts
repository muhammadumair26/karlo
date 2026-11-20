import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// The admin site (admin.orionsoftsol.com): its own page and sign-in, built separately from Karlo.
// Output: dist-admin/ with index.html, ready for its own GitHub Pages site.
const asIndex = (): Plugin => ({
  name: 'admin-as-index',
  apply: 'build',
  enforce: 'post',
  generateBundle(_, bundle) {
    const page = bundle['admin.html']
    if (page) page.fileName = 'index.html'
    this.emitFile({ type: 'asset', fileName: 'CNAME', source: 'admin.orionsoftsol.com\n' })
  },
})

export default defineConfig({
  plugins: [react(), asIndex()],
  define: { __BUILD_ID__: JSON.stringify(String(Date.now())) },
  base: '/',
  publicDir: false,
  build: { outDir: 'dist-admin', emptyOutDir: true, rollupOptions: { input: 'admin.html' } },
})
