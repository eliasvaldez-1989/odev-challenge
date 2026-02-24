const MAGIC_SIGNATURES: Record<string, Buffer[]> = {
  'application/pdf': [Buffer.from([0x25, 0x50, 0x44, 0x46])],
  'image/png': [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  'image/jpeg': [
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.from([0xff, 0xd8, 0xff, 0xe1]),
    Buffer.from([0xff, 0xd8, 0xff, 0xdb]),
    Buffer.from([0xff, 0xd8, 0xff, 0xee]),
  ],
};

export const MAGIC_BYTES_LENGTH = 8;

export function validateMagicBytes(header: Buffer, claimedMimeType: string): string | null {
  const signatures = MAGIC_SIGNATURES[claimedMimeType];
  if (!signatures) {
    return `No magic byte signature defined for MIME type: ${claimedMimeType}`;
  }

  const matches = signatures.some((sig) =>
    header.length >= sig.length && header.subarray(0, sig.length).equals(sig)
  );

  if (!matches) {
    return `File content does not match claimed type "${claimedMimeType}". The file may be corrupted or mislabeled.`;
  }

  return null;
}
