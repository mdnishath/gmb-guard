import { createHmac } from 'node:crypto';

/**
 * RFC 6238 TOTP (Google Authenticator compatible): 30-second step, 6 digits, SHA-1.
 */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Normalise a secret as pasted from Google ("u4bp exv6 idrt …") to upper-case base32. */
export function normalizeTotpSecret(input: string): string {
  return input.replace(/[\s-]/g, '').replace(/=+$/g, '').toUpperCase();
}

export function isValidTotpSecret(input: string): boolean {
  const s = normalizeTotpSecret(input);
  return s.length >= 16 && /^[A-Z2-7]+$/.test(s);
}

export function base32Decode(secret: string): Buffer {
  const s = normalizeTotpSecret(secret);
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of s) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error('Invalid base32 character in TOTP secret');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totpCode(secret: string, now = Date.now(), step = 30, digits = 6): { code: string; expiresIn: number; step: number } {
  const key = base32Decode(secret);
  const counter = Math.floor(now / 1000 / step);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', key).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  const code = String(bin % 10 ** digits).padStart(digits, '0');
  const expiresIn = step - (Math.floor(now / 1000) % step);
  return { code, expiresIn, step };
}
