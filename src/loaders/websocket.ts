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

      wss.handleUpgrade(request, socket, head, (ws) => {
        (ws as any).clientInfo = decoded;
        (ws as any).clientType = clientType || (decoded.deviceId ? 'device' : 'web');
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
    } else if (clientType === 'device') {
      const deviceId = clientInfo.deviceId;
      if (deviceId) {
        gatewayService.registerDevice(deviceId, ws, clientInfo);
      }
    }

    ws.on('message', (data) => {
      const str = data.toString();
      if (clientType === 'device') {
        gatewayService.handleDeviceMessage(ws, str);
      }
    });

    ws.on('close', () => {
      if (clientType === 'device') {
        gatewayService.handleDeviceDisconnect(ws);
      }
    });

    ws.on('error', (error) => {
      Logger.error(`[WebSocket] Socket error:`, error);
    });
  });

  Logger.info('[WebSocket] WebSocket gateway initialized at /ws/android');
  return wss;
}
