// Canonical Huffman coding.
//
// 1. Build a Huffman tree from symbol frequencies (min-heap, deterministic ties).
// 2. Keep only each symbol's code LENGTH (its depth in the tree).
// 3. Assign canonical codes from the lengths: sort by (length, symbol) and count up.
//
// Because step 3 depends only on the lengths, every device that builds the table
// from the same frequency list gets exactly the same codes.

import type { BitReader, BitWriter } from './bits';

const MAX_CODE_LENGTH = 30;

interface Node {
  weight: number;
  order: number; // tie-breaker so the tree is the same on every device
  symbol: number; // -1 for internal nodes
  left: Node | null;
  right: Node | null;
}

class MinHeap {
  private items: Node[] = [];

  get size(): number {
    return this.items.length;
  }

  push(node: Node): void {
    const items = this.items;
    items.push(node);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!less(items[i], items[parent])) break;
      [items[i], items[parent]] = [items[parent], items[i]];
      i = parent;
    }
  }

  pop(): Node {
    const items = this.items;
    const top = items[0];
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let smallest = i;
        if (l < items.length && less(items[l], items[smallest])) smallest = l;
        if (r < items.length && less(items[r], items[smallest])) smallest = r;
        if (smallest === i) break;
        [items[i], items[smallest]] = [items[smallest], items[i]];
        i = smallest;
      }
    }
    return top;
  }
}

function less(a: Node, b: Node): boolean {
  return a.weight < b.weight || (a.weight === b.weight && a.order < b.order);
}

/** Code length for every symbol. Every frequency must be positive. */
export function huffmanCodeLengths(frequencies: readonly number[]): number[] {
  const n = frequencies.length;
  if (n === 0) throw new Error('A Huffman table needs at least one symbol');
  frequencies.forEach((f, symbol) => {
    if (!(f > 0) || !Number.isFinite(f)) throw new Error(`Symbol ${symbol} needs a positive frequency`);
  });
  if (n === 1) return [1];

  const heap = new MinHeap();
  frequencies.forEach((weight, symbol) => heap.push({ weight, order: symbol, symbol, left: null, right: null }));
  let order = n;
  while (heap.size > 1) {
    const a = heap.pop();
    const b = heap.pop();
    heap.push({ weight: a.weight + b.weight, order: order++, symbol: -1, left: a, right: b });
  }

  const lengths = new Array<number>(n).fill(0);
  const stack: [Node, number][] = [[heap.pop(), 0]];
  while (stack.length > 0) {
    const [node, depth] = stack.pop()!;
    if (node.symbol >= 0) lengths[node.symbol] = depth;
    else stack.push([node.left!, depth + 1], [node.right!, depth + 1]);
  }
  return lengths;
}

/** Canonical codes from code lengths. */
export function canonicalCodes(lengths: readonly number[]): number[] {
  const order = lengths.map((_, symbol) => symbol).sort((a, b) => lengths[a] - lengths[b] || a - b);
  const codes = new Array<number>(lengths.length).fill(0);
  let code = 0;
  let previousLength = lengths[order[0]];
  for (const symbol of order) {
    const length = lengths[symbol];
    if (length > MAX_CODE_LENGTH) throw new Error(`Code for symbol ${symbol} is too long (${length} bits)`);
    code *= 2 ** (length - previousLength);
    codes[symbol] = code;
    code++;
    previousLength = length;
  }
  return codes;
}

export class HuffmanCodec {
  readonly lengths: readonly number[];
  readonly codes: readonly number[];

  // Decode tree stored as parallel arrays. Node 0 is the root.
  private readonly zero: number[] = [-1];
  private readonly one: number[] = [-1];
  private readonly leaf: number[] = [-1];

  constructor(frequencies: readonly number[]) {
    this.lengths = huffmanCodeLengths(frequencies);
    this.codes = canonicalCodes(this.lengths);
    this.codes.forEach((code, symbol) => this.insert(symbol, code, this.lengths[symbol]));
  }

  get symbolCount(): number {
    return this.lengths.length;
  }

  encode(writer: BitWriter, symbol: number): void {
    if (!Number.isInteger(symbol) || symbol < 0 || symbol >= this.symbolCount) {
      throw new RangeError(`Unknown symbol ${symbol}`);
    }
    writer.writeBits(this.codes[symbol], this.lengths[symbol]);
  }

  /** Walk the tree one bit at a time (0 = left, 1 = right) until a leaf. */
  decode(reader: BitReader): number {
    let node = 0;
    while (this.leaf[node] < 0) {
      const next = reader.readBit() ? this.one[node] : this.zero[node];
      if (next < 0) throw new RangeError('Invalid Huffman code');
      node = next;
    }
    return this.leaf[node];
  }

  /** The code as a string of 0s and 1s, for display and tests. */
  codeString(symbol: number): string {
    return this.codes[symbol].toString(2).padStart(this.lengths[symbol], '0');
  }

  private insert(symbol: number, code: number, length: number): void {
    let node = 0;
    for (let i = length - 1; i >= 0; i--) {
      const bit = Math.floor(code / 2 ** i) % 2;
      const children = bit ? this.one : this.zero;
      if (children[node] < 0) {
        children[node] = this.leaf.length;
        this.zero.push(-1);
        this.one.push(-1);
        this.leaf.push(-1);
      }
      node = children[node];
    }
    this.leaf[node] = symbol;
  }
}
