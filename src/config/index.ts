import { z } from 'zod';
import * as dotenv from 'dotenv';

dotenv.config();

const configSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DATABASE_URL: z.string().default('postgres://app_user:localdev@localhost:5432/patient_docs'),
  AWS_REGION: z.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: z.string().default('test'),
  AWS_SECRET_ACCESS_KEY: z.string().default('test'),
  AWS_ENDPOINT: z.string().optional(),
  S3_BUCKET: z.string().default('patient-documents'),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(false),
  PRESIGNED_URL_EXPIRY: z.coerce.number().default(900),
  ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i).default(
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  ),
  ENCRYPTION_KEY_PREVIOUS: z.string().regex(/^[0-9a-f]{64}$/i).optional(),
});

export type Config = z.infer<typeof configSchema>;

let _config: Config | null = null;

export function getConfig(): Config {
  if (!_config) {
    const result = configSchema.safeParse(process.env);
    if (!result.success) {
      console.error('Invalid configuration:', result.error.format());
      process.exit(1);
    }
    _config = result.data;
  }
  return _config;
}
