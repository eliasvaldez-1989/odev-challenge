import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import knex, { Knex } from 'knex';
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3';
import { createApp } from '../../src/app';
import { createLogger } from '../../src/utils/logger';
import { EncryptionService } from '../../src/utils/encryption';
import { makeAuthHeader, testUsers } from '../helpers/factories';
import { Config } from '../../src/config';

const VALID_PDF = Buffer.from('%PDF-1.4 test content');

let db: Knex;
let app: ReturnType<typeof createApp>;
let s3: S3Client;

const TEST_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const testConfig: Config = {
  PORT: 3001,
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
  DATABASE_URL: process.env.TEST_DATABASE_URL
    || `postgres://${process.env.USER}@localhost:5432/patient_docs_test`,
  AWS_REGION: 'us-east-1',
  AWS_ACCESS_KEY_ID: 'test',
  AWS_SECRET_ACCESS_KEY: 'test',
  AWS_ENDPOINT: 'http://localhost:4566',
  S3_BUCKET: 'patient-documents-test',
  S3_FORCE_PATH_STYLE: true,
  PRESIGNED_URL_EXPIRY: 900,
  ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
};

const encryption = new EncryptionService(TEST_ENCRYPTION_KEY);

function encryptFileName(fileName: string, docId: string, patientId: string): string {
  return encryption.encrypt(fileName, `documents:${docId}:${patientId}`);
}

const logger = createLogger('error');

beforeAll(async () => {
  db = knex({
    client: 'pg',
    connection: testConfig.DATABASE_URL,
  });

  s3 = new S3Client({
    region: testConfig.AWS_REGION,
    endpoint: testConfig.AWS_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: testConfig.AWS_ACCESS_KEY_ID,
      secretAccessKey: testConfig.AWS_SECRET_ACCESS_KEY,
    },
  });

  try {
    await s3.send(new CreateBucketCommand({ Bucket: testConfig.S3_BUCKET }));
  } catch (err: any) {
    if (!err.name?.includes('BucketAlreadyOwnedByYou') && !err.name?.includes('BucketAlreadyExists')) {
      console.warn('LocalStack not available, S3 tests will be skipped');
    }
  }

  app = createApp({ db, s3, config: testConfig, logger });
});

beforeEach(async () => {
  await db('audit_logs').del();
  await db('documents').del();
});

afterAll(async () => {
  await db.destroy();
});

