import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Inject a strict Content-Security-Policy into the production HTML only, so that
// `npm run dev` (Vite HMR + React Fast Refresh inline preamble) is not blocked.
function cspPlugin() {
  const csp =
    "default-src 'self'; " +
    // The offline speech model + ONNX runtime are fetched from the app's own
    // gsmodel:// protocol; without this they fall back to default-src and are blocked.
    "connect-src 'self' gsmodel:; " +
    "img-src 'self' data: gsmedia:; style-src 'self' 'unsafe-inline'; " +
    // 'wasm-unsafe-eval' is required for onnxruntime-web to compile the speech model.
    // It permits WebAssembly compilation only — it does NOT enable eval() of JavaScript.
    "script-src 'self' 'wasm-unsafe-eval'; " +
    // The Scribe runs its models on a Worker so inference cannot freeze the window.
    "worker-src 'self' blob:; " +
    "object-src 'none'; base-uri 'self'; form-action 'none'"
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
