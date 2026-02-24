export type Role = 'admin' | 'doctor' | 'patient';

export interface User {
  id: string;
  role: Role;
}

export interface Document {
  id: string;
  patient_id: string;
  doctor_id: string;
  file_key: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  created_at: Date;
  updated_at: Date;
}

export interface DocumentResponse {
  id: string;
  patientId: string;
  doctorId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  createdAt: string;
  downloadUrl?: string;
}

export interface AuditLog {
  id: string;
  user_id: string;
  user_role: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  request_id: string;
  ip_address: string | null;
  status_code: number;
  created_at: Date;
}

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
}
