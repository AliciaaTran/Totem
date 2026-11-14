import { describe, expect, it } from 'vitest';
import {
  DecodeError,
  ValidationError,
  decodeProfile,
  encodeProfile,
  measureProfile,
  payloadToCard,
  profileToPayload,
} from '../src/core/codec';
import { findWarnings, toReadable } from '../src/core/display';
import { CaseType, Relation, Severity, Unit, type Case, type Contact, type Profile } from '../src/core/schema';
import { getTables } from '../src/core/tables';
import { normalizeText } from '../src/core/text';

const tables = getTables();
const id = (type: CaseType, name: string) => {
  const tokenId = tables.terms[type].lookup(name);
  if (tokenId === undefined) throw new Error(`Not in table: ${name}`);
  return tokenId;
};

const allergy = (name: string, severity: Severity): Case => ({
  type: CaseType.Allergy,
  name: { known: true, tokenId: id(CaseType.Allergy, name) },
  dose: null,
  severity,
});
const medication = (name: string, dose: Case['dose']): Case => ({
  type: CaseType.Medication,
  name: { known: true, tokenId: id(CaseType.Medication, name) },
  dose,
  severity: null,
});
const condition = (name: string, severity: Severity): Case => ({
  type: CaseType.Condition,
  name: { known: true, tokenId: id(CaseType.Condition, name) },
  dose: null,
  severity,
});
const contact = (name: string, phone: string, relation = Relation.Parent): Contact => ({ name, phone, relation });

/** What we expect back: free text is stored lowercase (title-cased on display). */
function expected(p: Profile): Profile {
  return {
    cases: p.cases.map((c) => (c.name.known ? c : { ...c, name: { known: false, text: normalizeText(c.name.text) } })),
    contacts: p.contacts.map((k) => ({ ...k, name: normalizeText(k.name) })),
  };
}

function roundTrip(p: Profile): Profile {
  const card = payloadToCard(profileToPayload(p));
  expect(card.version).toBe(1);
  return card.profile;
}

const sample: Profile = {
  cases: [
    allergy('Penicillin', Severity.LifeThreatening),
    allergy('Peanuts', Severity.Severe),
    medication('Metformin', { amount: 500, unit: Unit.mg }),
    medication('Salbutamol', null),
    condition('Type 2 diabetes', Severity.Moderate),
  ],
  contacts: [contact('Lan Nguyen', '+84912345678'), contact('Minh Tran', '0987654321', Relation.Sibling)],
};

describe('round trips', () => {
  it('sample profile', () => {
    expect(roundTrip(sample)).toEqual(expected(sample));
  });

  it('empty profile', () => {
    expect(roundTrip({ cases: [], contacts: [] })).toEqual({ cases: [], contacts: [] });
  });

  it('every term in every table', () => {
    for (const type of [CaseType.Allergy, CaseType.Medication, CaseType.Condition]) {
      const table = tables.terms[type];
      for (let start = 0; start < table.size; start += 31) {
        const cases: Case[] = table.byId.slice(start, start + 31).map((t) => ({
          type,
          name: { known: true, tokenId: t.tokenId },
          dose: type === CaseType.Medication ? { amount: 10, unit: Unit.mg } : null,
          severity: type === CaseType.Medication ? null : Severity.Mild,
        }));
        expect(roundTrip({ cases, contacts: [] })).toEqual({ cases, contacts: [] });
      }
    }
  });

  it('unknown names are spelled out and come back lowercase', () => {
    const p: Profile = {
      cases: [{ type: CaseType.Allergy, name: { known: false, text: 'Kiwi  Fruit' }, dose: null, severity: Severity.Mild }],
      contacts: [],
    };
    expect(roundTrip(p).cases[0].name).toEqual({ known: false, text: 'kiwi fruit' });
  });

  it('accented and non-Latin names use ESCAPE', () => {
    const p: Profile = {
      cases: [],
      contacts: [contact('Nguyễn Văn Đức', '0912345678'), contact('王小明', '+8613800138000')],
    };
    expect(roundTrip(p)).toEqual(expected(p));
  });

  it.each([
    [500, Unit.mg],
    [1, Unit.pill],
    [0.5, Unit.ml],
    [0.125, Unit.mg],
    [2.5, Unit.mcg],
    [1000, Unit.IU],
    [2, Unit.puff],
  ])('dose %d', (amount, unit) => {
    const p: Profile = { cases: [medication('Insulin', { amount, unit })], contacts: [] };
    expect(roundTrip(p)).toEqual(p);
  });

  it('phone numbers keep leading zeros and +', () => {
    const p: Profile = {
      cases: [],
      contacts: [contact('A', '0012345'), contact('B', '+0084'), contact('C', '911')],
    };
    expect(roundTrip(p).contacts.map((k) => k.phone)).toEqual(['0012345', '+0084', '911']);
  });

  it('maximum card: 31 cases and 7 contacts', () => {
    const p: Profile = {
      cases: Array.from({ length: 31 }, (_, i) => allergy(i % 2 ? 'Latex' : 'Eggs', Severity.Moderate)),
      contacts: Array.from({ length: 7 }, (_, i) => contact(`Person ${i}`, `09000000${i}`, i as Relation)),
    };
    expect(roundTrip(p)).toEqual(expected(p));
  });
});

