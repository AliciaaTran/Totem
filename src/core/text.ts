// Text helpers shared by the encoder, the tables and the UI.

/** The form every lookup and every encoded name uses: NFC, lowercase, single spaces. */
export function normalizeText(text: string): string {
  return text.normalize('NFC').toLowerCase().trim().replace(/\s+/g, ' ');
}

/** "lan nguyen" → "Lan Nguyen", "mary-jane o'neil" → "Mary-Jane O'Neil". */
export function titleCase(text: string): string {
  return text.replace(/(^|[\s\-'])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase());
}

/** "bee venom" → "Bee venom". */
export function sentenceCase(text: string): string {
  return text.replace(/^\p{L}/u, (letter) => letter.toUpperCase());
}

/** "+84 912-345 (678)" → "+84912345678". Validation happens separately. */
export function normalizePhone(text: string): string {
  return text.replace(/[\s\-().]/g, '');
}

export function codePointLength(text: string): number {
  return [...text].length;
}
