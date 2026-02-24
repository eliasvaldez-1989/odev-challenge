import { v4 as uuidv4 } from 'uuid';
import { Readable } from 'stream';
import { User, DocumentResponse, PaginatedResult } from '../types';
import { DocumentsRepository } from '../repositories/documents.repository';
import { StorageService } from './storage.service';
import { AuthorizationError, NotFoundError } from '../errors';

function toResponse(doc: {
  id: string;
  patient_id: string;
  doctor_id: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  created_at: Date;
}, downloadUrl?: string): DocumentResponse {
  return {
    id: doc.id,
    patientId: doc.patient_id,
    doctorId: doc.doctor_id,
    fileName: doc.file_name,
    mimeType: doc.mime_type,
    fileSize: doc.file_size,
    createdAt: doc.created_at.toISOString(),
    ...(downloadUrl && { downloadUrl }),
  };
}

export class DocumentsService {
  constructor(
    private repo: DocumentsRepository,
    private storage: StorageService
  ) {}

  async create(
    user: User,
    input: { patientId: string; doctorId?: string },
    file: { stream: Readable; fileName: string; mimeType: string; fileSize: number }
  ): Promise<DocumentResponse> {
    if (user.role === 'patient') {
      throw new AuthorizationError('Patients cannot upload documents');
    }

    const doctorId = user.role === 'doctor' ? user.id : (input.doctorId || user.id);

    const docId = uuidv4();
    const fileKey = `documents/${input.patientId}/${docId}/${file.fileName}`;

    await this.storage.upload(fileKey, file.stream, file.mimeType);

    const doc = await this.repo.create({
      id: docId,
      patient_id: input.patientId,
      doctor_id: doctorId,
      file_key: fileKey,
      file_name: file.fileName,
      file_size: file.fileSize,
      mime_type: file.mimeType,
    });

    return toResponse(doc);
  }

  async list(
    user: User,
    params: { page: number; limit: number }
  ): Promise<PaginatedResult<DocumentResponse>> {
    const filter: { doctorId?: string; patientId?: string } = {};

    if (user.role === 'doctor') {
      filter.doctorId = user.id;
    } else if (user.role === 'patient') {
      filter.patientId = user.id;
    }
    const { data, total } = await this.repo.findAll({
      ...params,
      ...filter,
    });

    return {
      data: data.map((d) => toResponse(d)),
      pagination: { page: params.page, limit: params.limit, total },
    };
  }

  async getById(user: User, id: string): Promise<DocumentResponse> {
    const doc = await this.repo.findById(id);

    if (!doc) {
      throw new NotFoundError('Document');
    }

    if (user.role === 'doctor' && doc.doctor_id !== user.id) {
      throw new NotFoundError('Document');
    }
    if (user.role === 'patient' && doc.patient_id !== user.id) {
      throw new NotFoundError('Document');
    }

    const downloadUrl = await this.storage.getPresignedUrl(doc.file_key);
    return toResponse(doc, downloadUrl);
  }
}