describe('size', () => {
  it('a known allergy costs only a few bits', () => {
    const one = { cases: [allergy('Penicillin', Severity.Severe)], contacts: [] };
    const stats = measureProfile(one, toReadable(one, tables));
    // header 12 + type 2 + flag 1 + code + severity 2
    expect(stats.encodedBits).toBeLessThanOrEqual(12 + 2 + 1 + 3 + 2);
  });

  it('the sample is much smaller than readable JSON', () => {
    const stats = measureProfile(sample, toReadable(sample, tables));
    expect(stats.encodedBytes * 4).toBeLessThan(stats.readableBytes);
    expect(stats.payloadChars).toBe(Math.ceil((stats.encodedBytes * 8) / 6));
  });
});

describe('validation', () => {
  const problems = (p: Profile) => {
    try {
      encodeProfile(p);
      return [];
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      return (e as ValidationError).problems;
    }
  };

  it('rejects too many cases or contacts', () => {
    expect(problems({ cases: Array(32).fill(allergy('Latex', Severity.Mild)), contacts: [] })).toHaveLength(1);
    expect(problems({ cases: [], contacts: Array(8).fill(contact('A', '123')) })).toHaveLength(1);
  });

  it('requires severity for allergies and conditions, and none for medications', () => {
    expect(problems({ cases: [{ ...allergy('Latex', Severity.Mild), severity: null }], contacts: [] })).toEqual([
      'Case 1: Choose a severity.',
    ]);
    expect(problems({ cases: [{ ...medication('Insulin', null), severity: Severity.Mild }], contacts: [] })).toEqual([
      'Case 1: Medications have no severity.',
    ]);
  });

  it('rejects bad doses', () => {
    for (const amount of [0, -1, 0.0001, Number.NaN, Infinity]) {
      expect(problems({ cases: [medication('Insulin', { amount, unit: Unit.IU })], contacts: [] })).toHaveLength(1);
    }
  });

  it('rejects bad names and phones', () => {
    const blank: Case = { type: CaseType.Allergy, name: { known: false, text: '   ' }, dose: null, severity: Severity.Mild };
    expect(problems({ cases: [blank], contacts: [] })).toEqual(['Case 1: Name is empty.']);
    expect(problems({ cases: [], contacts: [contact('A', '12')] })).toHaveLength(1);
    expect(problems({ cases: [], contacts: [contact('A', '12+34')] })).toHaveLength(1);
    expect(problems({ cases: [], contacts: [contact('x'.repeat(61), '1234')] })).toHaveLength(1);
  });
});

describe('decoding bad data', () => {
  it('rejects garbage, truncation and extra bytes', () => {
    const bytes = encodeProfile(sample);
    expect(() => decodeProfile(bytes.slice(0, bytes.length - 3))).toThrow(DecodeError);
    expect(() => decodeProfile(Uint8Array.from([...bytes, 0, 0]))).toThrow(DecodeError);
    expect(() => payloadToCard('not a payload!')).toThrow(DecodeError);
  });

  it('rejects unknown versions with a clear message', () => {
    expect(() => decodeProfile(Uint8Array.from([0xf0, 0]))).toThrow(/version 15/);
  });
});

describe('warnings', () => {
  it('flags severe allergies and same-class medications', () => {
    const p: Profile = {
      cases: [
        allergy('Penicillin', Severity.LifeThreatening),
        allergy('Aspirin', Severity.Mild),
        medication('Amoxicillin', { amount: 500, unit: Unit.mg }),
        medication('Ibuprofen', null),
        medication('Aspirin', { amount: 81, unit: Unit.mg }),
        medication('Metformin', null),
      ],
      contacts: [],
    };
    expect(findWarnings(p, tables)).toEqual([
      { level: 'critical', message: 'Life-threatening allergy: Penicillin' },
      { level: 'caution', message: 'Amoxicillin is in the same class as a listed allergy (Penicillin).' },
      { level: 'caution', message: 'Ibuprofen is in the same class as a listed allergy (Aspirin).' },
      { level: 'caution', message: 'Aspirin is in the same class as a listed allergy (Aspirin).' },
    ]);
  });

  it('matches unknown names by text', () => {
    const p: Profile = {
      cases: [
        { type: CaseType.Allergy, name: { known: false, text: 'Kiwi' }, dose: null, severity: Severity.Mild },
        { type: CaseType.Medication, name: { known: false, text: 'kiwi' }, dose: null, severity: null },
      ],
      contacts: [],
    };
    expect(findWarnings(p, tables)).toHaveLength(1);
  });
});
