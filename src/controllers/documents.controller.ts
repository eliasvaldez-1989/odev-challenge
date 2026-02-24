import { Request, Response, NextFunction } from 'express';
import Busboy from 'busboy';
import { Readable, PassThrough } from 'stream';
import { DocumentsService } from '../services/documents.service';
import { validateFileMetadata } from '../schemas/document.schema';
import { validateMagicBytes, MAGIC_BYTES_LENGTH } from '../utils/file-validation';
import { ValidationError, AuthenticationError } from '../errors';
import { Logger } from '../utils/logger';

export class DocumentsController {
  constructor(
    private service: DocumentsService,
    private logger: Logger
  ) {}

  upload = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) throw new AuthenticationError();

      const contentType = req.headers['content-type'] || '';
      if (!contentType.includes('multipart/form-data')) {
        throw new ValidationError('Content-Type must be multipart/form-data');
      }

      const result = await this.parseMultipart(req);

      const doc = await this.service.create(req.user, result.fields, {
        stream: result.file.stream,
        fileName: result.file.fileName,
        mimeType: result.file.mimeType,
        fileSize: result.file.fileSize,
      });

      req.auditAction = 'document.create';
      req.auditResourceType = 'document';
      req.auditResourceId = doc.id;

      res.status(201).json(doc);
    } catch (err) {
      next(err);
    }
  };

  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) throw new AuthenticationError();

      const page = Number(req.query.page) || 1;
      const limit = Math.min(Number(req.query.limit) || 20, 100);

      const result = await this.service.list(req.user, { page, limit });

      req.auditAction = 'document.list';
      req.auditResourceType = 'document';

      res.json(result);
    } catch (err) {
      next(err);
    }
  };

  getById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) throw new AuthenticationError();

      const doc = await this.service.getById(req.user, req.params.id);

      req.auditAction = 'document.read';
      req.auditResourceType = 'document';
      req.auditResourceId = doc.id;

      res.json(doc);
    } catch (err) {
      next(err);
    }
  };

  private parseMultipart(req: Request): Promise<{
    fields: { patientId: string; doctorId?: string };
    file: { stream: Readable; fileName: string; mimeType: string; fileSize: number };
  }> {
    return new Promise((resolve, reject) => {
      const busboy = Busboy({
        headers: req.headers,
        limits: { fileSize: 10 * 1024 * 1024, files: 1 },
      });

      let patientId: string | undefined;
      let doctorId: string | undefined;
      let fileInfo: { stream: PassThrough; fileName: string; mimeType: string; fileSize: number } | undefined;
      let totalBytes = 0;

      busboy.on('field', (name, value) => {
        if (name === 'patientId') patientId = value;
        if (name === 'doctorId') doctorId = value;
      });

      busboy.on('file', (name, stream, info) => {
        if (name !== 'file') {
          stream.resume();
          return;
        }

        const mimeError = validateFileMetadata(info.mimeType, 0);
        if (mimeError && !mimeError.includes('File too large')) {
          stream.resume();
          reject(new ValidationError(mimeError));
          return;
        }

        const passThrough = new PassThrough();
        let headerBuf = Buffer.alloc(0);
        let headerValidated = false;

        stream.on('data', (chunk: Buffer) => {
          totalBytes += chunk.length;

          if (!headerValidated) {
            headerBuf = Buffer.concat([headerBuf, chunk]);
            if (headerBuf.length >= MAGIC_BYTES_LENGTH) {
              headerValidated = true;
              const magicError = validateMagicBytes(headerBuf, info.mimeType);
              if (magicError) {
                stream.unpipe();
                stream.resume();
                reject(new ValidationError(magicError));
                return;
              }
              passThrough.write(headerBuf);
            }
          } else {
            passThrough.write(chunk);
          }
        });

        stream.on('end', () => {
          if (!headerValidated && headerBuf.length > 0) {
            const magicError = validateMagicBytes(headerBuf, info.mimeType);
            if (magicError) {
              reject(new ValidationError(magicError));
              return;
            }
            passThrough.write(headerBuf);
          }
          passThrough.end();
        });

        stream.on('error', (err) => passThrough.destroy(err));

        fileInfo = {
          stream: passThrough,
          fileName: info.filename,
          mimeType: info.mimeType,
          fileSize: 0,
        };
      });

      busboy.on('finish', () => {
        if (!patientId) {
          reject(new ValidationError('patientId is required'));
          return;
        }
        if (!fileInfo) {
          reject(new ValidationError('file is required'));
          return;
        }
        fileInfo.fileSize = totalBytes;
        resolve({
          fields: { patientId, ...(doctorId && { doctorId }) },
          file: fileInfo,
        });
      });

      busboy.on('error', (err) => reject(err));

      req.pipe(busboy);
    });
  }
}
