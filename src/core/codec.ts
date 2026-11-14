// Profile ⇄ bits. This is the only place Huffman encoding happens.
//
//   HEADER   version (4) | caseCount (5) | contactCount (3)
//
//   HOLDER   card holder's name: free-text Huffman codes, then END
//            (a blank name is just END)
//
//   CASE     type (2)
//            flag (1)    0 → Huffman code from that type's term table
//                        1 → free-text Huffman codes per character, then END
//            medication: hasDose (1)
//                          1 → decimal flag (1) [+ decimal places − 1 (2)]
//                              amount as a variable-length number (3-bit chunks)
//                              unit (3)
//            allergy / condition: severity (2)
//
//   CONTACT  name: free-text Huffman codes, then END
//            phone: 4 bits per symbol (0–9 digits, 10 = "+"), then 15 = END
//            relation (3)

import { fromBase64Url, toBase64Url } from './base64url';
import { BitReader, BitWriter } from './bits';
import {
  BITS,
  CaseType,
  MAX_AMOUNT,
  MAX_CASES,
  MAX_CONTACTS,
  MAX_DECIMALS,
  MAX_PHONE_LENGTH,
  MAX_TEXT_LENGTH,
  type Case,
  type Contact,
  type Dose,
  type Name,
  type Profile,
  type Relation,
  type Severity,
  type Unit,
  UNITS,
} from './schema';
import { getTables, type TableSet, UnsupportedVersionError } from './tables';
import { codePointLength, normalizeText } from './text';

const PHONE_PLUS = 10;
const PHONE_END = 15;
const PHONE_PATTERN = new RegExp(`^\\+?\\d{3,${MAX_PHONE_LENGTH - 1}}$`);

export class ValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join(' '));
    this.name = 'ValidationError';
  }
}

export class DecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecodeError';
  }
}

export interface DecodedCard {
  version: number;
  profile: Profile;
}

// ---------- validation ----------

/** Splits 0.125 into { scaled: 125, places: 3 }. null if it can't be stored. */
export function splitAmount(amount: number): { scaled: number; places: number } | null {
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) return null;
  for (let places = 0; places <= MAX_DECIMALS; places++) {
    const scaled = Math.round(amount * 10 ** places);
    if (scaled / 10 ** places === amount) return { scaled, places };
  }
  return null;
}

function validateText(text: string, what: string): string[] {
  const normalized = normalizeText(text);
  if (!normalized) return [`${what} is empty.`];
  if (codePointLength(normalized) > MAX_TEXT_LENGTH) return [`${what} is longer than ${MAX_TEXT_LENGTH} characters.`];
  if (/\p{C}/u.test(normalized)) return [`${what} contains characters that can't be stored.`];
  return [];
}

export function validateCase(c: Case, tables: TableSet = getTables()): string[] {
  const problems: string[] = [];
  if (![CaseType.Allergy, CaseType.Medication, CaseType.Condition].includes(c.type)) {
    return ['Choose a type.'];
  }
  if (c.name.known) {
    const id = c.name.tokenId;
    if (!Number.isInteger(id) || id < 0 || id >= tables.terms[c.type].size) problems.push('Unknown term.');
  } else {
    problems.push(...validateText(c.name.text, 'Name'));
  }

  if (c.type === CaseType.Medication) {
    if (c.severity !== null) problems.push('Medications have no severity.');
    if (c.dose !== null) {
      if (!splitAmount(c.dose.amount)) {
        problems.push(`Dose must be a number above 0 with at most ${MAX_DECIMALS} decimal places.`);
      }
      if (!(UNITS as readonly number[]).includes(c.dose.unit)) problems.push('Choose a unit.');
    }
  } else {
    if (c.dose !== null) problems.push('Only medications have a dose.');
    if (c.severity === null || !Number.isInteger(c.severity) || c.severity < 0 || c.severity > 3) {
      problems.push('Choose a severity.');
    }
  }
  return problems;
}

export function validateContact(contact: Contact): string[] {
  const problems = validateText(contact.name, 'Contact name');
  if (!PHONE_PATTERN.test(contact.phone)) {
    problems.push('Phone number must be 3–19 digits, optionally starting with +.');
  }
  if (!Number.isInteger(contact.relation) || contact.relation < 0 || contact.relation > 7) {
    problems.push('Choose a relation.');
  }
  return problems;
}

/** The holder's name may be left blank; if given it follows the free-text rules. */
export function validateHolderName(name: string): string[] {
  if (typeof name !== 'string') return ['Your name is missing.'];
  return normalizeText(name) ? validateText(name, 'Your name') : [];
}

export function validateProfile(profile: Profile, tables: TableSet = getTables()): string[] {
  const problems = validateHolderName(profile.name);
  if (profile.cases.length > MAX_CASES) problems.push(`A card holds at most ${MAX_CASES} cases.`);
  if (profile.contacts.length > MAX_CONTACTS) problems.push(`A card holds at most ${MAX_CONTACTS} contacts.`);
  profile.cases.forEach((c, i) => validateCase(c, tables).forEach((p) => problems.push(`Case ${i + 1}: ${p}`)));
  profile.contacts.forEach((k, i) => validateContact(k).forEach((p) => problems.push(`Contact ${i + 1}: ${p}`)));
  return problems;
}

// ---------- encoding ----------

function writeProfile(profile: Profile, tables: TableSet): BitWriter {
  const problems = validateProfile(profile, tables);
  if (problems.length > 0) throw new ValidationError(problems);

  const w = new BitWriter();
  w.writeBits(tables.version, BITS.version);
  w.writeBits(profile.cases.length, BITS.caseCount);
  w.writeBits(profile.contacts.length, BITS.contactCount);
  tables.freeText.encode(w, profile.name);
  for (const c of profile.cases) writeCase(w, c, tables);
  for (const contact of profile.contacts) writeContact(w, contact, tables);
  return w;
}

