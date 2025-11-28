import jwt from 'jsonwebtoken';
import envConfig from '../config/envConfig';

interface JwtPayload {
  [key: string]: any;
}

export class JwtHelper {
  static generateToken(payload: JwtPayload, expiresIn = '1h'): string {
    if (!envConfig.jwtSecret) {
      throw new Error('JWT_SECRET is not configured in environment variables');
    }

    return (jwt.sign as any)(payload, envConfig.jwtSecret!, { expiresIn });
  }

  static verifyToken(token: string): JwtPayload | null {
    if (!envConfig.jwtSecret) {
      throw new Error('JWT_SECRET is not configured in environment variables');
    }

    try {
      return jwt.verify(token, envConfig.jwtSecret) as JwtPayload;
    } catch (error) {
      console.error('JWT verification error:', error);
      return null;
    }
  }
}
