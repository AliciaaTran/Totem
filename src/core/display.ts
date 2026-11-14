// Turning decoded values back into readable text, plus the allergy checks.

import { HashTable } from './hashtable';
import {
  CASE_TYPE_LABELS,
  CaseType,
  RELATION_LABELS,
  SEVERITY_LABELS,
  Severity,
  Unit,
  UNIT_LABELS,
  type Case,
  type Dose,
  type Profile,
} from './schema';
import type { TableSet } from './tables';
import { normalizeText, sentenceCase, titleCase } from './text';

export function caseDisplayName(c: Case, tables: TableSet): string {
  return c.name.known ? tables.terms[c.type].byId[c.name.tokenId].display : sentenceCase(c.name.text);
}

export function formatDose(dose: Dose | null): string {
  if (dose === null) return 'No fixed dose';
  const plural = dose.amount !== 1 && (dose.unit === Unit.pill || dose.unit === Unit.puff);
  return `${dose.amount} ${UNIT_LABELS[dose.unit]}${plural ? 's' : ''}`;
}

/** Names are stored lowercase; show them title-cased. Used for contacts and the card holder. */
export function contactDisplayName(name: string): string {
  return titleCase(name);
}

export const holderDisplayName = contactDisplayName;

/** The same card as plain JSON, used to show how much the encoding saves. */
export function toReadable(profile: Profile, tables: TableSet): unknown {
  return {
    ...(normalizeText(profile.name) ? { name: holderDisplayName(profile.name) } : {}),
    cases: profile.cases.map((c) => ({
      type: CASE_TYPE_LABELS[c.type],
      name: caseDisplayName(c, tables),
      ...(c.type === CaseType.Medication ? { dose: formatDose(c.dose) } : {}),
      ...(c.severity !== null ? { severity: SEVERITY_LABELS[c.severity] } : {}),
    })),
    contacts: profile.contacts.map((k) => ({
      name: contactDisplayName(k.name),
      phone: k.phone,
      relation: RELATION_LABELS[k.relation],
    })),
  };
}

export interface Warning {
  level: 'critical' | 'caution';
  message: string;
}

/** Keys a case is matched on: its categories plus its own name. */
function matchKeys(c: Case, tables: TableSet): string[] {
  const keys = [`name:${normalizeText(caseDisplayName(c, tables))}`];
  if (c.name.known) keys.push(...tables.terms[c.type].byId[c.name.tokenId].categories.map((k) => `class:${k}`));
  return keys;
}

/**
 * 1. Severe and life-threatening allergies.
 * 2. Medications in the same class as (or with the same name as) a listed allergy.
 *    A basic class check, not a full interaction database.
 */
export function findWarnings(profile: Profile, tables: TableSet): Warning[] {
  const warnings: Warning[] = [];
  const allergiesByKey = new HashTable<string[]>();

  for (const c of profile.cases) {
    if (c.type !== CaseType.Allergy) continue;
    const name = caseDisplayName(c, tables);
    if (c.severity === Severity.LifeThreatening || c.severity === Severity.Severe) {
      warnings.push({ level: 'critical', message: `${SEVERITY_LABELS[c.severity]} allergy: ${name}` });
    }
    for (const key of matchKeys(c, tables)) {
      const names = allergiesByKey.get(key) ?? [];
      if (!names.includes(name)) names.push(name);
      allergiesByKey.set(key, names);
    }
  }

  for (const c of profile.cases) {
    if (c.type !== CaseType.Medication) continue;
    const conflicts = new Set<string>();
    for (const key of matchKeys(c, tables)) allergiesByKey.get(key)?.forEach((n) => conflicts.add(n));
    if (conflicts.size > 0) {
      warnings.push({
        level: 'caution',
        message: `${caseDisplayName(c, tables)} is in the same class as a listed allergy (${[...conflicts].join(', ')}).`,
      });
    }
  }

  // Critical first; otherwise keep the card's order (sort is stable).
  return warnings.sort((a, b) => (a.level === b.level ? 0 : a.level === 'critical' ? -1 : 1));
}
