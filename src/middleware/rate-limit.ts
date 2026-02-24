import { Request, Response, NextFunction } from 'express';
import { Logger } from '../utils/logger';

interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
}

interface RequestRecord {
  timestamps: number[];
}

export function rateLimit(options: RateLimitOptions, logger: Logger) {
  const store = new Map<string, RequestRecord>();

  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, record] of store) {
      record.timestamps = record.timestamps.filter((t) => now - t < options.windowMs);
      if (record.timestamps.length === 0) {
        store.delete(key);
      }
    }
  }, options.windowMs);

  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();

    let record = store.get(key);
    if (!record) {
      record = { timestamps: [] };
      store.set(key, record);
    }

    record.timestamps = record.timestamps.filter((t) => now - t < options.windowMs);
    record.timestamps.push(now);

    res.setHeader('X-RateLimit-Limit', options.maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, options.maxRequests - record.timestamps.length));
    res.setHeader('X-RateLimit-Reset', Math.ceil((now + options.windowMs) / 1000));

    if (record.timestamps.length > options.maxRequests) {
      logger.warn({
        ip: key,
        requestCount: record.timestamps.length,
        windowMs: options.windowMs,
        requestId: req.requestId,
      }, 'Rate limit exceeded');

      return res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please try again later.',
          retryAfterMs: options.windowMs,
        },
      });
    }

    next();
  };
}
