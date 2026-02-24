import { Request, Response, NextFunction } from 'express';
import { Knex } from 'knex';
import { Logger } from '../utils/logger';

export function auditLog(db: Knex, logger: Logger) {
  return (req: Request, res: Response, next: NextFunction) => {
    res.on('finish', () => {
      if (!req.user || !req.auditAction) return;

      const entry = {
        user_id: req.user.id,
        user_role: req.user.role,
        action: req.auditAction,
        resource_type: req.auditResourceType || 'document',
        resource_id: req.auditResourceId || null,
        request_id: req.requestId || 'unknown',
        ip_address: req.ip || null,
        status_code: res.statusCode,
      };

      db('audit_logs')
        .insert(entry)
        .catch((err) => {
          logger.error({ err, entry }, 'Failed to write audit log');
        });
    });

    next();
  };
}
