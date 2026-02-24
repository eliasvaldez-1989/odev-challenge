import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors';
import { Logger } from '../utils/logger';

export function errorHandler(logger: Logger) {
  return (err: Error, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      logger.warn({
        requestId: req.requestId,
        error: err.code,
        statusCode: err.statusCode,
        message: err.message,
      }, 'Application error');

      return res.status(err.statusCode).json({
        error: {
          code: err.code,
          message: err.message,
          ...((err as any).details && { details: (err as any).details }),
        },
      });
    }

    logger.error({
      requestId: req.requestId,
      error: err.message,
      stack: err.stack,
    }, 'Unexpected error');

    return res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
    });
  };
}
