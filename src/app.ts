import express from 'express';
import helmet from 'helmet';
import { Knex } from 'knex';
import { healthRoutes } from './routes/health';
import { documentRoutes } from './routes/documents';
import { DocumentsController } from './controllers/documents.controller';
import { DocumentsService } from './services/documents.service';
import { DocumentsRepository } from './repositories/documents.repository';
import { StorageService } from './services/storage.service';
import { requestId } from './middleware/request-id';
import { auditLog } from './middleware/audit-log';
import { errorHandler } from './middleware/error-handler';
import { rateLimit } from './middleware/rate-limit';
import { Logger } from './utils/logger';
import { EncryptionService } from './utils/encryption';
import { S3Client } from '@aws-sdk/client-s3';
import { Config } from './config';

export interface AppDependencies {
  db: Knex;
  s3: S3Client;
  config: Config;
  logger: Logger;
}

export function createApp(deps: AppDependencies) {
  const { db, s3, config, logger } = deps;
  const app = express();

  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));
  app.use(requestId());
  app.use(rateLimit({ windowMs: 60_000, maxRequests: 100 }, logger));
  app.use(auditLog(db, logger));

  const encryption = new EncryptionService(config.ENCRYPTION_KEY, config.ENCRYPTION_KEY_PREVIOUS);
  const storageService = new StorageService(s3, config.S3_BUCKET, config.PRESIGNED_URL_EXPIRY);
  const documentsRepo = new DocumentsRepository(db, encryption);
  const documentsService = new DocumentsService(documentsRepo, storageService);
  const documentsController = new DocumentsController(documentsService, logger);

  app.use('/health', healthRoutes(db));
  app.use('/documents', documentRoutes(documentsController));
  app.use(errorHandler(logger));

  return app;
}
