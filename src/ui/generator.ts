import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import './base.css';
import './generator.css';
import {
  measureProfile,
  profileToPayload,
  validateCase,
  validateContact,
  validateHolderName,
  validateProfile,
  ValidationError,
} from '../core/codec';
import { caseDisplayName, contactDisplayName, formatDose, toReadable } from '../core/display';
import {
  CASE_TYPE_LABELS,
  CASE_TYPES,
  CaseType,
  MAX_CASES,
  MAX_CONTACTS,
  RELATION_LABELS,
  RELATIONS,
  SEVERITIES,
  SEVERITY_LABELS,
  UNIT_LABELS,
  UNITS,
  type Case,
  type Contact,
  type Name,
  type Profile,
  type Relation,
  type Severity,
  type Unit,
} from '../core/schema';
import { getTables, type TermEntry } from '../core/tables';
import { normalizePhone } from '../core/text';
import { decodeBase } from './config';
import { byId, el, fillSelect } from './dom';
import { icon, type IconName } from './icons';
import { animateEnter, animateLeave, collapse, expand, highlight } from './motion';
import { makeQrSvg } from './qr';

const tables = getTables();
const STORAGE_KEY = 'totem.profile.v1';

const TYPE_ICONS: Record<CaseType, IconName> = {
  [CaseType.Allergy]: 'allergy',
  [CaseType.Medication]: 'medication',
  [CaseType.Condition]: 'condition',
};

// ---------- state ----------

let profile: Profile = loadProfile();
let editingCase: Case | null = null;
let suggestions: TermEntry[] = [];
let activeSuggestion = -1;

function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Profile> | null;
      if (Array.isArray(saved?.cases) && Array.isArray(saved?.contacts)) {
        // Cards saved before the name field existed have no name: start it blank.
        const restored: Profile = { name: typeof saved.name === 'string' ? saved.name : '', cases: saved.cases, contacts: saved.contacts };
        if (validateProfile(restored, tables).length === 0) return restored;
      }
    }
  } catch {
    // Storage blocked or unreadable: start with an empty card.
  }
  return { name: '', cases: [], contacts: [] };
}

function saveProfile(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Storage blocked: the card still works for this visit.
  }
}

// ---------- small builders ----------

function iconButton(name: IconName, label: string, onClick: () => void, className = ''): HTMLButtonElement {
  const button = el('button', { type: 'button', class: `icon-button ${className}`.trim(), 'aria-label': label });
  button.append(icon(name));
  button.addEventListener('click', onClick);
  return button;
}

function radioGroup<T extends number>(
  container: HTMLElement,
  name: string,
  values: readonly T[],
  labels: Record<T, string>,
  extra?: (value: T, label: HTMLLabelElement) => void,
): void {
  container.replaceChildren(
    ...values.map((value) => {
      const input = el('input', { type: 'radio', name, value: String(value) });
      const label = el('label', {}, input, labels[value]);
      extra?.(value, label);
      return label;
    }),
  );
}

function checkedValue(name: string): number | null {
  const input = document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`);
  return input ? Number(input.value) : null;
}

function setChecked(name: string, value: number | null): void {
  document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`).forEach((input) => {
    input.checked = value !== null && Number(input.value) === value;
  });
}

function setAddLabel(button: HTMLElement, text: string): void {
  button.replaceChildren(icon('plus'), el('span', {}, text));
}

// ---------- card holder ----------

const holderInput = byId<HTMLInputElement>('holder-name');
const holderError = byId('holder-error');

holderInput.value = profile.name;
holderInput.addEventListener('input', () => {
  profile.name = holderInput.value;
  holderError.textContent = validateHolderName(profile.name).join(' ');
  saveProfile();
});

// ---------- case composer ----------

