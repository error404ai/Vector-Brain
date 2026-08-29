import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';
import CryptoJS from 'crypto-js';

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

  static generateHash(data: string): string {
    const hash = CryptoJS.SHA256(data);
    return hash.toString(CryptoJS.enc.Base64);
  }
}

