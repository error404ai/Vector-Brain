import dotenv from 'dotenv';
import express from 'express';
import http from 'http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'reflect-metadata';

// CRITICAL: Import requestContext BEFORE any other imports that use Container
import './middleware/requestContext';

import type { IocAdapter } from 'routing-controllers';
import { useContainer, useExpressServer } from 'routing-controllers';
import Container from 'typedi';
import { AppDataSource } from './loaders/database';
import Logger from './logger/index';
import { GlobalErrorHandler } from './middleware/errorHandler.middleware';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Controllers - Add your controllers here
import { HealthController } from './controllers/HealthController';
import { UserController } from './controllers/UserController';

dotenv.config();

class TypeDIAdapter implements IocAdapter {
  get<T>(someClass: { new (...args: any[]): T }): T {
    return Container.get<T>(someClass);
  }
}

useContainer(new TypeDIAdapter());

const app: express.Application = express();

// Body parser middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static files
app.use(express.static(join(__dirname, '..', 'public')));

// Initialize routing-controllers
useExpressServer(app, {
  routePrefix: '/api',
  controllers: [
    // Add your controllers here
    HealthController,
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
    origin: true,
    credentials: true,
  },
});

// Create HTTP server
const server = http.createServer(app);

// Database connection and server start
AppDataSource.initialize()
  .then(() => {
    Logger.info('Database connected successfully');

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
