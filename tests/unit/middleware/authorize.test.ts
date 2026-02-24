import { describe, it, expect, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { authorize } from '../../../src/middleware/authorize';
import { testUsers } from '../../helpers/factories';

function mockReq(user?: any): Partial<Request> {
  return { user };
}

function mockRes(): Partial<Response> {
  return {};
}

describe('authorize middleware', () => {
  it('should pass when user has allowed role', () => {
    const middleware = authorize('admin', 'doctor');
    const req = mockReq(testUsers.doctor1) as Request;
    const next = vi.fn();

    middleware(req, mockRes() as Response, next);

    expect(next).toHaveBeenCalled();
  });

  it('should throw 403 when user role is not allowed', () => {
    const middleware = authorize('admin', 'doctor');
    const req = mockReq(testUsers.patient1) as Request;
    const next = vi.fn();

    expect(() => middleware(req, mockRes() as Response, next)).toThrow('Insufficient permissions');
    expect(next).not.toHaveBeenCalled();
  });

  it('should throw 401 when user is not set', () => {
    const middleware = authorize('admin');
    const req = mockReq() as Request;
    const next = vi.fn();

    expect(() => middleware(req, mockRes() as Response, next)).toThrow('Authentication required');
  });

  it('should allow admin for admin-only routes', () => {
    const middleware = authorize('admin');
    const req = mockReq(testUsers.admin) as Request;
    const next = vi.fn();

    middleware(req, mockRes() as Response, next);

    expect(next).toHaveBeenCalled();
  });

  it('should deny doctor for admin-only routes', () => {
    const middleware = authorize('admin');
    const req = mockReq(testUsers.doctor1) as Request;
    const next = vi.fn();

    expect(() => middleware(req, mockRes() as Response, next)).toThrow('Insufficient permissions');
  });
});
