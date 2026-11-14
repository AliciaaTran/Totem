import { describe, expect, it } from 'vitest';
import { BitReader, BitWriter } from '../src/core/bits';
import { fromBase64Url, toBase64Url } from '../src/core/base64url';

describe('BitWriter / BitReader', () => {
  it('round-trips fixed-width values', () => {
    const w = new BitWriter();
    w.writeBits(1, 4);
    w.writeBits(31, 5);
    w.writeBits(0, 3);
    w.writeBits(5, 3);
    expect(w.length).toBe(15);
    const r = new BitReader(w.toBytes());
    expect([r.readBits(4), r.readBits(5), r.readBits(3), r.readBits(3)]).toEqual([1, 31, 0, 5]);
    r.assertOnlyPadding();
  });

  it('rejects values that do not fit', () => {
    expect(() => new BitWriter().writeBits(8, 3)).toThrow(RangeError);
    expect(() => new BitWriter().writeBits(-1, 3)).toThrow(RangeError);
  });

  it('throws when reading past the end', () => {
    const r = new BitReader(new Uint8Array([0xff]));
    r.readBits(8);
    expect(() => r.readBit()).toThrow(RangeError);
  });

  it('rejects trailing data and non-zero padding', () => {
    expect(() => new BitReader(new Uint8Array([0, 0])).assertOnlyPadding()).toThrow();
    const r = new BitReader(new Uint8Array([0b10000001]));
    r.readBit();
    expect(() => r.assertOnlyPadding()).toThrow();
  });
});

describe('variable-length numbers', () => {
  it.each([0, 1, 7, 8, 63, 64, 500, 1000, 125, 2 ** 40])('round-trips %d', (value) => {
    const w = new BitWriter();
    w.writeVarUint(value);
    expect(new BitReader(w.toBytes()).readVarUint()).toBe(value);
  });

  it.each([
    [1, 4],
    [5, 4],
    [7, 4],
    [8, 8],
    [500, 12],
    [1000, 16],
  ])('%d costs %d bits', (value, bits) => {
    const w = new BitWriter();
    w.writeVarUint(value);
    expect(w.length).toBe(bits);
  });
});

describe('base64url', () => {
  it('round-trips every length 0–20', () => {
    for (let n = 0; n <= 20; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 97 + 13) % 256);
      const text = toBase64Url(bytes);
      expect(text).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(fromBase64Url(text)).toEqual(bytes);
    }
  });

  it('matches standard base64 apart from the alphabet and padding', () => {
    const bytes = Uint8Array.from([251, 255, 191, 0, 1]);
    const standard = Buffer.from(bytes).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    expect(toBase64Url(bytes)).toBe(standard);
  });

  it('rejects invalid input', () => {
    expect(() => fromBase64Url('ab+c')).toThrow();
    expect(() => fromBase64Url('abcde')).toThrow();
  });
});
