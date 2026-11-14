import { describe, expect, it } from 'vitest';
import { BitReader, BitWriter } from '../src/core/bits';
import { HuffmanCodec, huffmanCodeLengths } from '../src/core/huffman';
import { getTables } from '../src/core/tables';
import { CaseType } from '../src/core/schema';

function isPrefixFree(codes: string[]): boolean {
  return codes.every((a, i) => codes.every((b, j) => i === j || !b.startsWith(a)));
}

describe('Huffman', () => {
  const freqs = [40, 35, 22, 20, 20, 15, 3, 2, 2, 1];
  const codec = new HuffmanCodec(freqs);
  const codes = freqs.map((_, s) => codec.codeString(s));

  it('produces prefix-free codes that exactly fill the tree (Kraft sum = 1)', () => {
    expect(isPrefixFree(codes)).toBe(true);
    expect(codec.lengths.reduce((sum, len) => sum + 2 ** -len, 0)).toBe(1);
  });

  it('gives more frequent symbols codes that are no longer', () => {
    for (let a = 0; a < freqs.length; a++) {
      for (let b = 0; b < freqs.length; b++) {
        if (freqs[a] > freqs[b]) expect(codec.lengths[a]).toBeLessThanOrEqual(codec.lengths[b]);
      }
    }
  });

  it('is canonical: codes count up in (length, symbol) order', () => {
    const order = codes.map((_, s) => s).sort((a, b) => codec.lengths[a] - codec.lengths[b] || a - b);
    const asNumbers = order.map((s) => parseInt(codes[s], 2) * 2 ** (32 - codec.lengths[s]));
    expect([...asNumbers].sort((a, b) => a - b)).toEqual(asNumbers);
  });

  it('is deterministic', () => {
    expect(new HuffmanCodec(freqs).codes).toEqual(codec.codes);
  });

  it('round-trips a long random message', () => {
    const message = Array.from({ length: 500 }, (_, i) => (i * 7919) % freqs.length);
    const w = new BitWriter();
    message.forEach((s) => codec.encode(w, s));
    const r = new BitReader(w.toBytes());
    expect(message.map(() => codec.decode(r))).toEqual(message);
  });

  it('handles a one-symbol alphabet', () => {
    expect(huffmanCodeLengths([5])).toEqual([1]);
  });

  it('rejects zero frequencies', () => {
    expect(() => huffmanCodeLengths([3, 0])).toThrow();
  });
});

describe('universal tables', () => {
  const tables = getTables();

  it('gives the most common allergy one of the shortest codes', () => {
    const allergy = tables.terms[CaseType.Allergy];
    const penicillin = allergy.lookup('Penicillin')!;
    expect(allergy.huffman.lengths[penicillin]).toBe(Math.min(...allergy.huffman.lengths));
  });

  it('gives common letters shorter codes than rare ones', () => {
    const { huffman } = tables.freeText;
    const code = (ch: string) => huffman.lengths["abcdefghijklmnopqrstuvwxyz0123456789 .-',/".indexOf(ch)];
    expect(code('e')).toBeLessThan(code('q'));
    expect(code(' ')).toBeLessThan(code('/'));
  });

  it('looks up names and aliases case-insensitively', () => {
    const meds = tables.terms[CaseType.Medication];
    expect(meds.lookup('  ALBUTEROL ')).toBe(meds.lookup('salbutamol'));
    expect(meds.lookup('unobtainium')).toBeUndefined();
  });

  it('suggests by any word start, most common first', () => {
    const conditions = tables.terms[CaseType.Condition];
    expect(conditions.suggest('diab').map((t) => t.display)).toEqual(['Type 2 diabetes', 'Type 1 diabetes']);
    expect(conditions.suggest('fib').map((t) => t.display)).toEqual(['Atrial fibrillation']);
    expect(conditions.suggest('')).toEqual([]);
  });
});
