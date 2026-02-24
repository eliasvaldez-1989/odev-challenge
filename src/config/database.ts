import knex, { Knex } from 'knex';
import { Config } from './index';

export function createDatabase(config: Config): Knex {
  return knex({
    client: 'pg',
    connection: config.DATABASE_URL,
    pool: { min: 1, max: 10 },
  });
}
