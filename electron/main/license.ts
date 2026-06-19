// Offline "unlock code" gate (no server).
//
// The app refuses to run until the shared unlock code is entered once per machine. We
// store only the bcrypt HASH of the code here — never the code itself — so the repo can
// stay public without revealing it. Verification is fully local/offline.
//
// To change the code: run  `node scripts/make-unlock-hash.mjs "YOUR-NEW-CODE"`  and paste
// the printed hash below, then release a new version.
import bcrypt from 'bcryptjs'
import { queryOne, execute } from './db'

const UNLOCK_HASH = '$2a$10$DH83yilcTShPnnoY7/zqO.A.iyaJa5gFEi1FaJPAhBJSdWW7qTfJe'

function storedCode(): string | null {
  const r = queryOne<{ value: string }>("SELECT value FROM app_settings WHERE key = 'unlock_code'")
  return r?.value ?? null
}

/** The activated unlock code (used to derive the USB check-in encryption key). */
export function getUnlockCode(): string | null {
  return storedCode()
}

/** True if this machine has already been unlocked with a code matching the current hash. */
export function isActivated(): boolean {
  const code = storedCode()
  if (!code) return false
  try {
    return bcrypt.compareSync(code, UNLOCK_HASH)
  } catch {
    return false
  }
}

/** Validate an entered code against the embedded hash and remember it on success. */
export function activate(code: string): { ok: boolean; error?: string } {
  const value = (code || '').trim()
  if (!value) return { ok: false, error: 'Please enter your unlock code' }
  if (!bcrypt.compareSync(value, UNLOCK_HASH)) {
    return { ok: false, error: 'Incorrect unlock code' }
  }
  execute(
    `INSERT INTO app_settings (key, value) VALUES ('unlock_code', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [value]
  )
  return { ok: true }
}
