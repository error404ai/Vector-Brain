import { createCipheriv, createDecipheriv, randomBytes, createHash, scrypt, timingSafeEqual } from 'crypto';
import CryptoJS from 'crypto-js';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

function scryptAsync(password: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, { ...opts, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export class CryptoHelper {
  private static readonly secretKey = process.env.SECRET_KEY || 'ourstoryz@secretKey123';
  private static readonly gcmAlgorithm = 'aes-256-gcm';
  private static readonly ivLength = 12;

  /**
   * Derive a 32-byte key for AES-256-GCM from the environment or secret key.
   */
  private static getDerivedKey(customSecret?: string): Buffer {
    const rawKey = customSecret || process.env.AI_ENCRYPTION_KEY || process.env.JWT_SECRET || this.secretKey;
    if (rawKey.length === 64 && /^[0-9a-fA-F]+$/.test(rawKey)) {
      return Buffer.from(rawKey, 'hex');
    }
    return createHash('sha256').update(rawKey).digest();
  }

  /**
   * Encrypts plaintext using AES-256-GCM.
   * Returns a serialized string: ivHex:authTagHex:ciphertextHex
   */
  static encryptAesGcm(plaintext: string, customSecret?: string): string {
    const key = this.getDerivedKey(customSecret);
    const iv = randomBytes(this.ivLength);
    const cipher = createCipheriv(this.gcmAlgorithm, key, iv);

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  /**
   * Decrypts a string produced by encryptAesGcm.
   */
  static decryptAesGcm(encryptedValue: string, customSecret?: string): string {
    const parts = encryptedValue.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted value format. Expected iv:authTag:ciphertext');
    }
    const [ivHex, authTagHex, ciphertextHex] = parts;
    const key = this.getDerivedKey(customSecret);
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const ciphertext = Buffer.from(ciphertextHex, 'hex');

    const decipher = createDecipheriv(this.gcmAlgorithm, key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  }

  static encryptText(data: string): string {
    const encryptedData = CryptoJS.AES.encrypt(data, this.secretKey).toString();
    return Buffer.from(encryptedData).toString('base64'); // Encode in Base64
  }

  static decryptText(encryptedText: string): string {
    const decodedData = Buffer.from(encryptedText, 'base64').toString('utf8'); // Decode from Base64
    const bytes = CryptoJS.AES.decrypt(decodedData, this.secretKey);
    return bytes.toString(CryptoJS.enc.Utf8);
  }

  static generateSecretHash(data: string, secret: string): string {
    const hmac = CryptoJS.HmacSHA256(data, secret);
    return hmac.toString(CryptoJS.enc.Base64);
  }

  /**
   * Legacy: a fast, unsalted SHA-256. Kept ONLY so passwords stored before the
   * scrypt switch can still be verified (and then upgraded). Never use it to
   * store a new password — use hashPassword.
   */
  static generateHash(data: string): string {
    const hash = CryptoJS.SHA256(data);
    return hash.toString(CryptoJS.enc.Base64);
  }

  /** Salted scrypt hash for storing a password: `scrypt$N$r$p$salt$hash`. */
  static async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    const key = await scryptAsync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
    return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${key.toString('base64')}`;
  }

  /**
   * Check a password against what is stored. Understands both the scrypt format
   * and the legacy SHA-256 one; `needsRehash` is true when it matched a legacy
   * hash, so the caller can upgrade it in place on a successful login.
   */
  static async verifyPassword(password: string, stored: string | null | undefined): Promise<{ ok: boolean; needsRehash: boolean }> {
    if (!stored) return { ok: false, needsRehash: false };
    if (stored.startsWith('scrypt$')) {
      const parts = stored.split('$');
      if (parts.length !== 6) return { ok: false, needsRehash: false };
      const [, n, r, p, saltB64, keyB64] = parts;
      const expected = Buffer.from(keyB64, 'base64');
      const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
      const ok = expected.length === actual.length && timingSafeEqual(expected, actual);
      return { ok, needsRehash: ok && (Number(n) < SCRYPT_N || expected.length < SCRYPT_KEYLEN) };
    }
    const legacy = Buffer.from(CryptoHelper.generateHash(password));
    const saved = Buffer.from(stored);
    const ok = legacy.length === saved.length && timingSafeEqual(legacy, saved);
    return { ok, needsRehash: ok };
  }

  /** SHA-256 hex of a token, for storing refresh tokens without keeping them in plaintext. */
  static hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}

