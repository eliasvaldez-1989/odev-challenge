import { z } from 'zod';

const ALLOWED_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'] as const;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export const uploadDocumentSchema = z.object({
  patientId: z.string().uuid('patientId must be a valid UUID'),
  doctorId: z.string().uuid('doctorId must be a valid UUID').optional(),
});

export const getDocumentParamsSchema = z.object({
  id: z.string().uuid('Document ID must be a valid UUID'),
});

export const listDocumentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export function validateFileMetadata(mimeType: string, fileSize: number) {
  if (!ALLOWED_MIME_TYPES.includes(mimeType as any)) {
    return `Unsupported file type: ${mimeType}. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`;
  }
  if (fileSize > MAX_FILE_SIZE) {
    return `File too large: ${fileSize} bytes. Maximum: ${MAX_FILE_SIZE} bytes (10MB)`;
  }
  return null;
}

export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>;
export type GetDocumentParams = z.infer<typeof getDocumentParamsSchema>;
export type ListDocumentsQuery = z.infer<typeof listDocumentsQuerySchema>;
