import { shell } from 'electron'
import nodemailer from 'nodemailer'
import { Settings } from './repositories'

export interface EmailInput {
  to: string
  subject: string
  text: string
  attachmentPath: string
}

export interface EmailResult {
  ok: boolean
  method: 'smtp' | 'mailto'
  error?: string
}

/**
 * Emails a PDF. If SMTP is configured in Settings the file is sent directly with the
 * attachment. Otherwise (offline-first default) we open the user's mail client with a
 * pre-filled message and reveal the PDF in the file explorer so they can attach it.
 */
export async function emailPdf(input: EmailInput): Promise<EmailResult> {
  const s = Settings.getAll()

  if (s.smtp_host.trim() && s.smtp_user.trim()) {
    try {
      const transporter = nodemailer.createTransport({
        host: s.smtp_host,
        port: Number(s.smtp_port) || 587,
        secure: s.smtp_secure,
        auth: { user: s.smtp_user, pass: s.smtp_pass }
      })
      await transporter.sendMail({
        from: s.smtp_from || s.smtp_user,
        to: input.to,
        subject: input.subject,
        text: input.text,
        attachments: [{ path: input.attachmentPath }]
      })
      return { ok: true, method: 'smtp' }
    } catch (e) {
      // Fall back to mailto so the user is never blocked.
      const err = e instanceof Error ? e.message : String(e)
      await openMailto(input)
      return { ok: true, method: 'mailto', error: `SMTP failed (${err}); opened mail client instead.` }
    }
  }

  await openMailto(input)
  return { ok: true, method: 'mailto' }
}

async function openMailto(input: EmailInput): Promise<void> {
  const body = `${input.text}\n\n(Please attach the report PDF that has been opened in your file explorer.)`
  const mailto = `mailto:${encodeURIComponent(input.to || '')}?subject=${encodeURIComponent(
    input.subject
  )}&body=${encodeURIComponent(body)}`
  await shell.openExternal(mailto)
  shell.showItemInFolder(input.attachmentPath)
}
