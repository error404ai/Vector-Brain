import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import express from 'express';
import http from 'http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'reflect-metadata';

// CRITICAL: Import requestContext BEFORE any other imports that use Container
import { requestContextMiddleware } from './middleware/requestContext';

import type { IocAdapter } from 'routing-controllers';
import { useContainer, useExpressServer } from 'routing-controllers';
import Container from 'typedi';
import { AppDataSource } from './loaders/database';
import Logger from './logger/index';
import { GlobalErrorHandler } from './middleware/errorHandler.middleware';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Controllers - Add your controllers here
import { AgentTaskController } from './controllers/AgentTaskController';
import { AiConfigController } from './controllers/AiConfigController';
import { MaintenanceController } from './controllers/MaintenanceController';
import { AiRuleController } from './controllers/AiRuleController';
import { AndroidAgentController } from './controllers/AndroidAgentController';

import { AndroidCompanionController } from './controllers/AndroidCompanionController';
import { AndroidDeviceController } from './controllers/AndroidDeviceController';
import { AndroidFileController } from './controllers/AndroidFileController';
import { AuthController } from './controllers/AuthController';
import { BrowserWorkerErrorController } from './controllers/BrowserWorkerErrorController';
import { DashboardController } from './controllers/DashboardController';
import { HealthController } from './controllers/HealthController';
import { PromptController } from './controllers/PromptController';
import { FlowController } from './controllers/FlowController';
import { MissionController } from './controllers/MissionController';
import { CommandChatController } from './controllers/CommandChatController';
import { ScheduledTaskController } from './controllers/ScheduledTaskController';
import { DeviceProxyController } from './controllers/DeviceProxyController';
import { SettingController } from './controllers/SettingController';
import { TelegramController } from './controllers/TelegramController';
import { UserController } from './controllers/UserController';

import { authorizationChecker, currentUserChecker } from './middleware/authChecker';
import { AiEmbeddingService } from './services/AiEmbeddingService';
import { HistoryCleanupService } from './services/android/HistoryCleanupService';
import { ScheduledTaskService } from './services/android/ScheduledTaskService';
import { MissionService } from './services/android/MissionService';
import { TelegramService } from './services/telegram/TelegramService';
import { initializeWebSocketServer } from './loaders/websocket';

dotenv.config();

class TypeDIAdapter implements IocAdapter {
  get<T>(someClass: { new (...args: any[]): T }): T {
    return Container.get<T>(someClass);
  }
}

useContainer(new TypeDIAdapter());

const app: express.Application = express();

// Raw binary body for chunked file uploads (APK auto-update). Scoped to the
// chunk route and octet-stream only, so every other route still parses as JSON.
// Registered before express.json so the raw parser claims the body first.
app.use(
  '/api/android/files/chunk',
  express.raw({ type: 'application/octet-stream', limit: '12mb' }),
);

// Small-file base64 uploads legitimately post large JSON, so that route keeps a
// high ceiling; every other route (parsed before auth) is capped low so an
// unauthenticated caller can't make the server buffer tens of megabytes.
app.use('/api/android/files', express.json({ limit: '50mb' }));
app.use('/api/android/files', express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

app.use(cookieParser());
// app.use((req, res, next) => {
//   setTimeout(() => next(), 1000);
// });

app.use(requestContextMiddleware);

useExpressServer(app, {
  routePrefix: '/api',
  controllers: [
    AgentTaskController,
    AiConfigController,
    AiRuleController,
    AndroidAgentController,
    AndroidCompanionController,
    AndroidDeviceController,
    AndroidFileController,
    AuthController,
    BrowserWorkerErrorController,
    DashboardController,
    HealthController,
    MaintenanceController,
    FlowController,
    MissionController,
    CommandChatController,
    PromptController,
    ScheduledTaskController,
    DeviceProxyController,
    SettingController,
    TelegramController,
    UserController,
  ],

  middlewares: [GlobalErrorHandler],
  defaultErrorHandler: false,
  validation: {
    whitelist: true,
    forbidNonWhitelisted: true,
  },
  classTransformer: true,
  cors: {
    origin: ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:5123', 'https://app.vectoragent.in', 'https://app.vectoragent.io', /^chrome-extension:\/\//, /^moz-extension:\/\//],
    credentials: true,
  },
  authorizationChecker,
  currentUserChecker,
});

app.use(express.static(join(__dirname, '..', 'public')));

app.get('*', (req, res, next) => {
  if (res.headersSent) {
    return next();
  }
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ message: 'API endpoint not found' });
  }
  res.sendFile(join(__dirname, '..', 'public', 'index.html'));
});

/** Minimal escaping for values placed inside meta tag attributes. */

const server = http.createServer(app);

// Initialize real-time WebSocket Gateway for Android Companion & Web Live View
initializeWebSocketServer(server);

AppDataSource.initialize()
  .then(async () => {
    Logger.info('Database connected successfully');

    // Initialize AI Embedding Service (Qdrant collection)
    try {
      const aiEmbeddingService = Container.get(AiEmbeddingService);
      await aiEmbeddingService.initialize();
      Logger.info('AI Embedding Service initialized successfully');
    } catch (error) {
      Logger.warn('AI Embedding Service initialization failed (vector operations may be unavailable):', error);
      // Don't fail app startup if embedding service fails
    }

    // Recurring user schedules. Started after the database is up because the
    // runner queries on every tick.
    try {
      Container.get(ScheduledTaskService).start();
      Container.get(HistoryCleanupService).start();
      Container.get(MissionService).start();
    } catch (error) {
      Logger.warn('Scheduled task runner failed to start:', error);
    }

    // Telegram bot: registers its webhook. Optional, and never blocks startup.
    Container.get(TelegramService)
      .start()
      .catch((error) => Logger.warn('Telegram bot failed to start:', error));

    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
      Logger.info(`Server is running on port ${PORT}`);
      Logger.info(`API available at http://localhost:${PORT}/api`);
    });
  })
  .catch((error) => {
    Logger.error('Database connection failed:', error);
    process.exit(1);
  });

export { app, server };
