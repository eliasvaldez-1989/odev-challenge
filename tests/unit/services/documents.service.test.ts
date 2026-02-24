import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'stream';
import { DocumentsService } from '../../../src/services/documents.service';
import { DocumentsRepository } from '../../../src/repositories/documents.repository';
import { StorageService } from '../../../src/services/storage.service';
import { testUsers } from '../../helpers/factories';

const mockRepo = {
  create: vi.fn(),
  findById: vi.fn(),
  findAll: vi.fn(),
} as unknown as DocumentsRepository;

const mockStorage = {
  upload: vi.fn().mockResolvedValue(undefined),
  getPresignedUrl: vi.fn().mockResolvedValue('https://s3.example.com/presigned'),
} as unknown as StorageService;

describe('DocumentsService', () => {
  let service: DocumentsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DocumentsService(mockRepo, mockStorage);
  });

  describe('create', () => {
    const file = {
      stream: Readable.from(Buffer.from('test')),
      fileName: 'test.pdf',
      mimeType: 'application/pdf',
      fileSize: 1024,
    };

    it('should allow admin to create documents', async () => {
      (mockRepo.create as any).mockResolvedValue({
        id: 'doc-id',
        patient_id: 'patient-1',
        doctor_id: testUsers.admin.id,
        file_key: 'documents/patient-1/doc-id/test.pdf',
        file_name: 'test.pdf',
        file_size: 1024,
        mime_type: 'application/pdf',
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      });

      const result = await service.create(
        testUsers.admin,
        { patientId: 'patient-1' },
        file
      );

      expect(result.patientId).toBe('patient-1');
      expect(mockStorage.upload).toHaveBeenCalled();
    });

    it('should force doctorId to user.id for doctor role', async () => {
      (mockRepo.create as any).mockImplementation(async (data: any) => ({
        ...data,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      }));

      await service.create(
        testUsers.doctor1,
        { patientId: 'patient-1', doctorId: 'some-other-doctor' },
        { ...file, stream: Readable.from(Buffer.from('test')) }
      );

      const createCall = (mockRepo.create as any).mock.calls[0][0];
      expect(createCall.doctor_id).toBe(testUsers.doctor1.id);
    });

    it('should throw 403 for patient role', async () => {
      await expect(
        service.create(testUsers.patient1, { patientId: 'patient-1' }, file)
      ).rejects.toThrow('Patients cannot upload documents');
    });
  });

  describe('list', () => {
    it('should return all documents for admin', async () => {
      (mockRepo.findAll as any).mockResolvedValue({ data: [], total: 0 });

      await service.list(testUsers.admin, { page: 1, limit: 20 });

      const findAllCall = (mockRepo.findAll as any).mock.calls[0][0];
      expect(findAllCall.doctorId).toBeUndefined();
      expect(findAllCall.patientId).toBeUndefined();
    });

    it('should filter by doctorId for doctor role', async () => {
      (mockRepo.findAll as any).mockResolvedValue({ data: [], total: 0 });

      await service.list(testUsers.doctor1, { page: 1, limit: 20 });

      const findAllCall = (mockRepo.findAll as any).mock.calls[0][0];
      expect(findAllCall.doctorId).toBe(testUsers.doctor1.id);
    });

    it('should filter by patientId for patient role', async () => {
      (mockRepo.findAll as any).mockResolvedValue({ data: [], total: 0 });

      await service.list(testUsers.patient1, { page: 1, limit: 20 });

      const findAllCall = (mockRepo.findAll as any).mock.calls[0][0];
      expect(findAllCall.patientId).toBe(testUsers.patient1.id);
    });
  });

  describe('getById', () => {
    const doc = {
      id: 'doc-1',
      patient_id: testUsers.patient1.id,
      doctor_id: testUsers.doctor1.id,
      file_key: 'documents/patient-1/doc-1/test.pdf',
      file_name: 'test.pdf',
      file_size: 1024,
      mime_type: 'application/pdf',
      created_at: new Date('2024-01-01'),
      updated_at: new Date('2024-01-01'),
    };

    it('should allow admin to access any document', async () => {
      (mockRepo.findById as any).mockResolvedValue(doc);

      const result = await service.getById(testUsers.admin, 'doc-1');

      expect(result.id).toBe('doc-1');
      expect(result.downloadUrl).toBe('https://s3.example.com/presigned');
    });

    it('should allow doctor to access own documents', async () => {
      (mockRepo.findById as any).mockResolvedValue(doc);

      const result = await service.getById(testUsers.doctor1, 'doc-1');

      expect(result.id).toBe('doc-1');
    });

    it('should deny doctor access to another doctor\'s documents (returns 404)', async () => {
      (mockRepo.findById as any).mockResolvedValue(doc);

      await expect(
        service.getById(testUsers.doctor2, 'doc-1')
      ).rejects.toThrow('Document not found');
    });

    it('should allow patient to access own documents', async () => {
      (mockRepo.findById as any).mockResolvedValue(doc);

      const result = await service.getById(testUsers.patient1, 'doc-1');

      expect(result.id).toBe('doc-1');
    });

    it('should deny patient access to another patient\'s documents (returns 404)', async () => {
      (mockRepo.findById as any).mockResolvedValue(doc);

      await expect(
        service.getById(testUsers.patient2, 'doc-1')
      ).rejects.toThrow('Document not found');
    });

    it('should throw 404 for non-existent document', async () => {
      (mockRepo.findById as any).mockResolvedValue(null);

      await expect(
        service.getById(testUsers.admin, 'non-existent')
      ).rejects.toThrow('Document not found');
    });
  });
});
