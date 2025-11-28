export class DateHelper {
  static calculateExpirationDate(expiresInSeconds: number): Date {
    return new Date(Date.now() + expiresInSeconds * 1000);
  }
}