const caseAdd = byId<HTMLButtonElement>('case-add');
const caseComposer = byId('case-composer');
const caseForm = byId<HTMLFormElement>('case-form');
const nameInput = byId<HTMLInputElement>('case-name');
const suggestionList = byId<HTMLUListElement>('name-suggestions');
const nameStatus = byId('name-status');
const doseFields = byId<HTMLFieldSetElement>('dose-fields');
const amountInput = byId<HTMLInputElement>('dose-amount');
const unitSelect = byId<HTMLSelectElement>('dose-unit');
const doseNone = byId<HTMLInputElement>('dose-none');
const severityField = byId<HTMLFieldSetElement>('severity-field');
const caseError = byId('case-error');
const caseSave = byId<HTMLButtonElement>('case-save');

radioGroup(byId('case-type'), 'case-type', CASE_TYPES, CASE_TYPE_LABELS, (type, label) => label.prepend(icon(TYPE_ICONS[type])));
radioGroup(byId('case-severity'), 'severity', SEVERITIES, SEVERITY_LABELS, (severity, label) =>
  label.classList.add(`sev-${severity}`),
);
fillSelect(unitSelect, UNITS, UNIT_LABELS);
fillSelect(byId<HTMLSelectElement>('contact-relation'), RELATIONS, RELATION_LABELS);

const currentType = (): CaseType => (checkedValue('case-type') ?? CaseType.Allergy) as CaseType;
const currentTable = () => tables.terms[currentType()];

function updateTypeFields(): void {
  const isMedication = currentType() === CaseType.Medication;
  doseFields.hidden = !isMedication;
  severityField.hidden = isMedication;
  amountInput.disabled = doseNone.checked;
  unitSelect.disabled = doseNone.checked;
  updateNameStatus();
}

function updateNameStatus(): void {
  const text = nameInput.value.trim();
  nameStatus.classList.remove('known');
  if (!text) {
    nameStatus.textContent = '';
    return;
  }
  const tokenId = currentTable().lookup(text);
  if (tokenId !== undefined) {
    nameStatus.textContent = `Found in our list: ${currentTable().byId[tokenId].display}`;
    nameStatus.classList.add('known');
  } else {
    nameStatus.textContent = 'Not in our list. It will be saved as you typed it, which makes the QR code a little bigger.';
  }
}

function renderSuggestions(): void {
  const text = nameInput.value;
  suggestions = currentTable().suggest(text, 6);
  if (suggestions.length === 1 && suggestions[0].tokenId === currentTable().lookup(text)) suggestions = [];
  if (activeSuggestion >= suggestions.length) activeSuggestion = -1;

  suggestionList.replaceChildren(
    ...suggestions.map((entry, i) => {
      const option = el('li', { id: `suggestion-${i}`, role: 'option', 'aria-selected': String(i === activeSuggestion) }, entry.display);
      option.addEventListener('mousedown', (event) => {
        event.preventDefault(); // keep focus in the input
        pickSuggestion(i);
      });
      return option;
    }),
  );
  const open = suggestions.length > 0;
  suggestionList.hidden = !open;
  nameInput.setAttribute('aria-expanded', String(open));
  if (open && activeSuggestion >= 0) nameInput.setAttribute('aria-activedescendant', `suggestion-${activeSuggestion}`);
  else nameInput.removeAttribute('aria-activedescendant');
}

function closeSuggestions(): void {
  suggestions = [];
  activeSuggestion = -1;
  suggestionList.hidden = true;
  nameInput.setAttribute('aria-expanded', 'false');
  nameInput.removeAttribute('aria-activedescendant');
}

function pickSuggestion(index: number): void {
  nameInput.value = suggestions[index].display;
  closeSuggestions();
  updateNameStatus();
}

