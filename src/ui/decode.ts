import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import './base.css';
import './decode.css';
import { DecodeError, payloadToCard } from '../core/codec';
import { caseDisplayName, contactDisplayName, findWarnings, formatDose } from '../core/display';
import { CaseType, RELATION_LABELS, SEVERITY_LABELS, Severity, type Case, type Profile } from '../core/schema';
import { getTables, type TableSet } from '../core/tables';
import { byId, el } from './dom';

const USER_ENTERED = 'entered by card holder';

function section(title: string, ...content: Node[]): HTMLElement {
  return el('section', { class: 'card-section' }, el('h2', {}, title), ...content);
}

function nameLine(c: Case, tables: TableSet): HTMLElement {
  const name = el('span', { class: 'case-name' }, caseDisplayName(c, tables));
  if (!c.name.known) name.append(' ', el('span', { class: 'user-entered' }, `(${USER_ENTERED})`));
  return name;
}

function caseList(cases: Case[], tables: TableSet, detail: (c: Case) => HTMLElement | null, empty: string): HTMLElement {
  if (cases.length === 0) return el('p', { class: 'none' }, empty);
  return el(
    'ul',
    { class: 'case-list' },
    ...cases.map((c) => {
      const extra = detail(c);
      return el('li', {}, nameLine(c, tables), ...(extra ? [extra] : []));
    }),
  );
}

function severityBadge(c: Case): HTMLElement {
  const severity = c.severity!;
  return el('span', { class: `severity${severity >= Severity.Severe ? ' high' : ''}` }, SEVERITY_LABELS[severity]);
}

function renderCard(profile: Profile, tables: TableSet): Node[] {
  const of = (type: CaseType) => profile.cases.filter((c) => c.type === type);
  const bySeverity = (a: Case, b: Case) => (b.severity ?? 0) - (a.severity ?? 0);
  const nodes: Node[] = [el('header', { class: 'card-header' }, el('h1', {}, 'Emergency medical information'))];

  const warnings = findWarnings(profile, tables);
  if (warnings.length > 0) {
    nodes.push(
      el(
        'div',
        { class: 'warnings', role: 'alert' },
        ...warnings.map((w) => el('p', { class: `warning ${w.level}` }, w.message)),
      ),
    );
  }

  nodes.push(
    section('Allergies', caseList(of(CaseType.Allergy).sort(bySeverity), tables, severityBadge, 'None listed on this card.')),
    section('Conditions', caseList(of(CaseType.Condition).sort(bySeverity), tables, severityBadge, 'None listed on this card.')),
    section(
      'Medications',
      caseList(of(CaseType.Medication), tables, (c) => el('span', { class: 'dose' }, formatDose(c.dose)), 'None listed on this card.'),
    ),
  );

  if (profile.contacts.length > 0) {
    nodes.push(
      section(
        'Emergency contacts',
        el(
          'ul',
          { class: 'contact-list' },
          ...profile.contacts.map((k) =>
            el(
              'li',
              {},
              el('a', { class: 'call', href: `tel:${k.phone}` }, `Call ${contactDisplayName(k.name)}`),
              el('span', { class: 'contact-detail' }, `${RELATION_LABELS[k.relation]} · ${k.phone}`),
            ),
          ),
        ),
      ),
    );
  }

  nodes.push(
    el(
      'footer',
      { class: 'card-footer' },
      el(
        'p',
        {},
        'Information provided by the card holder and not verified. Allergy warnings are a basic drug-class check and may be incomplete.',
      ),
    ),
  );
  return nodes;
}

function render(): void {
  const root = byId('card');
  const payload = location.hash.slice(1);
  if (!payload) {
    root.replaceChildren(el('p', { class: 'notice' }, 'This link has no card data. Scan a Totem QR code to see an emergency card.'));
    return;
  }
  try {
    const { version, profile } = payloadToCard(payload);
    root.replaceChildren(...renderCard(profile, getTables(version)));
  } catch (e) {
    const message = e instanceof DecodeError ? e.message : 'This card could not be read.';
    root.replaceChildren(el('p', { class: 'notice error-box', role: 'alert' }, message));
  }
}

window.addEventListener('hashchange', render);
render();
