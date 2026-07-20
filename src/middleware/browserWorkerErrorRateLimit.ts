import { NextFunction, Request, Response } from 'express';

const WINDOW_MS = 10 * 60 * 1000;
const MAX_BATCHES_PER_WINDOW = 30;
const clients = new Map<string, { count: number; resetAt: number }>();

function clientKey(req: Request) {
  const cloudflareIp = req.header('cf-connecting-ip');
  const forwardedIp = req.header('x-forwarded-for')?.split(',')[0]?.trim();
  return cloudflareIp || forwardedIp || req.ip || 'unknown';
}

export function browserWorkerErrorRateLimit(req: Request, res: Response, next: NextFunction) {
  const now = Date.now();
  const key = clientKey(req);
  const current = clients.get(key);

  if (!current || current.resetAt <= now) {
    clients.set(key, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    current.count += 1;
    if (current.count > MAX_BATCHES_PER_WINDOW) {
      res.setHeader('Retry-After', Math.ceil((current.resetAt - now) / 1000));
      return res.status(429).json({ status: false, message: 'Too many BrowserWorker error reports' });
    }
  }

  if (clients.size > 5_000) {
    for (const [client, entry] of clients) {
      if (entry.resetAt <= now) clients.delete(client);
    }
  }

  next();
}