function openCaseComposer(c: Case | null): void {
  caseForm.reset();
  caseError.textContent = '';
  editingCase = c;
  setChecked('case-type', c ? c.type : CaseType.Allergy);
  if (c) {
    nameInput.value = caseDisplayName(c, tables);
    doseNone.checked = c.type === CaseType.Medication && c.dose === null;
    amountInput.value = c.dose ? String(c.dose.amount) : '';
    unitSelect.value = String(c.dose?.unit ?? UNITS[0]);
    setChecked('severity', c.severity);
  }
  byId('case-form-title').textContent = c ? 'Edit case' : 'New case';
  caseSave.textContent = c ? 'Save changes' : 'Add case';
  updateTypeFields();
  caseAdd.hidden = true;
  if (caseComposer.hidden) expand(caseComposer);
  nameInput.focus();
}

async function closeCaseComposer(): Promise<void> {
  closeSuggestions();
  editingCase = null;
  await collapse(caseComposer);
  caseAdd.hidden = false;
}

function readCaseForm(): { value?: Case; problems: string[] } {
  const type = currentType();
  const text = nameInput.value.trim();
  if (!text) return { problems: ['Enter a name.'] };
  const tokenId = tables.terms[type].lookup(text);
  const name: Name = tokenId !== undefined ? { known: true, tokenId } : { known: false, text };

  if (type === CaseType.Medication) {
    let dose: Case['dose'] = null;
    if (!doseNone.checked) {
      const raw = amountInput.value.trim();
      if (!raw) return { problems: ['Enter a dose amount, or tick "No fixed dose".'] };
      dose = { amount: Number(raw), unit: Number(unitSelect.value) as Unit };
    }
    const value: Case = { type, name, dose, severity: null };
    return { value, problems: validateCase(value, tables) };
  }
  const value: Case = { type, name, dose: null, severity: checkedValue('severity') as Severity | null };
  return { value, problems: validateCase(value, tables) };
}

caseAdd.addEventListener('click', () => {
  if (profile.cases.length >= MAX_CASES) return;
  openCaseComposer(null);
});
byId('case-cancel').addEventListener('click', () => void closeCaseComposer().then(() => caseAdd.focus()));

caseForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const { value, problems } = readCaseForm();
  if (!value || problems.length > 0) {
    caseError.textContent = problems.join(' ');
    return;
  }
  const editing = editingCase;
  const index = editing ? profile.cases.indexOf(editing) : profile.cases.length;
  if (editing) profile.cases[index] = value;
  else profile.cases.push(value);
  saveProfile();
  await closeCaseComposer();
  renderCases(editing ? { flash: index } : { enter: index });
  caseAdd.focus();
});

document.querySelectorAll<HTMLInputElement>('input[name="case-type"]').forEach((input) =>
  input.addEventListener('change', () => {
    updateTypeFields();
    if (document.activeElement === nameInput) renderSuggestions();
  }),
);
doseNone.addEventListener('change', updateTypeFields);

nameInput.addEventListener('input', () => {
  activeSuggestion = -1;
  renderSuggestions();
  updateNameStatus();
});
nameInput.addEventListener('focus', renderSuggestions);
nameInput.addEventListener('blur', closeSuggestions);
nameInput.addEventListener('keydown', (event) => {
  if (suggestions.length === 0) return;
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    activeSuggestion = Math.min(suggestions.length - 1, activeSuggestion + 1);
    renderSuggestions();
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    activeSuggestion = Math.max(-1, activeSuggestion - 1);
    renderSuggestions();
  } else if (event.key === 'Enter' && activeSuggestion >= 0) {
    event.preventDefault();
    pickSuggestion(activeSuggestion);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeSuggestions();
  }
});

// ---------- case list ----------

