import { describe, it, expect, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { auth } from '../../../src/middleware/auth';
import { makeAuthHeader, testUsers } from '../../helpers/factories';

function mockReq(headers: Record<string, string> = {}): Partial<Request> {
  return { headers };
}

function mockRes(): Partial<Response> {
  return {};
}

describe('auth middleware', () => {
  const middleware = auth();

  it('should decode a valid token and attach user to request', () => {
    const req = mockReq({ authorization: makeAuthHeader(testUsers.admin) }) as Request;
    const res = mockRes() as Response;
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toEqual(testUsers.admin);
  });

  it('should throw 401 when Authorization header is missing', () => {
    const req = mockReq() as Request;
    const res = mockRes() as Response;
    const next = vi.fn();

    expect(() => middleware(req, res, next)).toThrow('Missing or malformed Authorization header');
    expect(next).not.toHaveBeenCalled();
  });

  it('should throw 401 when Authorization header has wrong format', () => {
    const req = mockReq({ authorization: 'Basic abc123' }) as Request;
    const res = mockRes() as Response;
    const next = vi.fn();

    expect(() => middleware(req, res, next)).toThrow('Missing or malformed Authorization header');
  });

  it('should throw 401 for invalid base64', () => {
    const req = mockReq({ authorization: 'Bearer not-valid-base64!!!' }) as Request;
    const res = mockRes() as Response;
    const next = vi.fn();

    expect(() => middleware(req, res, next)).toThrow();
  });

  it('should throw 401 when token payload has wrong shape', () => {
    const badToken = Buffer.from(JSON.stringify({ id: 'not-a-uuid', role: 'hacker' })).toString('base64');
    const req = mockReq({ authorization: `Bearer ${badToken}` }) as Request;
    const res = mockRes() as Response;
    const next = vi.fn();

    expect(() => middleware(req, res, next)).toThrow('Invalid token payload');
  });

  it('should accept all valid roles', () => {
    for (const user of [testUsers.admin, testUsers.doctor1, testUsers.patient1]) {
      const req = mockReq({ authorization: makeAuthHeader(user) }) as Request;
      const res = mockRes() as Response;
      const next = vi.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toEqual(user);
    }
  });
});
