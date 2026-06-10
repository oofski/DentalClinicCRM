import { app, BrowserWindow, protocol, Menu, shell } from 'electron'
import { join } from 'node:path'
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
  }
])

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

function createKioskWindow(): BrowserWindow {
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
  if (RENDERER_URL) {
    win.loadURL(`${RENDERER_URL}#/kiosk`)
  } else {
    win.loadFile(INDEX_HTML, { hash: '/kiosk' })
  }
  return win
}

app.whenReady().then(async () => {
  registerMediaProtocol()
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
