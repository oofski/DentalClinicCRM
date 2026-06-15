// Generates the bcrypt hash to embed in electron/main/license.ts as UNLOCK_HASH.
// Usage:  node scripts/make-unlock-hash.mjs "YOUR-UNLOCK-CODE"
// Only the printed hash goes in the repo — keep the code itself private.
import bcrypt from 'bcryptjs'

const code = process.argv[2]
if (!code) {
  console.error('Usage: node scripts/make-unlock-hash.mjs "YOUR-UNLOCK-CODE"')
  process.exit(1)
}
console.log(bcrypt.hashSync(code, 10))
