import { join, resolve, sep } from 'node:path'
import fs from 'node:fs'
import { dataDir } from './db'

function safe(name: string): string {
  return name.replace(/[^a-z0-9_\-.]/gi, '_')
}

export interface PatientDirs {
  base: string
  consents: string
  reports: string
  referrals: string
  images: string
}

export function patientDirs(patientCode: string): PatientDirs {
  const base = join(dataDir(), 'PatientFiles', safe(patientCode || 'unknown'))
  const dirs: PatientDirs = {
    base,
    consents: join(base, 'Consents'),
    reports: join(base, 'Reports'),
    referrals: join(base, 'Referrals'),
    images: join(base, 'Images')
  }
  for (const d of [dirs.base, dirs.consents, dirs.reports, dirs.referrals, dirs.images]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })
  }
  return dirs
}

export function writeFileBuffer(dir: string, filename: string, buf: Buffer | Uint8Array): string {
  const p = join(dir, safe(filename))
  fs.writeFileSync(p, buf)
  return p
}

export function copyInto(dir: string, sourcePath: string, filename: string): string {
  const p = join(dir, safe(filename))
  fs.copyFileSync(sourcePath, p)
  return p
}

export function timestampName(prefix: string, ext: string): string {
  const s = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return `${prefix}_${s}.${ext}`
}

export function isInsideDataDir(filePath: string): boolean {
  const root = join(dataDir(), 'PatientFiles')
  const resolved = resolve(filePath)
  return resolved === root || resolved.startsWith(root + sep)
}
