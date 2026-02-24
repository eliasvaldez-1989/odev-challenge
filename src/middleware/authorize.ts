import { Request, Response, NextFunction } from 'express';
import { Role } from '../types';
import { AuthenticationError, AuthorizationError } from '../errors';

export function authorize(...allowedRoles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      throw new AuthenticationError();
    }
    if (!allowedRoles.includes(req.user.role)) {
      throw new AuthorizationError();
    }
    next();
  };
}
