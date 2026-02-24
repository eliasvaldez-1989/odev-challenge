import type { Knex } from 'knex';
import * as dotenv from 'dotenv';

dotenv.config();

const config: Record<string, Knex.Config> = {
  development: {
    client: 'pg',
    connection: process.env.DATABASE_URL || 'postgres://app_user:localdev@localhost:5432/patient_docs',
    migrations: {
      directory: './migrations',
      extension: 'js',
    },
    seeds: {
      directory: './seeds',
    },
  },
  test: {
    client: 'pg',
    connection: process.env.TEST_DATABASE_URL || 'postgres://app_user:localdev@localhost:5432/patient_docs_test',
    migrations: {
      directory: './migrations',
      extension: 'js',
    },
  },
  production: {
    client: 'pg',
    connection: {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: true },
    },
    pool: { min: 2, max: 10 },
    migrations: {
      directory: './migrations',
      extension: 'js',
    },
  },
};

export default config;
module.exports = config;
