import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { rateLimit } from '../../../src/middleware/rate-limit';
import pino from 'pino';

const logger = pino({ level: 'silent' });

function mockReq(ip = '127.0.0.1'): Partial<Request> {
  return {
    ip,
    socket: { remoteAddress: ip } as any,
    requestId: 'test-req-id',
  };
}

function mockRes(): Partial<Response> & { _status?: number; _body?: any } {
  const res: any = {
    _headers: {} as Record<string, any>,
    setHeader(name: string, value: any) { res._headers[name] = value; return res; },
    status(code: number) { res._status = code; return res; },
    json(body: any) { res._body = body; return res; },
  };
  return res;
}

describe('rateLimit middleware', () => {
  it('should allow requests within the limit', () => {
    const middleware = rateLimit({ windowMs: 60000, maxRequests: 5 }, logger);
    const req = mockReq() as Request;
    const res = mockRes() as Response;
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect((res as any)._headers['X-RateLimit-Limit']).toBe(5);
    expect((res as any)._headers['X-RateLimit-Remaining']).toBe(4);
  });

  it('should return 429 when limit is exceeded', () => {
    const middleware = rateLimit({ windowMs: 60000, maxRequests: 3 }, logger);
    const res = mockRes();
    const next = vi.fn();

    for (let i = 0; i < 3; i++) {
      const r = mockRes();
      const n = vi.fn();
      middleware(mockReq() as Request, r as Response, n);
      expect(n).toHaveBeenCalled();
    }

    middleware(mockReq() as Request, res as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(429);
    expect(res._body?.error?.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('should track different IPs separately', () => {
    const middleware = rateLimit({ windowMs: 60000, maxRequests: 2 }, logger);

    for (let i = 0; i < 2; i++) {
      const n = vi.fn();
      middleware(mockReq('1.1.1.1') as Request, mockRes() as Response, n);
      expect(n).toHaveBeenCalled();
    }

    const next1 = vi.fn();
    middleware(mockReq('1.1.1.1') as Request, mockRes() as Response, next1);
    expect(next1).not.toHaveBeenCalled();

    const next2 = vi.fn();
    middleware(mockReq('2.2.2.2') as Request, mockRes() as Response, next2);
    expect(next2).toHaveBeenCalled();
  });

  it('should set standard rate limit headers', () => {
    const middleware = rateLimit({ windowMs: 60000, maxRequests: 10 }, logger);
    const res = mockRes();
    const next = vi.fn();

    middleware(mockReq() as Request, res as Response, next);

    expect((res as any)._headers['X-RateLimit-Limit']).toBe(10);
    expect((res as any)._headers['X-RateLimit-Remaining']).toBe(9);
    expect((res as any)._headers['X-RateLimit-Reset']).toBeDefined();
  });
});
