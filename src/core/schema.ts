// The shape of a card, as the form stores it in memory.
// These are plain values (token IDs, typed text, numbers). Huffman codes only
// exist inside encodeProfile(), which runs when the user taps Generate.

/** Version of the bit format AND the tables. Bump it when any table changes. */
export const FORMAT_VERSION = 1;

export enum CaseType {
  Allergy = 0,
  Medication = 1,
  Condition = 2,
}

export enum Unit {
  mg = 0,
  mcg = 1,
  ml = 2,
  pill = 3,
  IU = 4,
  puff = 5,
}

export enum Severity {
  Mild = 0,
  Moderate = 1,
  Severe = 2,
  LifeThreatening = 3,
}

export enum Relation {
  Parent = 0,
  Partner = 1,
  Child = 2,
  Sibling = 3,
  Friend = 4,
  Caregiver = 5,
  Doctor = 6,
  Other = 7,
}

/** flag 0 = known term (token ID), flag 1 = unknown term (spelled out). */
export type Name =
  | { known: true; tokenId: number }
  | { known: false; text: string };

export interface Dose {
  amount: number;
  unit: Unit;
}

export interface Case {
  type: CaseType;
  name: Name;
  /** Medication only. null = not a medication, or "No fixed dose". */
  dose: Dose | null;
  /** Allergy and condition only. null for medications. */
  severity: Severity | null;
}

export interface Contact {
  name: string;
  /** Digits with an optional leading "+", e.g. "+84912345678". */
  phone: string;
  relation: Relation;
}

export interface Profile {
  cases: Case[];
  contacts: Contact[];
}

// ---------- limits (each one is set by a bit width below) ----------

export const MAX_CASES = 31; // 5 bits
export const MAX_CONTACTS = 7; // 3 bits
export const MAX_TEXT_LENGTH = 60; // characters in a spelled-out name
export const MAX_PHONE_LENGTH = 20; // symbols, including a leading "+"
export const MAX_DECIMALS = 3; // 0.125 mg is the finest dose we store
export const MAX_AMOUNT = 1_000_000;

export const BITS = {
  version: 4,
  caseCount: 5,
  contactCount: 3,
  caseType: 2,
  flag: 1,
  hasDose: 1,
  decimalFlag: 1,
  decimalPlaces: 2,
  unit: 3,
  severity: 2,
  phoneSymbol: 4,
  relation: 3,
} as const;

// ---------- labels for display ----------

export const CASE_TYPE_LABELS: Record<CaseType, string> = {
  [CaseType.Allergy]: 'Allergy',
  [CaseType.Medication]: 'Medication',
  [CaseType.Condition]: 'Condition',
};

export const UNIT_LABELS: Record<Unit, string> = {
  [Unit.mg]: 'mg',
  [Unit.mcg]: 'mcg',
  [Unit.ml]: 'mL',
  [Unit.pill]: 'pill',
  [Unit.IU]: 'IU',
  [Unit.puff]: 'puff',
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  [Severity.Mild]: 'Mild',
  [Severity.Moderate]: 'Moderate',
  [Severity.Severe]: 'Severe',
  [Severity.LifeThreatening]: 'Life-threatening',
};

export const RELATION_LABELS: Record<Relation, string> = {
  [Relation.Parent]: 'Parent',
  [Relation.Partner]: 'Partner',
  [Relation.Child]: 'Child',
  [Relation.Sibling]: 'Sibling',
  [Relation.Friend]: 'Friend',
  [Relation.Caregiver]: 'Caregiver',
  [Relation.Doctor]: 'Doctor',
  [Relation.Other]: 'Other',
};

export const CASE_TYPES = [CaseType.Allergy, CaseType.Medication, CaseType.Condition] as const;
export const UNITS = [Unit.mg, Unit.mcg, Unit.ml, Unit.pill, Unit.IU, Unit.puff] as const;
export const SEVERITIES = [Severity.Mild, Severity.Moderate, Severity.Severe, Severity.LifeThreatening] as const;
export const RELATIONS = [
  Relation.Parent,
  Relation.Partner,
  Relation.Child,
  Relation.Sibling,
  Relation.Friend,
  Relation.Caregiver,
  Relation.Doctor,
  Relation.Other,
] as const;
