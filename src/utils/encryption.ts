import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const SEPARATOR = ':';
const VERSION_PREFIX = 'v1';

export class EncryptionService {
  private key: Buffer;
  private previousKey: Buffer | null;

  constructor(keyHex: string, previousKeyHex?: string) {
    this.key = Buffer.from(keyHex, 'hex');
    if (this.key.length !== 32) {
      throw new Error('ENCRYPTION_KEY must be exactly 32 bytes (64 hex characters)');
    }
    this.previousKey = previousKeyHex
      ? Buffer.from(previousKeyHex, 'hex')
      : null;
  }

  encrypt(plaintext: string, context?: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });

    if (context) {
      cipher.setAAD(Buffer.from(context, 'utf8'));
    }

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return [
      VERSION_PREFIX,
      iv.toString('hex'),
      authTag.toString('hex'),
      encrypted.toString('hex'),
    ].join(SEPARATOR);
  }

  decrypt(encryptedValue: string, context?: string): string {
    const result = this.decryptWithKey(encryptedValue, this.key, context);
    if (result !== null) return result;

    if (this.previousKey) {
      const fallback = this.decryptWithKey(encryptedValue, this.previousKey, context);
      if (fallback !== null) return fallback;
    }

    throw new Error('Decryption failed: invalid key or corrupted data');
  }

  needsReEncryption(encryptedValue: string, context?: string): boolean {
    const current = this.decryptWithKey(encryptedValue, this.key, context);
    if (current !== null) return false;

    if (this.previousKey) {
      const prev = this.decryptWithKey(encryptedValue, this.previousKey, context);
      if (prev !== null) return true;
    }

    return false;
  }

  private decryptWithKey(encryptedValue: string, key: Buffer, context?: string): string | null {
    try {
      const parts = encryptedValue.split(SEPARATOR);

      let ivHex: string, authTagHex: string, ciphertextHex: string;

      if (parts[0] === VERSION_PREFIX) {
        if (parts.length !== 4) return null;
        [, ivHex, authTagHex, ciphertextHex] = parts;
      } else {
        if (parts.length !== 3) return null;
        [ivHex, authTagHex, ciphertextHex] = parts;
      }

      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');
      const ciphertext = Buffer.from(ciphertextHex, 'hex');

      if (iv.length !== IV_LENGTH) return null;
      if (authTag.length !== AUTH_TAG_LENGTH) return null;

      const decipher = createDecipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
      });
      decipher.setAuthTag(authTag);

      if (context) {
        decipher.setAAD(Buffer.from(context, 'utf8'));
      }

      const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);

      return decrypted.toString('utf8');
    } catch {
      return null;
    }
  }
}
