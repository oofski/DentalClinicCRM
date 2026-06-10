// Software auto-update via GitHub Releases (electron-updater).
//
// The packaged app checks this repo's Releases for a newer version: a silent check on
// startup, plus manual check / download / install from Settings → Software Updates.
// Updates need internet; on an offline clinic computer every check fails quietly and
// the app keeps working as normal.
import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '@shared/types'

let status: UpdateStatus = {
  state: app.isPackaged ? 'idle' : 'dev',
  currentVersion: app.getVersion()
}
let wired = false
let silentCheck = false

function broadcast(partial: Partial<UpdateStatus>): void {
  status = { ...status, ...partial, currentVersion: app.getVersion() }
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('updates:status', status)
  }
}

export function getUpdateStatus(): UpdateStatus {
  return status
}

function wire(): void {
  if (wired) return
  wired = true
  autoUpdater.autoDownload = false
  // If the user downloads but doesn't click "Restart & Install", apply on next quit.
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = null

  autoUpdater.on('checking-for-update', () =>
    broadcast({ state: 'checking', error: undefined, percent: undefined })
  )
  autoUpdater.on('update-available', (info) =>
    broadcast({
      state: 'available',
      availableVersion: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined
    })
  )
  autoUpdater.on('update-not-available', () => broadcast({ state: 'not-available' }))
  autoUpdater.on('download-progress', (p) =>
    broadcast({ state: 'downloading', percent: Math.round(p.percent) })
  )
  autoUpdater.on('update-downloaded', (info) =>
    broadcast({ state: 'downloaded', availableVersion: info.version, percent: 100 })
  )
  autoUpdater.on('error', (err) => {
    // The startup check must stay quiet when the clinic is offline.
    if (silentCheck) broadcast({ state: 'idle' })
    else broadcast({ state: 'error', error: err?.message || 'Update check failed' })
  })
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!app.isPackaged) return status
  wire()
  silentCheck = false
  try {
    await autoUpdater.checkForUpdates()
  } catch {
    /* reported via the error event */
  }
  return status
}

export async function downloadUpdate(): Promise<UpdateStatus> {
  if (!app.isPackaged) return status
  wire()
  silentCheck = false
  try {
    await autoUpdater.downloadUpdate()
  } catch {
    /* reported via the error event */
  }
  return status
}

export function quitAndInstall(): void {
  if (!app.isPackaged) return
  // Silent install into the existing location, then relaunch.
  autoUpdater.quitAndInstall(true, true)
}

export function initUpdater(): void {
  if (!app.isPackaged) return
  wire()
  // Quiet startup check a few seconds after launch (never blocks clinic work).
  setTimeout(() => {
    silentCheck = true
    autoUpdater.checkForUpdates().catch(() => {})
  }, 8000)
}
