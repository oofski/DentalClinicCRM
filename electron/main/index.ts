import { app, BrowserWindow, protocol, Menu, shell, session } from 'electron'
import { join, relative, isAbsolute } from 'node:path'
import fs from 'node:fs'
import { initDatabase } from './db'
import { registerIpc, setKioskFactory } from './ipc'
import { isInsideDataDir } from './files'
import { stopKioskServer } from './kioskServer'
import { initUpdater } from './updater'

const RENDERER_URL = process.env['ELECTRON_RENDERER_URL']
const PRELOAD = join(__dirname, '../preload/index.js')
const INDEX_HTML = join(__dirname, '../renderer/index.html')

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'gsmedia',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  },
  {
    // Serves the bundled offline speech model + ONNX WebAssembly runtime to the
    // renderer. Read-only and confined to the app's own resources directory.
    scheme: 'gsmodel',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  },
  {
    // The renderer itself. A file:// page can never be cross-origin isolated, which
    // means no SharedArrayBuffer and therefore single-threaded model inference. Served
    // from a real origin with COOP/COEP we get isolation, and the Scribe's worker can
    // use several CPU threads instead of one.
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
  }
])

/** Headers that make the renderer cross-origin isolated. */
const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp'
}

function appMimeFor(p: string): string {
  if (p.endsWith('.html')) return 'text/html'
  if (p.endsWith('.js') || p.endsWith('.mjs')) return 'text/javascript'
  if (p.endsWith('.css')) return 'text/css'
  if (p.endsWith('.json')) return 'application/json'
  if (p.endsWith('.svg')) return 'image/svg+xml'
  if (p.endsWith('.wasm')) return 'application/wasm'
  if (p.endsWith('.png')) return 'image/png'
  if (p.endsWith('.woff2')) return 'font/woff2'
  return 'application/octet-stream'
}

function registerAppProtocol(): void {
  const root = join(__dirname, '../renderer')
  protocol.handle('app', async (request) => {
    try {
      const url = new URL(request.url)
      const rel = decodeURIComponent(url.pathname.replace(/^\//, '')) || 'index.html'
      const full = join(root, rel)
      const inside = relative(root, full)
      if (!inside || inside.startsWith('..') || isAbsolute(inside) || !fs.existsSync(full)) {
        return new Response('Not found', { status: 404 })
      }
      const data = await fs.promises.readFile(full)
      return new Response(data, {
        headers: {
          'content-type': appMimeFor(full),
          'content-length': String(data.byteLength),
          ...ISOLATION_HEADERS
        }
      })
    } catch {
      return new Response('Error', { status: 500 })
    }
  })
}

/** Directory holding the bundled speech model (packaged) or the repo copy (dev). */
function modelsDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'models')
    : join(app.getAppPath(), 'resources', 'models')
}

function modelMimeFor(p: string): string {
  if (p.endsWith('.json')) return 'application/json'
  if (p.endsWith('.wasm')) return 'application/wasm'
  if (p.endsWith('.onnx')) return 'application/octet-stream'
  return 'application/octet-stream'
}

