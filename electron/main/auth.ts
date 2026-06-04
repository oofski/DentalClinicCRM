import bcrypt from 'bcryptjs'
import { Users } from './repositories'
import type { AuthResult } from '@shared/types'

export function hashPassword(pw: string): string {
  return bcrypt.hashSync(pw, 10)
}

export function verifyLogin(username: string, password: string): AuthResult {
  const raw = Users.getRawByUsername((username || '').trim())
  if (!raw) return { ok: false, error: 'Invalid username or password' }
  if (!bcrypt.compareSync(password, raw.password_hash)) {
    return { ok: false, error: 'Invalid username or password' }
  }
  return {
    ok: true,
    user: {
      id: Number(raw.id),
      username: raw.username,
      full_name: raw.full_name,
      role: raw.role,
      created_at: raw.created_at
    }
  }
}

export function changePassword(
  userId: number,
  oldPw: string,
  newPw: string
): { ok: boolean; error?: string } {
  const u = Users.getById(userId)
  if (!u) return { ok: false, error: 'User not found' }
  const raw = Users.getRawByUsername(u.username)
  if (!raw || !bcrypt.compareSync(oldPw, raw.password_hash)) {
    return { ok: false, error: 'Current password is incorrect' }
  }
  if (!newPw || newPw.length < 6) {
    return { ok: false, error: 'New password must be at least 6 characters' }
  }
  Users.updatePassword(userId, hashPassword(newPw))
  return { ok: true }
}
