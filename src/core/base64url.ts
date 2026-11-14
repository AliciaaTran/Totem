// URL-safe base64 without padding: A–Z a–z 0–9 - _

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += ALPHABET[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += ALPHABET[n & 63];
  }
  return out;
}

export function fromBase64Url(text: string): Uint8Array {
  if (text.length % 4 === 1) throw new Error('Invalid base64url length');
  const values = [...text].map((ch) => {
    const value = ALPHABET.indexOf(ch);
    if (value < 0) throw new Error(`Invalid base64url character "${ch}"`);
    return value;
  });
  const bytes: number[] = [];
  for (let i = 0; i < values.length; i += 4) {
    const group = values.slice(i, i + 4);
    const n = (group[0] << 18) | (group[1] << 12) | ((group[2] ?? 0) << 6) | (group[3] ?? 0);
    bytes.push((n >> 16) & 255);
    if (group.length > 2) bytes.push((n >> 8) & 255);
    if (group.length > 3) bytes.push(n & 255);
  }
  return Uint8Array.from(bytes);
}
