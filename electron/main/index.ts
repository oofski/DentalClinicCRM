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
  }
])

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
  protocol.handle('gsmodel', (request) => {
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
      return new Response(fs.readFileSync(full), {
        headers: { 'content-type': modelMimeFor(full) }
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
      return new Response(data, { headers: { 'content-type': mimeFor(filePath) } })
    } catch {
      return new Response('Error', { status: 500 })
    }
  })
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
    win.loadFile(INDEX_HTML)
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
    win.loadFile(INDEX_HTML, { hash: route })
  }
  return win
}

app.whenReady().then(async () => {
  registerMediaProtocol()
  registerModelProtocol()

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
