import { Knex } from 'knex';
import { Document } from '../types';
import { EncryptionService } from '../utils/encryption';

export interface CreateDocumentData {
  id: string;
  patient_id: string;
  doctor_id: string;
  file_key: string;
  file_name: string;
  file_size: number;
  mime_type: string;
}

export class DocumentsRepository {
  constructor(
    private db: Knex,
    private encryption: EncryptionService
  ) {}

  async create(data: CreateDocumentData): Promise<Document> {
    const context = this.aadContext(data.id, data.patient_id);
    const encrypted = {
      ...data,
      file_name: this.encryption.encrypt(data.file_name, context),
    };
    const [doc] = await this.db('documents')
      .insert(encrypted)
      .returning('*');
    return this.decryptDoc(doc);
  }

  async findById(id: string): Promise<Document | null> {
    const doc = await this.db('documents')
      .where({ id })
      .first();
    return doc ? this.decryptDoc(doc) : null;
  }

  async findAll(params: {
    page: number;
    limit: number;
    doctorId?: string;
    patientId?: string;
  }): Promise<{ data: Document[]; total: number }> {
    const query = this.db('documents');

    if (params.doctorId) {
      query.where('doctor_id', params.doctorId);
    }
    if (params.patientId) {
      query.where('patient_id', params.patientId);
    }

    const countResult = await query.clone().count('* as count').first();
    const total = Number(countResult?.count || 0);

    const data = await query
      .orderBy('created_at', 'desc')
      .limit(params.limit)
      .offset((params.page - 1) * params.limit);

    return { data: data.map((d: Document) => this.decryptDoc(d)), total };
  }

  private aadContext(documentId: string, patientId: string): string {
    return `documents:${documentId}:${patientId}`;
  }

  private decryptDoc(doc: Document): Document {
    const context = this.aadContext(doc.id, doc.patient_id);
    return {
      ...doc,
      file_name: this.encryption.decrypt(doc.file_name, context),
    };
  }
}
