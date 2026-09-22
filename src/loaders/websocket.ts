import Logger from '@/logger/index';
import { AndroidGatewayService } from '@/services/android/AndroidGatewayService';
import http from 'http';
import jwt from 'jsonwebtoken';
import Container from 'typedi';
import { parse } from 'url';
import { WebSocketServer, WebSocket } from 'ws';

export function initializeWebSocketServer(server: http.Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  const gatewayService = Container.get(AndroidGatewayService);

  server.on('upgrade', (request, socket, head) => {
    const { pathname, query } = parse(request.url || '', true);

    if (pathname !== '/ws/android') {
      return; // Ignore other WebSocket routes if any
    }

    const token = query.token as string;
    const clientType = query.type as string; // 'device' or 'web'

    if (!token) {
      Logger.warn('[WebSocket] Upgrade rejected: Missing token');
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    try {
      const secret = process.env.JWT_SECRET || 'vector-android-secret';
      const decoded = jwt.verify(token, secret) as any;
      const resolvedClientType = clientType || (decoded.type === 'android_companion' ? 'device' : 'web');

      if (resolvedClientType === 'device' && (decoded.type !== 'android_companion' || !decoded.deviceId)) {
        throw new Error('Token is not an Android companion token');
      }
      if (resolvedClientType === 'web' && (!decoded.userId || decoded.type === 'android_companion')) {
        throw new Error('Token is not a web user token');
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        (ws as any).clientInfo = decoded;
        (ws as any).clientType = resolvedClientType;
        wss.emit('connection', ws, request);
      });
    } catch (err: any) {
      Logger.warn(`[WebSocket] Upgrade rejected: Invalid token (${err.message})`);
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
    }
  });

  wss.on('connection', (ws: WebSocket) => {
    const clientInfo = (ws as any).clientInfo;
    const clientType = (ws as any).clientType;

    Logger.info(`[WebSocket] Connected: type=${clientType}, info=${JSON.stringify(clientInfo)}`);

    if (clientType === 'web') {
      const userId = clientInfo.userId || clientInfo.id;
      if (userId) {
        gatewayService.registerWebClient(userId, ws);
      }
    }

    ws.on('message', (data) => {
      (ws as any).lastMessageAt = Date.now();
      const str = data.toString();
      if (clientType === 'device') {
        void gatewayService.handleDeviceMessage(ws, str, clientInfo.deviceId).catch((error) => {
          Logger.error('[WebSocket] Device message handler failed:', error);
        });
      }
    });

    ws.on('close', (code: number, reason: Buffer) => {
      if (clientType === 'device') {
        void gatewayService.handleDeviceDisconnect(ws, code, reason?.toString()).catch((error) => {
          Logger.error('[WebSocket] Device disconnect handler failed:', error);
        });
      }
    });

    ws.on('error', (error) => {
      Logger.error(`[WebSocket] Socket error:`, error);
    });
  });

  Logger.info('[WebSocket] WebSocket gateway initialized at /ws/android');
  return wss;
}
