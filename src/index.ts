import { getConfig } from './config';
import { createDatabase } from './config/database';
import { createS3Client } from './config/s3';
import { createLogger } from './utils/logger';
import { createApp } from './app';

async function main() {
  const config = getConfig();
  const logger = createLogger(config.LOG_LEVEL);
  const db = createDatabase(config);
  const s3 = createS3Client(config);

  const app = createApp({ db, s3, config, logger });

  app.listen(config.PORT, () => {
    logger.info({ port: config.PORT, env: config.NODE_ENV }, 'Server started');
  });

  const shutdown = async () => {
    logger.info('Shutting down gracefully...');
    await db.destroy();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
