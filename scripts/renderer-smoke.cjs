// Loads the built renderer in a hidden window and reports any console errors / crashes.
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

const errors = []
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(process.cwd(), 'out/preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 3) errors.push('ERROR: ' + message)
  })
  win.webContents.on('render-process-gone', (_e, d) => errors.push('GONE: ' + JSON.stringify(d)))

  if (process.env.SMOKE_FILE) {
    await win.loadFile(process.env.SMOKE_FILE)
  } else {
    const route = process.env.SMOKE_ROUTE || '/login'
    await win.loadFile(path.join(process.cwd(), 'out/renderer/index.html'), { hash: route })
  }
  await new Promise((r) => setTimeout(r, 2500))

  if (process.env.SMOKE_SHOT) {
    const img = await win.webContents.capturePage()
    fs.writeFileSync(process.env.SMOKE_SHOT, img.toPNG())
  }

  console.log('RENDERER_ERRORS:', errors.length)
  errors.slice(0, 20).forEach((e) => console.log(' -', e))
  console.log('RENDERER_SMOKE_DONE')
  app.quit()
})
