import { Router } from 'express';
import { Knex } from 'knex';

export function healthRoutes(db: Knex): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    try {
      await db.raw('SELECT 1');
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'unhealthy', timestamp: new Date().toISOString() });
    }
  });

  return router;
}
