import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { databasePath } from './db-path';

/**
 * AES-256-GCM encryption for secrets stored in SQLite (account passwords,
 * TOTP secrets). The key comes from APP_SECRET; when that is not set a random
 * key is generated once and kept next to the database (data/app-secret.key),
 * so the app works with zero configuration. Back that file up with the DB —
 * without it the stored secrets cannot be read.
 */

const PREFIX = 'enc:v1:';
let cachedKey: Buffer | null = null;

function keyFilePath(): string {
  return resolve(dirname(databasePath()), 'app-secret.key');
}

function loadKey(): Buffer {
  if (cachedKey) return cachedKey;
  const env = process.env.APP_SECRET?.trim();
  if (env) {
    cachedKey = createHash('sha256').update(env).digest();
    return cachedKey;
  }
  const file = keyFilePath();
  if (existsSync(file)) {
    const hex = readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{64}$/i.test(hex)) {
      cachedKey = Buffer.from(hex, 'hex');
      return cachedKey;
    }
  }
  mkdirSync(dirname(file), { recursive: true });
  const fresh = randomBytes(32);
  writeFileSync(file, fresh.toString('hex') + '\n', { mode: 0o600 });
  console.info(`[crypto] generated new encryption key at ${file} — back it up together with the database`);
  cachedKey = fresh;
  return cachedKey;
}

/** Hex of the raw key material (used to derive the session-signing secret). */
export function getAppSecretHex(): string {
  return loadKey().toString('hex');
}

/** Path of the generated key file (for the backup download). */
export function appSecretKeyPath(): string {
  return keyFilePath();
}

export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', loadKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decrypt(value: string): string {
  if (!isEncrypted(value)) return value; // legacy plaintext
  const buf = Buffer.from(value.slice(PREFIX.length), 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', loadKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/** Decrypt, returning null when the key does not match (e.g. key file lost). */
export function tryDecrypt(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return decrypt(value);
  } catch {
    return null;
  }
}
