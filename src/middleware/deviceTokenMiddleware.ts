import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

export interface DeviceTokenPayload {
  deviceId: string;
  userId: number;
  type: string;
}

/**
 * Authenticates the Android companion app on plain HTTP routes.
 *
 * The dashboard uses @Authorized() with a user JWT; the companion has no user
 * session, only the permanent device token minted at pairing. The same token is
 * already accepted on the WebSocket upgrade in src/loaders/websocket.ts, so this
 * mirrors that check rather than inventing a second scheme.
 */
export const deviceTokenMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  if (!token) {
    return res.status(401).json({ success: false, message: 'Pair this device first' });
  }

  try {
    const secret = process.env.JWT_SECRET || 'vector-android-secret';
    const decoded = jwt.verify(token, secret) as any;

    if (decoded.type !== 'android_companion' || !decoded.deviceId) {
      return res.status(401).json({ success: false, message: 'Token is not an Android companion token' });
    }

    (req as any).deviceToken = {
      deviceId: String(decoded.deviceId),
      userId: Number(decoded.userId),
      type: String(decoded.type),
    } as DeviceTokenPayload;

    return next();
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired device token' });
  }
};
