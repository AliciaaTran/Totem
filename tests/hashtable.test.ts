import { describe, expect, it } from 'vitest';
import { HashTable } from '../src/core/hashtable';

describe('HashTable', () => {
  it('stores, overwrites and misses', () => {
    const t = new HashTable<number>();
    t.set('penicillin', 0);
    t.set('peanuts', 1);
    t.set('peanuts', 2);
    expect(t.get('penicillin')).toBe(0);
    expect(t.get('peanuts')).toBe(2);
    expect(t.get('latex')).toBeUndefined();
    expect(t.size).toBe(2);
  });

  it('grows and keeps every key', () => {
    const t = new HashTable<number>(8);
    for (let i = 0; i < 5000; i++) t.set(`key-${i}`, i);
    expect(t.size).toBe(5000);
    expect(t.size / t.capacity).toBeLessThanOrEqual(0.7);
    for (let i = 0; i < 5000; i++) expect(t.get(`key-${i}`)).toBe(i);
  });

  it('finds keys placed after a deleted slot (tombstones)', () => {
    const t = new HashTable<number>(8);
    for (let i = 0; i < 5; i++) t.set(`k${i}`, i);
    expect(t.delete('k1')).toBe(true);
    expect(t.delete('k1')).toBe(false);
    for (let i = 0; i < 5; i++) expect(t.get(`k${i}`)).toBe(i === 1 ? undefined : i);
    t.set('k1', 11);
    expect(t.get('k1')).toBe(11);
    expect(t.size).toBe(5);
  });

  it('survives many insert/delete cycles without filling up with tombstones', () => {
    const t = new HashTable<number>(8);
    for (let i = 0; i < 2000; i++) {
      t.set(`x${i}`, i);
      t.delete(`x${i}`);
    }
    expect(t.size).toBe(0);
    expect(t.capacity).toBeLessThanOrEqual(16);
    t.set('a', 1);
    expect(t.get('a')).toBe(1);
  });

  it('lists entries', () => {
    const t = new HashTable<string>();
    t.set('a', 'A');
    t.set('b', 'B');
    expect(new Map(t.entries())).toEqual(new Map([['a', 'A'], ['b', 'B']]));
  });
});
