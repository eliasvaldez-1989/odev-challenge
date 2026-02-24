import { describe, it, expect } from 'vitest';
import { EncryptionService } from '../../../src/utils/encryption';

const TEST_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const SECOND_KEY = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

describe('EncryptionService', () => {
  describe('constructor', () => {
    it('should accept a valid 64-hex-char key', () => {
      expect(() => new EncryptionService(TEST_KEY)).not.toThrow();
    });

    it('should reject a key that is not 32 bytes', () => {
      expect(() => new EncryptionService('tooshort')).toThrow(
        'ENCRYPTION_KEY must be exactly 32 bytes'
      );
    });

    it('should accept an optional previous key for rotation', () => {
      expect(() => new EncryptionService(TEST_KEY, SECOND_KEY)).not.toThrow();
    });
  });

  describe('encrypt / decrypt', () => {
    it('should encrypt and decrypt a string successfully', () => {
      const svc = new EncryptionService(TEST_KEY);
      const plaintext = 'john_doe_bloodwork.pdf';

      const encrypted = svc.encrypt(plaintext);
      const decrypted = svc.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should produce different ciphertext for the same plaintext (unique IV)', () => {
      const svc = new EncryptionService(TEST_KEY);
      const plaintext = 'test.pdf';

      const a = svc.encrypt(plaintext);
      const b = svc.encrypt(plaintext);

      expect(a).not.toBe(b);
    });

    it('should produce versioned ciphertext in v1:iv:authTag:data format', () => {
      const svc = new EncryptionService(TEST_KEY);
      const encrypted = svc.encrypt('test.pdf');
      const parts = encrypted.split(':');

      expect(parts).toHaveLength(4);
      expect(parts[0]).toBe('v1');
      expect(parts[1]).toHaveLength(24);
      expect(parts[2]).toHaveLength(32);
      expect(parts[3].length).toBeGreaterThan(0);
    });

    it('should handle empty strings', () => {
      const svc = new EncryptionService(TEST_KEY);
      const encrypted = svc.encrypt('');
      expect(svc.decrypt(encrypted)).toBe('');
    });

    it('should handle unicode characters', () => {
      const svc = new EncryptionService(TEST_KEY);
      const plaintext = 'paciente_José_García_análisis.pdf';
      const encrypted = svc.encrypt(plaintext);
      expect(svc.decrypt(encrypted)).toBe(plaintext);
    });

    it('should handle long strings', () => {
      const svc = new EncryptionService(TEST_KEY);
      const plaintext = 'a'.repeat(10000);
      const encrypted = svc.encrypt(plaintext);
      expect(svc.decrypt(encrypted)).toBe(plaintext);
    });
  });

  describe('AAD (Additional Authenticated Data)', () => {
    it('should encrypt/decrypt with matching context', () => {
      const svc = new EncryptionService(TEST_KEY);
      const context = 'documents:doc-123:patient-456';
      const encrypted = svc.encrypt('sensitive.pdf', context);
      expect(svc.decrypt(encrypted, context)).toBe('sensitive.pdf');
    });

    it('should fail decryption with wrong context (prevents row swapping)', () => {
      const svc = new EncryptionService(TEST_KEY);
      const encrypted = svc.encrypt('sensitive.pdf', 'documents:doc-1:patient-1');

      expect(() => svc.decrypt(encrypted, 'documents:doc-2:patient-1')).toThrow(
        'Decryption failed'
      );
    });

    it('should fail decryption when context expected but not provided', () => {
      const svc = new EncryptionService(TEST_KEY);
      const encrypted = svc.encrypt('sensitive.pdf', 'documents:doc-1:patient-1');

      expect(() => svc.decrypt(encrypted)).toThrow('Decryption failed');
    });

    it('should fail decryption when no context used but context provided', () => {
      const svc = new EncryptionService(TEST_KEY);
      const encrypted = svc.encrypt('sensitive.pdf');
      expect(() => svc.decrypt(encrypted, 'documents:doc-1:patient-1')).toThrow(
        'Decryption failed'
      );
    });
  });

  describe('key rotation', () => {
    it('should decrypt data encrypted with the previous key', () => {
      const oldService = new EncryptionService(TEST_KEY);
      const encrypted = oldService.encrypt('old-data.pdf');

      const rotatedService = new EncryptionService(SECOND_KEY, TEST_KEY);
      const decrypted = rotatedService.decrypt(encrypted);

      expect(decrypted).toBe('old-data.pdf');
    });

    it('should encrypt with the current key (not previous)', () => {
      const rotatedService = new EncryptionService(SECOND_KEY, TEST_KEY);
      const encrypted = rotatedService.encrypt('new-data.pdf');

      const newService = new EncryptionService(SECOND_KEY);
      expect(newService.decrypt(encrypted)).toBe('new-data.pdf');

      const oldService = new EncryptionService(TEST_KEY);
      expect(() => oldService.decrypt(encrypted)).toThrow('Decryption failed');
    });

    it('should decrypt data encrypted with the current key', () => {
      const rotatedService = new EncryptionService(SECOND_KEY, TEST_KEY);
      const encrypted = rotatedService.encrypt('current-key-data.pdf');
      expect(rotatedService.decrypt(encrypted)).toBe('current-key-data.pdf');
    });

    it('should support AAD during key rotation', () => {
      const ctx = 'documents:doc-1:patient-1';
      const oldService = new EncryptionService(TEST_KEY);
      const encrypted = oldService.encrypt('old.pdf', ctx);

      const rotatedService = new EncryptionService(SECOND_KEY, TEST_KEY);
      expect(rotatedService.decrypt(encrypted, ctx)).toBe('old.pdf');
    });
  });

  describe('needsReEncryption', () => {
    it('should return false for data encrypted with current key', () => {
      const svc = new EncryptionService(SECOND_KEY, TEST_KEY);
      const encrypted = svc.encrypt('current.pdf');
      expect(svc.needsReEncryption(encrypted)).toBe(false);
    });

    it('should return true for data encrypted with previous key', () => {
      const oldService = new EncryptionService(TEST_KEY);
      const encrypted = oldService.encrypt('old.pdf');

      const rotatedService = new EncryptionService(SECOND_KEY, TEST_KEY);
      expect(rotatedService.needsReEncryption(encrypted)).toBe(true);
    });

    it('should return false for corrupted data', () => {
      const svc = new EncryptionService(SECOND_KEY, TEST_KEY);
      expect(svc.needsReEncryption('garbage:data')).toBe(false);
    });
  });

  describe('legacy format support', () => {
    it('should decrypt legacy format without version prefix (iv:authTag:ciphertext)', () => {
      const { createCipheriv, randomBytes } = require('crypto');
      const key = Buffer.from(TEST_KEY, 'hex');
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
      const encrypted = Buffer.concat([cipher.update('legacy.pdf', 'utf8'), cipher.final()]);
      const authTag = cipher.getAuthTag();

      const legacyFormat = [
        iv.toString('hex'),
        authTag.toString('hex'),
        encrypted.toString('hex'),
      ].join(':');

      const svc = new EncryptionService(TEST_KEY);
      expect(svc.decrypt(legacyFormat)).toBe('legacy.pdf');
    });
  });

  describe('error handling', () => {
    it('should throw on corrupted ciphertext', () => {
      const svc = new EncryptionService(TEST_KEY);
      expect(() => svc.decrypt('v1:invalid:data:here')).toThrow('Decryption failed');
    });

    it('should throw on wrong format (missing parts)', () => {
      const svc = new EncryptionService(TEST_KEY);
      expect(() => svc.decrypt('onlyonepart')).toThrow('Decryption failed');
    });

    it('should throw on tampered ciphertext (GCM auth tag verification)', () => {
      const svc = new EncryptionService(TEST_KEY);
      const encrypted = svc.encrypt('sensitive.pdf');
      const parts = encrypted.split(':');
      parts[3] = 'ff' + parts[3].substring(2);
      const tampered = parts.join(':');

      expect(() => svc.decrypt(tampered)).toThrow('Decryption failed');
    });

    it('should throw when decrypting with wrong key and no previous key', () => {
      const svc1 = new EncryptionService(TEST_KEY);
      const encrypted = svc1.encrypt('test.pdf');

      const svc2 = new EncryptionService(SECOND_KEY);
      expect(() => svc2.decrypt(encrypted)).toThrow('Decryption failed');
    });

    it('should reject manipulated IV length', () => {
      const svc = new EncryptionService(TEST_KEY);
      expect(() => svc.decrypt('v1:00112233445566778899:' + '00'.repeat(16) + ':aabb')).toThrow(
        'Decryption failed'
      );
    });

    it('should reject manipulated auth tag length', () => {
      const svc = new EncryptionService(TEST_KEY);
      expect(() => svc.decrypt('v1:' + '00'.repeat(12) + ':00112233445566778899:aabb')).toThrow(
        'Decryption failed'
      );
    });
  });
});
