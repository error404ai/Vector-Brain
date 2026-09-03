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
import { AiRuleController } from './controllers/AiRuleController';
import { AndroidAgentController } from './controllers/AndroidAgentController';

import { AndroidDeviceController } from './controllers/AndroidDeviceController';
import { AuthController } from './controllers/AuthController';
import { BrowserWorkerErrorController } from './controllers/BrowserWorkerErrorController';
import { DashboardController } from './controllers/DashboardController';
import { HealthController } from './controllers/HealthController';
import { PromptController } from './controllers/PromptController';
import { ScheduledTaskController } from './controllers/ScheduledTaskController';
import { SettingController } from './controllers/SettingController';
import { UserController } from './controllers/UserController';

import { authorizationChecker, currentUserChecker } from './middleware/authChecker';
import { AiEmbeddingService } from './services/AiEmbeddingService';
import { ScheduledTaskService } from './services/android/ScheduledTaskService';
import { initializeWebSocketServer } from './loaders/websocket';

dotenv.config();

class TypeDIAdapter implements IocAdapter {
  get<T>(someClass: { new (...args: any[]): T }): T {
    return Container.get<T>(someClass);
  }
}

useContainer(new TypeDIAdapter());

const app: express.Application = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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
    AndroidDeviceController,
    AuthController,
    BrowserWorkerErrorController,
    DashboardController,
    HealthController,
    PromptController,
    ScheduledTaskController,
    SettingController,
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
    } catch (error) {
      Logger.warn('Scheduled task runner failed to start:', error);
    }

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
