import { BrowserWindow } from 'electron'

function dataUrl(html: string): string {
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html)
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Render an off-screen document and run an action against it. Creating a fresh window
 * back-to-back can transiently fail with ERR_FAILED, so we retry the whole create+load.
 */
async function withWindow<T>(html: string, action: (win: BrowserWindow) => Promise<T>): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    const win = new BrowserWindow({
      show: false,
      width: 850,
      height: 1100,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    try {
      await win.loadURL(dataUrl(html))
      await delay(180) // let layout / SVG settle
      const result = await action(win)
      if (!win.isDestroyed()) win.destroy()
      return result
    } catch (e) {
      lastErr = e
      if (!win.isDestroyed()) win.destroy()
      await delay(150)
    }
  }
  throw lastErr
}

/** Render an HTML document to a PDF buffer (for saving / emailing). */
export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  return withWindow(html, (win) =>
    win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      generateTaggedPDF: false
    })
  )
}

/** Open the OS print dialog for an HTML document (physical printing). */
export async function printHtml(html: string): Promise<{ ok: boolean; error?: string }> {
  return withWindow(
    html,
    (win) =>
      new Promise<{ ok: boolean; error?: string }>((resolve) => {
        win.webContents.print({ silent: false, printBackground: true }, (success, failureReason) => {
          resolve({ ok: success, error: success ? undefined : failureReason })
        })
      })
  )
}
