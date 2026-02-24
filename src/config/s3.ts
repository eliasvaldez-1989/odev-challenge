import { S3Client } from '@aws-sdk/client-s3';
import { Config } from './index';

export function createS3Client(config: Config): S3Client {
  return new S3Client({
    region: config.AWS_REGION,
    ...(config.AWS_ENDPOINT && { endpoint: config.AWS_ENDPOINT }),
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: config.AWS_ACCESS_KEY_ID,
      secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
    },
  });
}