function writeCase(w: BitWriter, c: Case, tables: TableSet): void {
  w.writeBits(c.type, BITS.caseType);
  if (c.name.known) {
    w.writeBits(0, BITS.flag);
    tables.terms[c.type].huffman.encode(w, c.name.tokenId);
  } else {
    w.writeBits(1, BITS.flag);
    tables.freeText.encode(w, c.name.text);
  }

  if (c.type === CaseType.Medication) {
    if (c.dose === null) {
      w.writeBits(0, BITS.hasDose);
    } else {
      w.writeBits(1, BITS.hasDose);
      const { scaled, places } = splitAmount(c.dose.amount)!;
      if (places === 0) {
        w.writeBits(0, BITS.decimalFlag);
      } else {
        w.writeBits(1, BITS.decimalFlag);
        w.writeBits(places - 1, BITS.decimalPlaces);
      }
      w.writeVarUint(scaled);
      w.writeBits(c.dose.unit, BITS.unit);
    }
  } else {
    w.writeBits(c.severity!, BITS.severity);
  }
}

function writeContact(w: BitWriter, contact: Contact, tables: TableSet): void {
  tables.freeText.encode(w, contact.name);
  for (const ch of contact.phone) {
    w.writeBits(ch === '+' ? PHONE_PLUS : Number(ch), BITS.phoneSymbol);
  }
  w.writeBits(PHONE_END, BITS.phoneSymbol);
  w.writeBits(contact.relation, BITS.relation);
}

export function encodeProfile(profile: Profile, tables: TableSet = getTables()): Uint8Array {
  return writeProfile(profile, tables).toBytes();
}

export function profileToPayload(profile: Profile, tables: TableSet = getTables()): string {
  return toBase64Url(encodeProfile(profile, tables));
}

export interface ProfileStats {
  /** The same data as readable JSON (names spelled out), for comparison. */
  readableBytes: number;
  encodedBits: number;
  encodedBytes: number;
  payloadChars: number;
}

export function measureProfile(profile: Profile, readable: unknown, tables: TableSet = getTables()): ProfileStats {
  const writer = writeProfile(profile, tables);
  const bytes = writer.toBytes();
  return {
    readableBytes: new TextEncoder().encode(JSON.stringify(readable)).length,
    encodedBits: writer.length,
    encodedBytes: bytes.length,
    payloadChars: toBase64Url(bytes).length,
  };
}

// ---------- decoding ----------

function readCase(r: BitReader, tables: TableSet): Case {
  const type = r.readBits(BITS.caseType);
  if (type > CaseType.Condition) throw new DecodeError('This card contains an unknown case type.');
  const caseType = type as CaseType;

  const name: Name =
    r.readBits(BITS.flag) === 0
      ? { known: true, tokenId: tables.terms[caseType].huffman.decode(r) }
      : { known: false, text: tables.freeText.decode(r) };

  if (caseType === CaseType.Medication) {
    let dose: Dose | null = null;
    if (r.readBits(BITS.hasDose) === 1) {
      const places = r.readBits(BITS.decimalFlag) === 1 ? r.readBits(BITS.decimalPlaces) + 1 : 0;
      if (places > MAX_DECIMALS) throw new DecodeError('This card contains an invalid dose.');
      const scaled = r.readVarUint();
      const unit = r.readBits(BITS.unit);
      if (!(UNITS as readonly number[]).includes(unit)) throw new DecodeError('This card contains an unknown unit.');
      dose = { amount: scaled / 10 ** places, unit: unit as Unit };
    }
    return { type: caseType, name, dose, severity: null };
  }
  return { type: caseType, name, dose: null, severity: r.readBits(BITS.severity) as Severity };
}

function readContact(r: BitReader, tables: TableSet): Contact {
  const name = tables.freeText.decode(r);
  let phone = '';
  for (;;) {
    const symbol = r.readBits(BITS.phoneSymbol);
    if (symbol === PHONE_END) break;
    if (symbol === PHONE_PLUS && phone === '') phone = '+';
    else if (symbol <= 9) phone += String(symbol);
    else throw new DecodeError('This card contains an invalid phone number.');
    if (phone.length > MAX_PHONE_LENGTH) throw new DecodeError('This card contains an invalid phone number.');
  }
  return { name, phone, relation: r.readBits(BITS.relation) as Relation };
}

export function decodeProfile(bytes: Uint8Array): DecodedCard {
  try {
    const r = new BitReader(bytes);
    const version = r.readBits(BITS.version);
    const tables = getTables(version);
    const caseCount = r.readBits(BITS.caseCount);
    const contactCount = r.readBits(BITS.contactCount);
    const name = tables.freeText.decode(r);
    const cases: Case[] = [];
    for (let i = 0; i < caseCount; i++) cases.push(readCase(r, tables));
    const contacts: Contact[] = [];
    for (let i = 0; i < contactCount; i++) contacts.push(readContact(r, tables));
    r.assertOnlyPadding();
    return { version, profile: { name, cases, contacts } };
  } catch (error) {
    if (error instanceof DecodeError) throw error;
    if (error instanceof UnsupportedVersionError) throw new DecodeError(error.message);
    throw new DecodeError('This card’s data is damaged or incomplete.');
  }
}

export function payloadToCard(payload: string): DecodedCard {
  let bytes: Uint8Array;
  try {
    bytes = fromBase64Url(payload);
  } catch {
    throw new DecodeError('This link is not a valid Totem card.');
  }
  return decodeProfile(bytes);
}
