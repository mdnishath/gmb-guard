import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Make sure the session-signing secret exists before the server starts, so the
 * Edge middleware (which cannot read files) can verify cookies via
 * process.env.SESSION_SECRET. Same key file lib/crypto.ts uses for encryption.
 */
function ensureSessionSecret() {
  if (process.env.SESSION_SECRET) return;
  if (process.env.APP_SECRET) {
    process.env.SESSION_SECRET = process.env.APP_SECRET;
    return;
  }
  try {
    const dbPath = resolve(process.cwd(), process.env.DATABASE_PATH?.trim() || './data/gmb.sqlite');
    const file = resolve(dirname(dbPath), 'app-secret.key');
    let hex = existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
    if (!/^[0-9a-f]{64}$/i.test(hex)) {
      mkdirSync(dirname(file), { recursive: true });
      hex = randomBytes(32).toString('hex');
      writeFileSync(file, hex + '\n', { mode: 0o600 });
      console.info(`[config] generated encryption/session key at ${file} — back it up with the database`);
    }
    process.env.SESSION_SECRET = hex;
  } catch (err) {
    console.error('[config] could not prepare SESSION_SECRET:', err);
  }
}
ensureSessionSecret();

/** @type {import('next').NextConfig} */
const nextConfig = {
  // better-sqlite3 is a native module; keep it out of the bundler.
  serverExternalPackages: ['better-sqlite3'],
};

export default nextConfig;