describe('GET /health', () => {
  it('should return 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('POST /documents', () => {
  it('should return 401 without auth', async () => {
    const res = await request(app).post('/documents');
    expect(res.status).toBe(401);
  });

  it('should return 403 for patient role', async () => {
    const res = await request(app)
      .post('/documents')
      .set('Authorization', makeAuthHeader(testUsers.patient1))
      .set('Content-Type', 'multipart/form-data')
      .field('patientId', testUsers.patient1.id)
      .attach('file', VALID_PDF, {
        filename: 'test.pdf',
        contentType: 'application/pdf',
      });
    expect(res.status).toBe(403);
  });

  it('should create a document as doctor', async () => {
    const res = await request(app)
      .post('/documents')
      .set('Authorization', makeAuthHeader(testUsers.doctor1))
      .field('patientId', testUsers.patient1.id)
      .attach('file', VALID_PDF, {
        filename: 'test.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(201);
    expect(res.body.patientId).toBe(testUsers.patient1.id);
    expect(res.body.doctorId).toBe(testUsers.doctor1.id);
    expect(res.body.fileName).toBe('test.pdf');
    expect(res.body.downloadUrl).toBeUndefined();
  });

  it('should reject file with mismatched magic bytes (e.g. text renamed to .pdf)', async () => {
    const fakeFile = Buffer.from('This is plain text pretending to be a PDF');
    const res = await request(app)
      .post('/documents')
      .set('Authorization', makeAuthHeader(testUsers.doctor1))
      .field('patientId', testUsers.patient1.id)
      .attach('file', fakeFile, {
        filename: 'fake.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('does not match claimed type');
  });

  it('should force doctorId to user.id for doctor role', async () => {
    const res = await request(app)
      .post('/documents')
      .set('Authorization', makeAuthHeader(testUsers.doctor1))
      .field('patientId', testUsers.patient1.id)
      .field('doctorId', testUsers.doctor2.id)
      .attach('file', VALID_PDF, {
        filename: 'test.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(201);
    expect(res.body.doctorId).toBe(testUsers.doctor1.id);
  });
});

describe('GET /documents', () => {
  it('should return 401 without auth', async () => {
    const res = await request(app).get('/documents');
    expect(res.status).toBe(401);
  });

  it('should return empty list when no documents exist', async () => {
    const res = await request(app)
      .get('/documents')
      .set('Authorization', makeAuthHeader(testUsers.admin));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
  });

  it('should only return own documents for doctor', async () => {
    const doc1Id = '10000000-0000-0000-0000-000000000001';
    const doc2Id = '10000000-0000-0000-0000-000000000002';
    await db('documents').insert([
      {
        id: doc1Id,
        patient_id: testUsers.patient1.id,
        doctor_id: testUsers.doctor1.id,
        file_key: 'test/key1',
        file_name: encryptFileName('doc1.pdf', doc1Id, testUsers.patient1.id),
        file_size: 100,
        mime_type: 'application/pdf',
      },
      {
        id: doc2Id,
        patient_id: testUsers.patient1.id,
        doctor_id: testUsers.doctor2.id,
        file_key: 'test/key2',
        file_name: encryptFileName('doc2.pdf', doc2Id, testUsers.patient1.id),
        file_size: 100,
        mime_type: 'application/pdf',
      },
    ]);

    const res = await request(app)
      .get('/documents')
      .set('Authorization', makeAuthHeader(testUsers.doctor1));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].doctorId).toBe(testUsers.doctor1.id);
  });

  it('should only return own documents for patient', async () => {
    const doc3Id = '10000000-0000-0000-0000-000000000003';
    const doc4Id = '10000000-0000-0000-0000-000000000004';
    await db('documents').insert([
      {
        id: doc3Id,
        patient_id: testUsers.patient1.id,
        doctor_id: testUsers.doctor1.id,
        file_key: 'test/key3',
        file_name: encryptFileName('doc3.pdf', doc3Id, testUsers.patient1.id),
        file_size: 100,
        mime_type: 'application/pdf',
      },
      {
        id: doc4Id,
        patient_id: testUsers.patient2.id,
        doctor_id: testUsers.doctor1.id,
        file_key: 'test/key4',
        file_name: encryptFileName('doc4.pdf', doc4Id, testUsers.patient2.id),
        file_size: 100,
        mime_type: 'application/pdf',
      },
    ]);

    const res = await request(app)
      .get('/documents')
      .set('Authorization', makeAuthHeader(testUsers.patient1));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].patientId).toBe(testUsers.patient1.id);
  });

  it('should return all documents for admin', async () => {
    const doc5Id = '10000000-0000-0000-0000-000000000005';
    const doc6Id = '10000000-0000-0000-0000-000000000006';
    await db('documents').insert([
      {
        id: doc5Id,
        patient_id: testUsers.patient1.id,
        doctor_id: testUsers.doctor1.id,
        file_key: 'test/key5',
        file_name: encryptFileName('doc5.pdf', doc5Id, testUsers.patient1.id),
        file_size: 100,
        mime_type: 'application/pdf',
      },
      {
        id: doc6Id,
        patient_id: testUsers.patient2.id,
        doctor_id: testUsers.doctor2.id,
        file_key: 'test/key6',
        file_name: encryptFileName('doc6.pdf', doc6Id, testUsers.patient2.id),
        file_size: 100,
        mime_type: 'application/pdf',
      },
    ]);

    const res = await request(app)
      .get('/documents')
      .set('Authorization', makeAuthHeader(testUsers.admin));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });
});

describe('GET /documents/:id', () => {
  const docId = '20000000-0000-0000-0000-000000000001';

  beforeEach(async () => {
    await db('documents').insert({
      id: docId,
      patient_id: testUsers.patient1.id,
      doctor_id: testUsers.doctor1.id,
      file_key: 'test/key-get',
      file_name: encryptFileName('get-test.pdf', docId, testUsers.patient1.id),
      file_size: 200,
      mime_type: 'application/pdf',
    });
  });

  it('should return 401 without auth', async () => {
    const res = await request(app).get(`/documents/${docId}`);
    expect(res.status).toBe(401);
  });

  it('should return document for admin', async () => {
    const res = await request(app)
      .get(`/documents/${docId}`)
      .set('Authorization', makeAuthHeader(testUsers.admin));

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(docId);
    expect(res.body.downloadUrl).toBeDefined();
  });

  it('should return document for owning doctor', async () => {
    const res = await request(app)
      .get(`/documents/${docId}`)
      .set('Authorization', makeAuthHeader(testUsers.doctor1));

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(docId);
  });

  it('should return 404 for non-owning doctor (info leakage prevention)', async () => {
    const res = await request(app)
      .get(`/documents/${docId}`)
      .set('Authorization', makeAuthHeader(testUsers.doctor2));

    expect(res.status).toBe(404);
  });

  it('should return document for owning patient', async () => {
    const res = await request(app)
      .get(`/documents/${docId}`)
      .set('Authorization', makeAuthHeader(testUsers.patient1));

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(docId);
  });

  it('should return 404 for non-owning patient (info leakage prevention)', async () => {
    const res = await request(app)
      .get(`/documents/${docId}`)
      .set('Authorization', makeAuthHeader(testUsers.patient2));

    expect(res.status).toBe(404);
  });

  it('should return 404 for non-existent document', async () => {
    const res = await request(app)
      .get('/documents/99999999-9999-9999-9999-999999999999')
      .set('Authorization', makeAuthHeader(testUsers.admin));

    expect(res.status).toBe(404);
  });

  it('should return 400 for invalid UUID', async () => {
    const res = await request(app)
      .get('/documents/not-a-uuid')
      .set('Authorization', makeAuthHeader(testUsers.admin));

    expect(res.status).toBe(400);
  });
});
