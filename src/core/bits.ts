// Bit-level writer and reader. Bits are written most-significant first.

export class BitWriter {
  private bytes: number[] = [];
  private bitLength = 0;

  /** Number of bits written so far. */
  get length(): number {
    return this.bitLength;
  }

  writeBit(bit: number): void {
    const byteIndex = this.bitLength >> 3;
    if (byteIndex === this.bytes.length) this.bytes.push(0);
    if (bit) this.bytes[byteIndex] |= 0x80 >> (this.bitLength & 7);
    this.bitLength++;
  }

  /** Write `value` using exactly `width` bits. */
  writeBits(value: number, width: number): void {
    if (!Number.isInteger(width) || width < 0 || width > 31) {
      throw new RangeError(`Bit width must be 0–31, got ${width}`);
    }
    if (!Number.isInteger(value) || value < 0 || value >= 2 ** width) {
      throw new RangeError(`${value} does not fit in ${width} bits`);
    }
    for (let i = width - 1; i >= 0; i--) this.writeBit((value >>> i) & 1);
  }

  /**
   * Variable-length unsigned number: 3-bit chunks, lowest chunk first.
   * Each chunk is [more (1 bit)][data (3 bits)], so 1 costs 4 bits and 500 costs 12.
   */
  writeVarUint(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`Expected a non-negative whole number, got ${value}`);
    }
    let rest = value;
    do {
      const chunk = rest % 8;
      rest = Math.floor(rest / 8);
      this.writeBit(rest > 0 ? 1 : 0);
      this.writeBits(chunk, 3);
    } while (rest > 0);
  }

  /** The bits packed into bytes; the last byte is padded with zeros. */
  toBytes(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

export class BitReader {
  private pos = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get remaining(): number {
    return this.bytes.length * 8 - this.pos;
  }

  readBit(): number {
    if (this.pos >= this.bytes.length * 8) throw new RangeError('Unexpected end of data');
    const bit = (this.bytes[this.pos >> 3] >> (7 - (this.pos & 7))) & 1;
    this.pos++;
    return bit;
  }

  readBits(width: number): number {
    let value = 0;
    for (let i = 0; i < width; i++) value = value * 2 + this.readBit();
    return value;
  }

  readVarUint(): number {
    let value = 0;
    let scale = 1;
    for (;;) {
      const more = this.readBit();
      value += this.readBits(3) * scale;
      if (!more) return value;
      scale *= 8;
      if (scale > Number.MAX_SAFE_INTEGER) throw new RangeError('Number too large');
    }
  }

  /** After the last field, only the zero padding of the final byte may remain. */
  assertOnlyPadding(): void {
    if (this.remaining >= 8) throw new RangeError('Extra data after the end of the card');
    while (this.remaining > 0) {
      if (this.readBit()) throw new RangeError('Padding bits must be zero');
    }
  }
}
