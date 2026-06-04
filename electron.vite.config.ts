import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Inject a strict Content-Security-Policy into the production HTML only, so that
// `npm run dev` (Vite HMR + React Fast Refresh inline preamble) is not blocked.
function cspPlugin() {
  const csp =
    "default-src 'self'; img-src 'self' data: gsmedia:; style-src 'self' 'unsafe-inline'; " +
    "script-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'"
  return {
    name: 'inject-csp',
    apply: 'build' as const,
    transformIndexHtml(html: string) {
      return html.replace(
        '</head>',
        `  <meta http-equiv="Content-Security-Policy" content="${csp}" />\n  </head>`
      )
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('shared')
      }
    },
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: { index: resolve('electron/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: { index: resolve('electron/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: '.',
    resolve: {
      alias: {
        '@': resolve('src'),
        '@shared': resolve('shared')
      }
    },
    plugins: [react(), cspPlugin()],
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: { index: resolve('index.html') }
      }
    }
  }
})