function caseRow(c: Case): HTMLLIElement {
  const name = caseDisplayName(c, tables);
  const title = el('span', { class: 'item-title' }, name);
  if (c.severity !== null) title.append(el('span', { class: `chip sev-${c.severity}` }, SEVERITY_LABELS[c.severity]));
  if (!c.name.known) title.append(el('span', { class: 'chip custom' }, 'Typed in'));

  const sub = c.type === CaseType.Medication ? `Medication, ${formatDose(c.dose).toLowerCase()}` : CASE_TYPE_LABELS[c.type];
  const badge = el('span', { class: `item-icon ${CASE_TYPE_LABELS[c.type].toLowerCase()}` });
  badge.append(icon(TYPE_ICONS[c.type]));

  const row = el(
    'li',
    { class: 'item' },
    badge,
    el('span', { class: 'item-text' }, title, el('span', { class: 'item-sub' }, sub)),
    el(
      'span',
      { class: 'item-actions' },
      iconButton('edit', `Edit ${name}`, () => openCaseComposer(c)),
      iconButton('trash', `Delete ${name}`, () => void deleteCase(c, row), 'danger'),
    ),
  );
  return row;
}

async function deleteCase(c: Case, row: HTMLLIElement): Promise<void> {
  row.querySelectorAll('button').forEach((b) => (b.disabled = true));
  if (editingCase === c) await closeCaseComposer();
  await animateLeave(row);
  profile.cases = profile.cases.filter((x) => x !== c);
  saveProfile();
  renderCases();
  caseAdd.focus();
}

function renderCases(motion: { enter?: number; flash?: number } = {}): void {
  const list = byId('case-list');
  const rows = profile.cases.map(caseRow);
  list.replaceChildren(...rows);
  byId('case-empty').hidden = profile.cases.length > 0;
  byId('case-count').textContent = profile.cases.length > 0 ? `${profile.cases.length} of ${MAX_CASES}` : '';
  setAddLabel(caseAdd, profile.cases.length > 0 ? 'Add another case' : 'Add a case');
  caseAdd.disabled = profile.cases.length >= MAX_CASES;
  if (motion.enter !== undefined && rows[motion.enter]) animateEnter(rows[motion.enter]);
  if (motion.flash !== undefined && rows[motion.flash]) highlight(rows[motion.flash]);
}

// ---------- contacts ----------

const contactAdd = byId<HTMLButtonElement>('contact-add');
const contactComposer = byId('contact-composer');
const contactForm = byId<HTMLFormElement>('contact-form');
const contactError = byId('contact-error');

async function closeContactComposer(): Promise<void> {
  await collapse(contactComposer);
  contactAdd.hidden = false;
}

contactAdd.addEventListener('click', () => {
  if (profile.contacts.length >= MAX_CONTACTS) return;
  contactForm.reset();
  contactError.textContent = '';
  contactAdd.hidden = true;
  expand(contactComposer);
  byId('contact-name').focus();
});
byId('contact-cancel').addEventListener('click', () => void closeContactComposer().then(() => contactAdd.focus()));

contactForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const contact: Contact = {
    name: byId<HTMLInputElement>('contact-name').value.trim(),
    phone: normalizePhone(byId<HTMLInputElement>('contact-phone').value),
    relation: Number(byId<HTMLSelectElement>('contact-relation').value) as Relation,
  };
  const problems = validateContact(contact);
  if (problems.length > 0) {
    contactError.textContent = problems.join(' ');
    return;
  }
  profile.contacts.push(contact);
  saveProfile();
  await closeContactComposer();
  renderContacts(profile.contacts.length - 1);
  contactAdd.focus();
});

function contactRow(k: Contact): HTMLLIElement {
  const name = contactDisplayName(k.name);
  const badge = el('span', { class: 'item-icon' });
  badge.append(icon('contact'));
  const row = el(
    'li',
    { class: 'item' },
    badge,
    el(
      'span',
      { class: 'item-text' },
      el('span', { class: 'item-title' }, name),
      el('span', { class: 'item-sub' }, `${RELATION_LABELS[k.relation]}, ${k.phone}`),
    ),
    el('span', { class: 'item-actions' }, iconButton('trash', `Delete ${name}`, () => void deleteContact(k, row), 'danger')),
  );
  return row;
}

async function deleteContact(k: Contact, row: HTMLLIElement): Promise<void> {
  row.querySelectorAll('button').forEach((b) => (b.disabled = true));
  await animateLeave(row);
  profile.contacts = profile.contacts.filter((x) => x !== k);
  saveProfile();
  renderContacts();
  contactAdd.focus();
}

