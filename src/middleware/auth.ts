import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthenticationError } from '../errors';

const userTokenSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(['admin', 'doctor', 'patient']),
});

export function auth() {
  return (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new AuthenticationError('Missing or malformed Authorization header');
    }

    const token = header.slice(7);
    let decoded: unknown;
    try {
      decoded = JSON.parse(Buffer.from(token, 'base64').toString('utf-8'));
    } catch {
      throw new AuthenticationError('Invalid token encoding');
    }

    const result = userTokenSchema.safeParse(decoded);
    if (!result.success) {
      throw new AuthenticationError('Invalid token payload');
    }

    req.user = result.data;
    next();
  };
}
