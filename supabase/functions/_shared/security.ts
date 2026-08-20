const encoder = new TextEncoder();

/**
 * Compares a caller-controlled value with a secret without returning early on a
 * mismatched byte. The caller-controlled header is bounded first to avoid making
 * the comparison itself a denial-of-service primitive.
 */
export function constantTimeSecretEqual(provided: string | null, expected: string): boolean {
  if (provided === null || provided.length > 512) return false;

  const providedBytes = encoder.encode(provided);
  const expectedBytes = encoder.encode(expected);
  let difference = providedBytes.length ^ expectedBytes.length;

  for (let index = 0; index < expectedBytes.length; index += 1) {
    difference |= (providedBytes[index] ?? 0) ^ expectedBytes[index];
  }

  return difference === 0;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}
