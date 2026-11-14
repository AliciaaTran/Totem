// A string-keyed hash table with open addressing and linear probing.
// Hash function: 32-bit FNV-1a. Grows to keep the load factor under 0.7.

const EMPTY = 0;
const FULL = 1;
const DELETED = 2; // tombstone: keeps probe chains intact after a delete

const MAX_LOAD = 0.7;

export class HashTable<V> {
  private keys: (string | undefined)[] = [];
  private values: (V | undefined)[] = [];
  private states = new Uint8Array(0);
  private count = 0; // FULL slots
  private used = 0; // FULL + DELETED slots

  constructor(initialCapacity = 16) {
    let capacity = 8;
    while (capacity < initialCapacity) capacity *= 2;
    this.allocate(capacity);
  }

  static hash(key: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  get size(): number {
    return this.count;
  }

  get capacity(): number {
    return this.states.length;
  }

  get(key: string): V | undefined {
    const index = this.find(key);
    return index < 0 ? undefined : this.values[index];
  }

  has(key: string): boolean {
    return this.find(key) >= 0;
  }

  set(key: string, value: V): void {
    if ((this.used + 1) / this.capacity > MAX_LOAD) {
      // Mostly tombstones? Rebuild at the same size; otherwise double.
      this.resize(this.count + 1 > this.capacity * MAX_LOAD * 0.5 ? this.capacity * 2 : this.capacity);
    }
    const mask = this.capacity - 1;
    let index = HashTable.hash(key) & mask;
    let firstDeleted = -1;
    for (;;) {
      const state = this.states[index];
      if (state === EMPTY) {
        const target = firstDeleted >= 0 ? firstDeleted : index;
        if (target === index) this.used++;
        this.states[target] = FULL;
        this.keys[target] = key;
        this.values[target] = value;
        this.count++;
        return;
      }
      if (state === DELETED) {
        if (firstDeleted < 0) firstDeleted = index;
      } else if (this.keys[index] === key) {
        this.values[index] = value;
        return;
      }
      index = (index + 1) & mask;
    }
  }

  delete(key: string): boolean {
    const index = this.find(key);
    if (index < 0) return false;
    this.states[index] = DELETED;
    this.keys[index] = undefined;
    this.values[index] = undefined;
    this.count--;
    return true;
  }

  *entries(): IterableIterator<[string, V]> {
    for (let i = 0; i < this.capacity; i++) {
      if (this.states[i] === FULL) yield [this.keys[i]!, this.values[i]!];
    }
  }

  private find(key: string): number {
    const mask = this.capacity - 1;
    let index = HashTable.hash(key) & mask;
    for (let probes = 0; probes < this.capacity; probes++) {
      const state = this.states[index];
      if (state === EMPTY) return -1;
      if (state === FULL && this.keys[index] === key) return index;
      index = (index + 1) & mask;
    }
    return -1;
  }

  private allocate(capacity: number): void {
    this.keys = new Array(capacity);
    this.values = new Array(capacity);
    this.states = new Uint8Array(capacity);
    this.count = 0;
    this.used = 0;
  }

  private resize(capacity: number): void {
    const old = [...this.entries()];
    this.allocate(capacity);
    for (const [key, value] of old) this.set(key, value);
  }
}
