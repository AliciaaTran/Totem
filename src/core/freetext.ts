// The universal free-text Huffman table: used for contact names and for any
// case name that is not in the term lists.

import type { BitReader, BitWriter } from './bits';
import { HashTable } from './hashtable';
import { HuffmanCodec } from './huffman';
import { MAX_TEXT_LENGTH } from './schema';
import { normalizeText } from './text';

/** Characters with their own Huffman code. Anything else goes through ESCAPE. */
export const FREE_TEXT_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789 .-',/";

export class FreeTextCodec {
  /** Marks the end of a name. */
  readonly END = FREE_TEXT_CHARS.length;
  /** Next comes a raw Unicode code point (accented letters etc.). */
  readonly ESCAPE = FREE_TEXT_CHARS.length + 1;
  readonly huffman: HuffmanCodec;
  private readonly index = new HashTable<number>(64);

  /**
   * @param corpus training strings; character frequencies are counted from them.
   * @param escapeWeight how common escaped characters are assumed to be.
   */
  constructor(corpus: readonly string[], escapeWeight: number) {
    [...FREE_TEXT_CHARS].forEach((ch, i) => this.index.set(ch, i));

    // Start every symbol at 1 so each one gets a code even if the corpus lacks it.
    const counts = new Array<number>(FREE_TEXT_CHARS.length + 2).fill(1);
    for (const text of corpus) {
      for (const ch of normalizeText(text)) {
        const symbol = this.index.get(ch);
        if (symbol !== undefined) counts[symbol]++;
      }
    }
    counts[this.END] += corpus.length; // each string ends exactly once
    counts[this.ESCAPE] = escapeWeight;
    this.huffman = new HuffmanCodec(counts);
  }

  encode(writer: BitWriter, text: string): void {
    for (const ch of normalizeText(text)) {
      const symbol = this.index.get(ch);
      if (symbol !== undefined) {
        this.huffman.encode(writer, symbol);
      } else {
        this.huffman.encode(writer, this.ESCAPE);
        writer.writeVarUint(ch.codePointAt(0)!);
      }
    }
    this.huffman.encode(writer, this.END);
  }

  decode(reader: BitReader): string {
    let text = '';
    let length = 0;
    for (;;) {
      const symbol = this.huffman.decode(reader);
      if (symbol === this.END) return text;
      if (++length > MAX_TEXT_LENGTH) throw new RangeError('Name is too long');
      if (symbol === this.ESCAPE) {
        const codePoint = reader.readVarUint();
        if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
          throw new RangeError('Invalid character');
        }
        text += String.fromCodePoint(codePoint);
      } else {
        text += FREE_TEXT_CHARS[symbol];
      }
    }
  }
}
