import { describe, it, expect } from 'vitest';
import { validateMagicBytes, MAGIC_BYTES_LENGTH } from '../../../src/utils/file-validation';

describe('validateMagicBytes', () => {
  describe('PDF files', () => {
    it('should accept valid PDF header', () => {
      const pdfHeader = Buffer.from('%PDF-1.4', 'ascii');
      expect(validateMagicBytes(pdfHeader, 'application/pdf')).toBeNull();
    });

    it('should reject non-PDF content claiming to be PDF', () => {
      const textContent = Buffer.from('Hello world, this is text');
      const error = validateMagicBytes(textContent, 'application/pdf');
      expect(error).toContain('does not match claimed type');
    });
  });

  describe('PNG files', () => {
    it('should accept valid PNG header', () => {
      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(validateMagicBytes(pngHeader, 'image/png')).toBeNull();
    });

    it('should reject JPEG content claiming to be PNG', () => {
      const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
      const error = validateMagicBytes(jpegHeader, 'image/png');
      expect(error).toContain('does not match claimed type');
    });
  });

  describe('JPEG files', () => {
    it('should accept valid JFIF JPEG header', () => {
      const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
      expect(validateMagicBytes(jpegHeader, 'image/jpeg')).toBeNull();
    });

    it('should accept valid EXIF JPEG header', () => {
      const exifHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10, 0x45, 0x78]);
      expect(validateMagicBytes(exifHeader, 'image/jpeg')).toBeNull();
    });

    it('should reject PNG content claiming to be JPEG', () => {
      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const error = validateMagicBytes(pngHeader, 'image/jpeg');
      expect(error).toContain('does not match claimed type');
    });
  });

  describe('unsupported types', () => {
    it('should reject unknown MIME types', () => {
      const content = Buffer.from('anything');
      const error = validateMagicBytes(content, 'application/zip');
      expect(error).toContain('No magic byte signature defined');
    });
  });

  describe('edge cases', () => {
    it('should handle empty buffer', () => {
      const error = validateMagicBytes(Buffer.alloc(0), 'application/pdf');
      expect(error).toContain('does not match claimed type');
    });

    it('should handle buffer shorter than signature', () => {
      const shortBuf = Buffer.from([0x25]);
      const error = validateMagicBytes(shortBuf, 'application/pdf');
      expect(error).toContain('does not match claimed type');
    });
  });

  describe('MAGIC_BYTES_LENGTH', () => {
    it('should be 8 (enough for PNG header, the longest signature)', () => {
      expect(MAGIC_BYTES_LENGTH).toBe(8);
    });
  });
});
