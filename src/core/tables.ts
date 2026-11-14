// The universal tables. Built from the term lists on first use; the build is
// deterministic, so every device ends up with identical tables for a version.

import { ALLERGIES_V1, CONDITIONS_V1, MEDICATIONS_V1, SAMPLE_NAMES_V1, type TermSpec } from '../data/terms-v1';
import { FreeTextCodec } from './freetext';
import { HashTable } from './hashtable';
import { HuffmanCodec } from './huffman';
import { CaseType, FORMAT_VERSION } from './schema';
import { normalizeText } from './text';

export interface TermEntry {
  tokenId: number;
  display: string;
  categories: readonly string[];
}

/** One term list: hash table (name → token ID), array (token ID → entry), Huffman table. */
export class TermTable {
  readonly byId: readonly TermEntry[];
  /** Normalized name or alias → token ID. Used for encoding and exact-match checks. */
  readonly byName: HashTable<number>;
  /** Every word-start prefix → token IDs, most frequent first. Used for autocomplete. */
  private readonly prefixIndex: HashTable<number[]>;
  readonly huffman: HuffmanCodec;

  constructor(specs: readonly TermSpec[]) {
    this.byId = specs.map((spec, tokenId) => ({ tokenId, display: spec.name, categories: spec.categories ?? [] }));
    this.byName = new HashTable<number>(specs.length * 4);
    this.prefixIndex = new HashTable<number[]>(specs.length * 32);

    const keysOf = (spec: TermSpec) => [spec.name, ...(spec.aliases ?? [])].map(normalizeText);

    specs.forEach((spec, tokenId) => {
      for (const key of keysOf(spec)) {
        const existing = this.byName.get(key);
        if (existing !== undefined && existing !== tokenId) throw new Error(`Duplicate term "${key}"`);
        this.byName.set(key, tokenId);
      }
    });

    const byFrequency = specs.map((_, id) => id).sort((a, b) => specs[b].freq - specs[a].freq || a - b);
    for (const tokenId of byFrequency) {
      for (const key of keysOf(specs[tokenId])) {
        for (const start of wordStarts(key)) {
          for (let end = start + 1; end <= key.length; end++) {
            const prefix = key.slice(start, end);
            const ids = this.prefixIndex.get(prefix);
            if (!ids) this.prefixIndex.set(prefix, [tokenId]);
            else if (!ids.includes(tokenId)) ids.push(tokenId);
          }
        }
      }
    }

    this.huffman = new HuffmanCodec(specs.map((spec) => spec.freq));
  }

  get size(): number {
    return this.byId.length;
  }

  /** Exact match on the name or an alias. */
  lookup(text: string): number | undefined {
    return this.byName.get(normalizeText(text));
  }

  /** Autocomplete: terms with a word starting with `text`, most common first. */
  suggest(text: string, limit = 6): TermEntry[] {
    const key = normalizeText(text);
    if (!key) return [];
    return (this.prefixIndex.get(key) ?? []).slice(0, limit).map((id) => this.byId[id]);
  }
}

function wordStarts(key: string): number[] {
  const starts = [0];
  for (let i = 0; i < key.length - 1; i++) {
    if (key[i] === ' ' || key[i] === '-') starts.push(i + 1);
  }
  return starts;
}

export interface TableSet {
  version: number;
  terms: Record<CaseType, TermTable>;
  freeText: FreeTextCodec;
}

export class UnsupportedVersionError extends Error {
  constructor(version: number) {
    super(`This card uses format version ${version}, which this page does not support.`);
    this.name = 'UnsupportedVersionError';
  }
}

const BUILDERS: Record<number, () => TableSet> = {
  1: () => {
    const lists = [ALLERGIES_V1, MEDICATIONS_V1, CONDITIONS_V1];
    const corpus = [
      ...lists.flatMap((list) => list.flatMap((spec) => [spec.name, ...(spec.aliases ?? [])])),
      ...SAMPLE_NAMES_V1,
    ];
    return {
      version: 1,
      terms: {
        [CaseType.Allergy]: new TermTable(ALLERGIES_V1),
        [CaseType.Medication]: new TermTable(MEDICATIONS_V1),
        [CaseType.Condition]: new TermTable(CONDITIONS_V1),
      },
      freeText: new FreeTextCodec(corpus, 3),
    };
  },
};

const cache = new Map<number, TableSet>();

export function getTables(version = FORMAT_VERSION): TableSet {
  let tables = cache.get(version);
  if (!tables) {
    const build = BUILDERS[version];
    if (!build) throw new UnsupportedVersionError(version);
    tables = build();
    cache.set(version, tables);
  }
  return tables;
}