function registerModelProtocol(): void {
  const root = modelsDir()
  protocol.handle('gsmodel', async (request) => {
    try {
      const url = new URL(request.url)
      // gsmodel://m/<relative path>
      const rel = decodeURIComponent(url.pathname.replace(/^\//, ''))
      const full = join(root, rel)
      // Never serve anything outside the models directory. Uses path.relative so the
      // check is correct on Windows (backslash separators) as well as POSIX.
      const inside = relative(root, full)
      if (!inside || inside.startsWith('..') || isAbsolute(inside) || !fs.existsSync(full)) {
        return new Response('Not found', { status: 404 })
      }
      // Async so a ~33 MB model read never blocks the main process (and with it every
      // window and IPC call). content-length makes the loading percentage meaningful.
      const data = await fs.promises.readFile(full)
      return new Response(data, {
        headers: {
          'content-type': modelMimeFor(full),
          'content-length': String(data.byteLength),
          // Under COEP: require-corp a cross-origin subresource is blocked unless it
          // opts in. Both headers are needed for fetch() from the isolated renderer.
          'Cross-Origin-Resource-Policy': 'cross-origin',
          'Access-Control-Allow-Origin': '*'
        }
      })
    } catch {
      return new Response('Error', { status: 500 })
    }
  })
}

function mimeFor(path: string): string {
  const ext = path.toLowerCase().split('.').pop() || ''
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    bmp: 'image/bmp',
    webp: 'image/webp',
    tif: 'image/tiff',
    tiff: 'image/tiff'
  }
  return map[ext] || 'application/octet-stream'
}

function registerMediaProtocol(): void {
  protocol.handle('gsmedia', (request) => {
    try {
      const url = new URL(request.url)
      const filePath = decodeURIComponent(url.pathname.replace(/^\//, ''))
      if (!isInsideDataDir(filePath) || !fs.existsSync(filePath)) {
        return new Response('Not found', { status: 404 })
      }
      const data = fs.readFileSync(filePath)
      return new Response(data, {
        headers: {
          'content-type': mimeFor(filePath),
          'Cross-Origin-Resource-Policy': 'cross-origin',
          'Access-Control-Allow-Origin': '*'
        }
      })
    } catch {
      return new Response('Error', { status: 500 })
    }
  })
}

/**
 * Load the packaged renderer over app:// so the page is cross-origin isolated. If that
 * ever fails, fall back to file:// — the app then runs exactly as it did before, with
 * single-threaded inference, rather than showing a blank window.
 */
function loadAppRoute(win: BrowserWindow, route?: string): void {
  const hash = route ? `#${route}` : ''
  let fellBack = false
  const fallback = () => {
    if (fellBack) return
    fellBack = true
    console.error('app:// failed to load; falling back to file://')
    if (route) win.loadFile(INDEX_HTML, { hash: route })
    else win.loadFile(INDEX_HTML)
  }
  win.webContents.once('did-fail-load', (_e, code, desc, url) => {
    if (url.startsWith('app://')) {
      console.error('app:// load failed', code, desc)
      fallback()
    }
  })
  win.loadURL(`app://gs/index.html${hash}`).catch(fallback)
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 1040,
    minHeight: 700,
    backgroundColor: '#F4F8FB',
    autoHideMenuBar: true,
    title: 'Giving Smiles',
    icon: join(__dirname, '../../resources/icon.png'),
    show: false,
    webPreferences: {
      preload: PRELOAD,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.once('ready-to-show', () => win.show())

  // Open external links in the system browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (RENDERER_URL) {
    win.loadURL(RENDERER_URL)
  } else {
    loadAppRoute(win)
  }
  return win
}

function createKioskWindow(mode = 'local'): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 820,
    backgroundColor: '#F4F8FB',
    autoHideMenuBar: true,
    title: 'Giving Smiles — Patient Check-In',
    icon: join(__dirname, '../../resources/icon.png'),
    show: false,
    webPreferences: {
      preload: PRELOAD,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.once('ready-to-show', () => {
    win.maximize()
    win.show()
  })
  const route = `/kiosk?mode=${encodeURIComponent(mode)}`
  if (RENDERER_URL) {
    win.loadURL(`${RENDERER_URL}#${route}`)
  } else {
    loadAppRoute(win, route)
  }
  return win
}

app.whenReady().then(async () => {
  registerMediaProtocol()
  registerModelProtocol()
  registerAppProtocol()

  // Allow the microphone for the Dental Scribe's built-in recorder (and nothing else).
  // Audio never leaves the computer — it is transcribed locally by the bundled model.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media')
  })
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media')

  await initDatabase()
  registerIpc()
  setKioskFactory(createKioskWindow)

  if (process.env.GS_SELFTEST === '1') {
    try {
      const { runSelfTest } = await import('./selftest')
      await runSelfTest(process.env.GS_SELFTEST_OUT || app.getPath('temp'))
    } catch (e) {
      console.error('SELFTEST_ERROR', e)
    }
    app.quit()
    return
  }

  // Hidden menu bar keeps standard edit shortcuts (copy/paste) working.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { role: 'toggleDevTools' }]
      }
    ])
  )

  createMainWindow()
  initUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  // During the self-test there is no main window; transient print windows must not quit the app.
  if (process.env.GS_SELFTEST === '1') return
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  stopKioskServer()
})
