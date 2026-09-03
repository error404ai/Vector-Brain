import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import express from 'express';
import http from 'http';
import { readFile } from 'node:fs/promises';
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
import { PublicRunController, RunShareController } from './controllers/RunShareController';
import { RunMediaService } from './services/android/RunMediaService';
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
    PublicRunController,
    RunShareController,
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

/**
 * Rendered media for shared runs.
 *
 * These sit outside the API prefix and outside routing-controllers because they
 * stream binary files, and because link crawlers fetch them directly.
 */
app.get('/media/runs/:token.jpg', async (req, res) => {
  try {
    const path = await Container.get(RunMediaService).getPreviewPath(String(req.params.token));
    if (!path) return res.status(404).end();
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.sendFile(path);
  } catch {
    return res.status(500).end();
  }
});

/**
 * Shared-run page with server-rendered link previews.
 *
 * WhatsApp, Twitter and friends never run the app's JavaScript, so the meta
 * tags have to be in the HTML that comes back from the server. The React app
 * still boots afterwards and takes over as usual.
 */
app.get('/r/:token', async (req, res, next) => {
  try {
    const token = String(req.params.token);
    const meta = await Container.get(RunMediaService).getMeta(token);
    if (!meta) return next();

    const indexPath = join(__dirname, '..', 'public', 'index.html');
    const html = await readFile(indexPath, 'utf8');

    // Behind Coolify's proxy the app is reached over plain http, so req.protocol
    // reports http while the public URL is https. Scrapers compare og:url with
    // the URL they fetched, so the forwarded scheme is the one to trust.
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    const scheme = forwardedProto || req.protocol;
    const origin = `${scheme}://${req.get('host')}`;
    const title = `"${meta.prompt}" — done by an AI on a real phone`;
    const description = `An AI agent completed this in ${meta.steps} steps on a real Android device. Watch the replay.`;
    const image = `${origin}/media/runs/${token}.jpg`;

    const tags = [
      `<title>${escapeHtml(title)}</title>`,
      `<meta name="description" content="${escapeHtml(description)}" />`,
      `<meta property="og:type" content="website" />`,
      `<meta property="og:title" content="${escapeHtml(title)}" />`,
      `<meta property="og:description" content="${escapeHtml(description)}" />`,
      `<meta property="og:image" content="${image}" />`,
      `<meta property="og:image:width" content="1200" />`,
      `<meta property="og:image:height" content="630" />`,
      `<meta property="og:url" content="${origin}/r/${token}" />`,
      `<meta name="twitter:card" content="summary_large_image" />`,
      `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
      `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
      `<meta name="twitter:image" content="${image}" />`,
    ].join('\n    ');

    // Replace the build's own <title> so crawlers do not see two.
    const injected = html.replace(/<title>.*?<\/title>/i, '').replace('</head>', `    ${tags}\n  </head>`);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(injected);
  } catch {
    return next();
  }
});

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
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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