function renderContacts(enter?: number): void {
  const rows = profile.contacts.map(contactRow);
  byId('contact-list').replaceChildren(...rows);
  byId('contact-empty').hidden = profile.contacts.length > 0;
  byId('contact-count').textContent = profile.contacts.length > 0 ? `${profile.contacts.length} of ${MAX_CONTACTS}` : '';
  setAddLabel(contactAdd, profile.contacts.length > 0 ? 'Add another contact' : 'Add a contact');
  contactAdd.disabled = profile.contacts.length >= MAX_CONTACTS;
  if (enter !== undefined && rows[enter]) animateEnter(rows[enter]);
}

// ---------- generate + QR dialog ----------

const dialog = byId<HTMLDialogElement>('qr-dialog');
const copyButton = byId<HTMLButtonElement>('qr-copy');
let currentUrl = '';
let currentSvg = '';

byId('qr-close').append(icon('close'));
byId('qr-download').append(icon('download'), 'Download QR code');
const copyLabel = () => copyButton.replaceChildren(icon('copy'), 'Copy link');
copyLabel();
byId('qr-open').append(icon('open'), 'Open card');

byId('qr-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) dialog.close(); // click on the backdrop
});

byId('generate').addEventListener('click', () => {
  const error = byId('generate-error');
  error.textContent = '';
  if (profile.cases.length === 0 && profile.contacts.length === 0) {
    error.textContent = 'Add at least one case or contact first.';
    return;
  }
  try {
    const payload = profileToPayload(profile, tables);
    currentUrl = `${decodeBase()}#${payload}`;
    const qr = makeQrSvg(currentUrl, 'QR code that opens your emergency medical card');
    currentSvg = qr.svg;
    byId('qr').innerHTML = qr.svg; // generated by makeQrSvg, contains no user text
    byId<HTMLAnchorElement>('qr-open').href = currentUrl;
    copyLabel();

    const stats = measureProfile(profile, toReadable(profile, tables), tables);
    const smaller = Math.round((1 - stats.encodedBytes / stats.readableBytes) * 100);
    const rows: [string, string][] = [
      ['As plain text', `${stats.readableBytes} bytes`],
      ['Compressed', `${stats.encodedBytes} bytes (${stats.encodedBits} bits), ${smaller}% smaller`],
      ['Link length', `${currentUrl.length} characters`],
      ['QR code size', `version ${qr.version}, ${qr.modules} × ${qr.modules} squares`],
    ];
    byId('stats').replaceChildren(...rows.flatMap(([term, value]) => [el('dt', {}, term), el('dd', {}, value)]));
    dialog.showModal();
  } catch (e) {
    error.textContent = e instanceof ValidationError ? e.problems.join(' ') : 'The QR code could not be created.';
  }
});

copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(currentUrl);
    copyButton.replaceChildren(icon('check'), 'Link copied');
    setTimeout(copyLabel, 2000);
  } catch {
    window.prompt('Copy this link:', currentUrl);
  }
});

byId('qr-download').addEventListener('click', () => {
  // Draw the SVG onto a large canvas so the PNG prints sharply.
  const size = 1200;
  const image = new Image();
  const svgUrl = URL.createObjectURL(new Blob([currentSvg], { type: 'image/svg+xml' }));
  image.onload = () => {
    const canvas = el('canvas', { width: String(size), height: String(size) });
    const context = canvas.getContext('2d')!;
    context.imageSmoothingEnabled = false;
    context.drawImage(image, 0, 0, size, size);
    URL.revokeObjectURL(svgUrl);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const link = el('a', { href: URL.createObjectURL(blob), download: 'totem-qr-code.png' });
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    }, 'image/png');
  };
  image.src = svgUrl;
});

// ---------- start ----------

updateTypeFields();
renderCases();
renderContacts();
