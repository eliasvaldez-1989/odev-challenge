import { User } from './index';

declare global {
  namespace Express {
    interface Request {
      user?: User;
      requestId?: string;
      auditAction?: string;
      auditResourceType?: string;
      auditResourceId?: string | null;
    }
  }
}
