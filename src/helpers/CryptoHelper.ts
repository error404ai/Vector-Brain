import CryptoJS from 'crypto-js';

export class CryptoHelper {
  private static readonly secretKey = process.env.SECRET_KEY || 'ourstoryz@secretKey123';

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
