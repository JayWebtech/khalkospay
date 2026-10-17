import { randomBytes } from 'node:crypto'
import 'dotenv/config'
import { prisma } from '../lib/prisma'
import { MIN_PASSWORD_LENGTH, upsertAdmin } from '../services/admin-auth'

/**
 * Creates the admin dashboard login, or resets its password when the email already exists.
 *
 *   ADMIN_EMAIL     defaults to admin@khalkospay.local
 *   ADMIN_PASSWORD  at least 12 characters; when empty, a random one is generated and printed once
 *   ADMIN_NAME      optional display name
 *
 * Only runs against a database on this machine unless --allow-remote is passed.
 */

const DEFAULT_EMAIL = 'admin@khalkospay.local'
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

async function main() {
  const url = process.env.DATABASE_URL ?? ''
  let host = ''
  try {
    host = new URL(url).hostname
  } catch {
    throw new Error('DATABASE_URL is missing or not a URL')
  }
  if (!LOCAL_HOSTS.has(host) && !process.argv.includes('--allow-remote')) {
    throw new Error(`DATABASE_URL points at ${host}, not this machine. Pass --allow-remote if you really mean to create an admin there.`)
  }

  const email = process.env.ADMIN_EMAIL?.trim() || DEFAULT_EMAIL
  const generated = !process.env.ADMIN_PASSWORD
  const password = process.env.ADMIN_PASSWORD || randomBytes(18).toString('base64url')
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`)

  const { created, admin } = await upsertAdmin({ email, password, name: process.env.ADMIN_NAME?.trim() || undefined })
  console.log(`${created ? 'Created' : 'Reset the password of'} admin ${admin.email} in ${host}${created ? '' : ' (its open sessions were signed out)'}`)
  if (generated) {
    console.log(`ADMIN_PASSWORD=${password}`)
    console.log('# Generated because ADMIN_PASSWORD was empty. It is shown only this once; save it in a password manager or server/.env.')
  }
  console.log('Sign in at /admin on the web app (e.g. http://localhost:5173/admin).')
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
