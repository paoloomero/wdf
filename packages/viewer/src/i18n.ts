/**
 * Reader interface language, English and Italian (plan §10.81).
 *
 * The English text lives in the markup (shell.html) and stays its source:
 * translatable elements carry `data-i18n` (content) or `data-i18n-title`,
 * `data-i18n-aria-label`, `data-i18n-placeholder` (attributes) with a key,
 * and SHELL_IT holds the Italian for each key. Texts written by the code are
 * in MESSAGES, both languages, one typed shape — a key missing in Italian is
 * a compile error. Conversion-report notes, validator messages and importer
 * errors stay in English: they are shared with the CLI and MCP and cite the
 * spec. Nothing here is used by @wdf-dev/core.
 */

import { INTEGRITY_NOT_AUTHENTICITY, STATUS_TEXT } from '@wdf-dev/core';

export type Lang = 'en' | 'it';
export const LANGS: readonly Lang[] = ['en', 'it'];

/** Italian for the shell's data-i18n keys; values are trusted HTML. */
export const SHELL_IT: Readonly<Record<string, string>> = {
  // Home: header and hero
  'home.meta': 'v1 · tutto in locale',
  'home.lang': 'Lingua',
  'home.title': 'Leggilo.<br />Convertilo.',
  'home.lede':
    '<strong>Web Document Format</strong>: in un unico file da condividere: (1) <b>HTML</b> accessibile, (2) una versione <b>Markdown</b> per gli agenti AI e (3) un <b>PDF</b> per leggere e stampare — quello dell’autore, quando è allegato. Ciò che leggono le persone e ciò che leggono gli agenti AI è la stessa cosa — in modo verificabile.',
  // Home: Read card
  'read.eyebrow': 'Leggi',
  'read.title': 'Apri un WDF',
  'read.accepted': 'File accettati',
  'read.drop': 'Trascinalo qui, oppure ',
  'read.choose': 'scegli un file',
  'read.tap': 'Scegli un .wdf',
  'read.over': 'Rilascia per aprire',
  'read.working': 'Apertura di',
  'read.meta': 'Lettura del pacchetto.',
  privacy: 'Tutto avviene nel tuo browser — nessun caricamento, nessuna richiesta di rete.',
  // Home: Convert card
  'convert.eyebrow': 'Converti',
  'convert.title': 'Crea un WDF',
  'convert.ways': 'Quattro modi per iniziare',
  'convert.way1': 'Un file Word diventa un WDF.',
  'convert.way2':
    'Il PDF salvato da Word viaggia dentro. Il WDF mostra anche il PDF originale nel Reader.',
  'convert.images': 'cartella immagini',
  'convert.way3': 'Il risultato di “Salva come pagina Web” di Word.',
  'convert.way4': 'Un file Markdown.',
  'convert.drop': 'Trascina qui file o una cartella, oppure ',
  'convert.choose': 'scegli i file',
  'convert.tap': 'Scegli i file da convertire',
  'convert.over': 'Rilascia per convertire',
  'convert.working': 'Conversione di',
  'convert.meta': 'I file Word grandi possono richiedere qualche secondo.',
  // Home: result panel
  'result.eyebrow': 'Convertito',
  'result.from': 'da',
  'result.pdfTag': 'PDF non verificato',
  'result.pdfA': 'Il PDF',
  'result.pdfB':
    'è allegato così com’è e non viene confrontato con il documento — assicurati che sia la stampa di questo.',
  'result.formats': 'Formato da scaricare',
  'result.recommended': 'Consigliato',
  'result.htmlLead': 'Da mandare a chiunque.',
  'result.htmlDesc':
    'Si apre in qualsiasi browser, con il lettore incorporato. Un solo file, funziona offline.',
  'result.htmlLimit':
    'Nel .wdf.html il PDF si apre con il visualizzatore PDF del browser, se ne ha uno; altrimenti si scarica. Il Reader installato lo mostra sempre come pagine.',
  'result.wdfLead': 'Per il WDF Reader e gli agenti AI.',
  'result.wdfDesc':
    'Il formato pacchetto: più leggero, si apre nel Reader installato, leggibile dagli agenti via MCP.',
  'result.source': 'Includi il sorgente originale',
  'result.sourceHint':
    '(aggiunge la vista Originale<span class="pdf-dropped-only"> e porta con sé il PDF</span>)',
  'result.download': 'Scarica',
  'result.open': 'Apri nel Reader',
  'result.report': 'Report di conversione',
  'result.reportNotes': 'Note del report di conversione',
  // Home: footer
  'foot.extension':
    'Salvi pagine web? Prendi <strong class="mark">l’estensione per il browser</strong> — un clic e qualsiasi pagina diventa un WDF.',
  'foot.installTitle': 'Installa il <strong class="mark">Reader come app</strong>',
  'foot.installWhere': 'Disponibile in Chrome ed Edge. ',
  'foot.installBody':
    'Così i file <code>.wdf</code> si aprono con un doppio clic — offline, come qualsiasi lettore.',
  'foot.installDone':
    'Installato. La prima volta che fai doppio clic su un <code>.wdf</code>, il sistema chiede una volta se aprirlo con WDF Reader — rispondi sì.',
  install: 'Installa',
  // Document view
  'app.sidebar': 'Mostra o nascondi il pannello delle ancore',
  'app.badge': 'Dettagli della verifica',
  'app.modes': 'Modalità di lettura',
  'app.humanTitle': 'Vista Umano — il documento impaginato',
  'app.human': 'Umano',
  'app.agentTitle': 'Vista Agente — la derivazione canonica leggibile dalle macchine',
  'app.agent': 'Agente',
  'app.originalTitle': 'Il sorgente originale incorporato (estensione: source)',
  'app.original': 'Originale',
  'app.actions': 'Azioni sul documento',
  'app.paperTitle':
    'Vista carta: anteprima A4 impaginata con intestazione e piè di pagina ripetuti (il PDF esportato è l’impaginazione di riferimento)',
  'app.paper': 'Carta',
  'app.plainTitle':
    'Vista semplice: il documento senza il foglio di stile dell’autore (spec §6.7.4) — ciò che l’HTML semantico porta da solo',
  'app.plain': 'Semplice',
  'app.installTitle':
    'Installa il WDF Reader come app: i file .wdf poi si aprono con un doppio clic, offline',
  'app.close': 'Chiudi',
  'app.search': 'Cerca nelle ancore',
  'app.anchors': 'Ancore',
  'app.outline': 'Struttura del documento',
  'app.document': 'Documento',
  'app.originalFrame': 'Sorgente originale',
  'app.print': 'Stampa',
  'app.binary':
    'L’originale incorporato è un file binario — non c’è niente da mostrare. Scaricalo per aprirlo nella sua applicazione (i byte vengono dal pacchetto, senza passare dalla rete).',
  'app.downloadOriginal': 'Scarica l’originale',
  'app.visual':
    'L’autore ha salvato anche una versione PDF di questo documento — l’immagine della pagina fissata dall’applicazione originale. È inclusa così com’è: il pacchetto prova che i suoi byte non sono cambiati, non che corrisponda al contenuto canonico.',
  'app.downloadPdf': 'Scarica il PDF',
  'app.pdfLabel': 'PDF salvato dall’autore',
  'app.visualHint':
    'Questo browser non può mostrare qui il PDF: scaricalo, oppure apri questo documento nel WDF Reader installabile (https://wdf.dev), che ne mostra le pagine.',
  'app.copyCitation': 'Copia citazione',
};

const count = (n: number, one: string, many: string): string =>
  `${String(n)} ${n === 1 ? one : many}`;

const EN = {
  // Home cards
  alreadyWdf: 'This is already a WDF — opened it.',
  notWdf: 'This is not a WDF.',
  nothingToConvert: 'Nothing here can be converted.',
  noFiles: 'No files arrived. Choose them again.',
  unusable: (names: string) => `${names}: not .wdf, .docx, .html or .md. Choose other files.`,
  andMore: (names: string, n: number) => `${names} and ${String(n)} more`,
  converting: (what: string) => `This is ${what} — converting it.`,
  aWordFile: 'a Word file',
  aMarkdownFile: 'a Markdown file',
  aWebPage: 'a web page',
  notAWdf: 'not a WDF',
  convertFailed: 'Couldn’t convert these files.',
  noContent: (name: string) => `${name} has no content a WDF can represent.`,
  openFailed: 'Couldn’t open this file.',
  unreadableAi: (e: string) => `unreadable AI layer: ${e}`,
  // Result panel
  noteTag: { loss: 'Dropped', change: 'Changed', info: 'Info' },
  changesHead: 'Dropped or changed',
  notesHead: 'Notes',
  nChanged: (n: number) => `${String(n)} changed`,
  nNotes: (n: number) => count(n, 'note', 'notes'),
  noTemplate:
    'This copy of the Reader cannot build a .wdf.html (its template is not here). Use the Reader at wdf.dev or the installed one, or download the .wdf.',
  // Install
  installHere:
    'Use the install icon at the right of the address bar. No icon? The Reader is already installed — open it from your apps.',
  installElsewhere:
    'This browser cannot install the Reader. Open this page in Chrome or Edge to install it.',
  // Document view
  otherDocument: 'this citation refers to a different document',
  anchorMissing: (id: string) => `anchor "${id}" not found in this document`,
  jumped: (id: string) => `jumped to ${id}`,
  plainOn: 'Plain view: author stylesheet off (§6.7.4)',
  plainOff: 'Author stylesheet on',
  reportSummary: (parts: string, tool: string) =>
    `Original included as-is, not compared with the canonical content · conversion report: ${parts}${tool}`,
  reportNotes: (n: number) => `${String(n)} note(s)`,
  reportDropped: (n: number) => `${String(n)} dropped`,
  reportTransformed: (n: number) => `${String(n)} transformed`,
  reportKind: { loss: 'loss', change: 'change', info: 'info' },
  pages: (n: number) => count(n, 'page', 'pages'),
  exportPdf: 'Export the document as PDF (browser print)',
  printNotice:
    'This is the WDF Reader window, not the document. To print the whole document, press Ctrl+P (⌘P on a Mac) inside the Reader, or use the PDF button in its toolbar.',
  downloadAuthorPdf: (name: string) => `Download the PDF saved by the author (${name})`,
  copyCitationFor: (id: string) => `Copy citation for ${id}`,
  copyCitationPrompt: 'Copy citation:',
  anchors: (n: number) => `${String(n)} anchors`,
  checking: 'checking…',
  verifiedLocally: 'verified locally',
  integrityOk: 'Integrity: every file matches its SHA-256 digest (§8.2)',
  integrityFailed: 'Integrity: FAILED (§8.2)',
  determinismOk: 'Determinism: the AI layer is the canonical extraction of the content (§7.1)',
  determinismFailed: 'Determinism: FAILED (§7.1)',
  conformanceOk: 'Conformance: WDF-HTML profile, datasets and extensions (§5–§6, §10)',
  conformanceFailed: 'Conformance: FAILED (§5–§6, §10)',
  warning: 'warning: ',
  verificationCrashed: (e: string) => `Verification failed to run: ${e}`,
  // English verdicts are core's own, shared with the CLI and MCP.
  notAuthenticity: INTEGRITY_NOT_AUTHENTICITY as string,
  status: STATUS_TEXT,
  // Live-page capture (docs/ext-capture.md §6)
  capturedOn: (at: string) => `captured from live page on ${at}`,
  capture: (article: boolean) =>
    `Capture: ${article ? 'extracted article' : 'full page'} from a live, rendered page — integrity is not authenticity (§11.4)`,
  capturedUrl: 'Captured URL',
  capturedAt: 'Captured at',
  userAgent: 'User agent',
  viewport: 'Viewport',
};

export type Messages = typeof EN;

const IT: Messages = {
  alreadyWdf: 'Questo è già un WDF — l’ho aperto.',
  notWdf: 'Questo non è un WDF.',
  nothingToConvert: 'Qui non c’è niente da convertire.',
  noFiles: 'Non è arrivato nessun file. Sceglili di nuovo.',
  unusable: (names) => `${names}: non sono .wdf, .docx, .html o .md. Scegli altri file.`,
  andMore: (names, n) => `${names} e altri ${String(n)}`,
  converting: (what) => `Questo è ${what} — lo converto.`,
  aWordFile: 'un file Word',
  aMarkdownFile: 'un file Markdown',
  aWebPage: 'una pagina web',
  notAWdf: 'non un WDF',
  convertFailed: 'Non sono riuscito a convertire questi file.',
  noContent: (name) => `${name} non ha contenuto che un WDF possa rappresentare.`,
  openFailed: 'Non sono riuscito ad aprire questo file.',
  unreadableAi: (e) => `livello AI illeggibile: ${e}`,
  noteTag: { loss: 'Tolto', change: 'Cambiato', info: 'Info' },
  changesHead: 'Tolto o cambiato',
  notesHead: 'Note',
  nChanged: (n) => count(n, 'cambiamento', 'cambiamenti'),
  nNotes: (n) => count(n, 'nota', 'note'),
  noTemplate:
    'Questa copia del Reader non può creare un .wdf.html (il modello non è qui). Usa il Reader su wdf.dev o quello installato, oppure scarica il .wdf.',
  installHere:
    'Usa l’icona di installazione a destra della barra degli indirizzi. Non c’è? Il Reader è già installato — aprilo dalle tue app.',
  installElsewhere:
    'Questo browser non può installare il Reader. Apri questa pagina in Chrome o Edge per installarlo.',
  otherDocument: 'questa citazione si riferisce a un altro documento',
  anchorMissing: (id) => `ancora "${id}" non trovata in questo documento`,
  jumped: (id) => `spostato su ${id}`,
  plainOn: 'Vista semplice: foglio di stile dell’autore spento (§6.7.4)',
  plainOff: 'Foglio di stile dell’autore acceso',
  reportSummary: (parts, tool) =>
    `Originale incluso così com’è, non confrontato con il contenuto canonico · report di conversione: ${parts}${tool}`,
  reportNotes: (n) => count(n, 'nota', 'note'),
  reportDropped: (n) => `${String(n)} ${n === 1 ? 'tolto' : 'tolti'}`,
  reportTransformed: (n) => `${String(n)} ${n === 1 ? 'trasformato' : 'trasformati'}`,
  reportKind: { loss: 'tolto', change: 'cambiato', info: 'info' },
  pages: (n) => count(n, 'pagina', 'pagine'),
  exportPdf: 'Esporta il documento in PDF (stampa del browser)',
  printNotice:
    'Questa è la finestra del WDF Reader, non il documento. Per stampare il documento intero premi Ctrl+P (⌘P su Mac) dentro il Reader, oppure usa il bottone PDF nella barra.',
  downloadAuthorPdf: (name) => `Scarica il PDF salvato dall’autore (${name})`,
  copyCitationFor: (id) => `Copia la citazione di ${id}`,
  copyCitationPrompt: 'Copia la citazione:',
  anchors: (n) => count(n, 'ancora', 'ancore'),
  checking: 'verifica in corso…',
  verifiedLocally: 'verificato in locale',
  integrityOk: 'Integrità: ogni file corrisponde alla sua impronta SHA-256 (§8.2)',
  integrityFailed: 'Integrità: NON RIUSCITA (§8.2)',
  determinismOk: 'Determinismo: il livello AI è l’estrazione canonica del contenuto (§7.1)',
  determinismFailed: 'Determinismo: NON RIUSCITO (§7.1)',
  conformanceOk: 'Conformità: profilo WDF-HTML, dataset ed estensioni (§5–§6, §10)',
  conformanceFailed: 'Conformità: NON RIUSCITA (§5–§6, §10)',
  warning: 'avviso: ',
  verificationCrashed: (e) => `La verifica non è riuscita a partire: ${e}`,
  notAuthenticity:
    'Integrità non è autenticità: le impronte provano che il pacchetto è coerente, non chi l’ha scritto (§8.3, §11.4)',
  status: {
    verified: {
      label: 'Verificato',
      detail:
        'pacchetto conforme, ogni file corrisponde alla sua impronta, il livello AI è la derivazione canonica del contenuto (§5–§8)',
    },
    'not-conforming': {
      label: 'Non conforme',
      detail:
        'il pacchetto viola le regole del profilo WDF-HTML, dei dataset o della struttura (§3–§6, §10)',
    },
    'integrity-failed': {
      label: 'Integrità non riuscita',
      detail:
        'un file non corrisponde alla sua impronta SHA-256: il pacchetto è stato manomesso o è danneggiato (§8.2)',
    },
    'derivation-failed': {
      label: 'Derivazione non riuscita',
      detail: 'il livello AI non è l’estrazione canonica del contenuto (§7.1)',
    },
    'unsupported-version': {
      label: 'Versione non supportata',
      detail:
        'il pacchetto dichiara una versione WDF che questo validatore non implementa; non è stato controllato niente (§4.1)',
    },
    'not-verifiable': {
      label: 'Non verificabile',
      detail: 'un passo della verifica non è riuscito a partire',
    },
  },
  capturedOn: (at) => `catturato da una pagina dal vivo il ${at}`,
  capture: (article) =>
    `Cattura: ${article ? 'articolo estratto' : 'pagina intera'} da una pagina dal vivo, già visualizzata — integrità non è autenticità (§11.4)`,
  capturedUrl: 'URL catturato',
  capturedAt: 'Catturato il',
  userAgent: 'User agent',
  viewport: 'Viewport',
};

export const MESSAGES: Readonly<Record<Lang, Messages>> = { en: EN, it: IT };

const STORE_KEY = 'wdf-lang';

/** The saved choice, else the browser's first language (it* → Italian), else English. */
export function initialLang(saved: string | null, browser: readonly string[]): Lang {
  if (saved === 'en' || saved === 'it') return saved;
  return browser[0]?.toLowerCase().startsWith('it') === true ? 'it' : 'en';
}

function readSaved(): string | null {
  try {
    return localStorage.getItem(STORE_KEY);
  } catch {
    return null; // file:// in some browsers, private modes, blocked storage
  }
}

let current: Lang = 'en';
const listeners: (() => void)[] = [];

export function lang(): Lang {
  return current;
}

/** The code's texts in the current language. */
export function msg(): Messages {
  return MESSAGES[current];
}

/** Runs `fn` after every language change (re-render dynamic texts). */
export function onLangChange(fn: () => void): void {
  listeners.push(fn);
}

const ATTRS = ['title', 'aria-label', 'placeholder'] as const;
// The English of each translated node, read once from the markup.
const english = new WeakMap<Element, Map<string, string>>();

function remember(el: Element, slot: string, value: string): string {
  let slots = english.get(el);
  if (slots === undefined) {
    slots = new Map();
    english.set(el, slots);
  }
  if (!slots.has(slot)) slots.set(slot, value);
  return slots.get(slot) ?? value;
}

/** Applies `to` to every data-i18n* node under `root` (the whole shell). */
export function translateShell(root: ParentNode, to: Lang): void {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    const key = el.getAttribute('data-i18n') ?? '';
    const en = remember(el, '', el.innerHTML);
    el.innerHTML = to === 'it' ? (SHELL_IT[key] ?? en) : en;
  }
  for (const attr of ATTRS) {
    for (const el of root.querySelectorAll(`[data-i18n-${attr}]`)) {
      const key = el.getAttribute(`data-i18n-${attr}`) ?? '';
      const en = remember(el, attr, el.getAttribute(attr) ?? '');
      el.setAttribute(attr, to === 'it' ? (SHELL_IT[key] ?? en) : en);
    }
  }
}

function paintSwitches(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-lang]')) {
    button.setAttribute('aria-pressed', String(button.dataset['lang'] === current));
  }
}

export function setLang(next: Lang, save = true): void {
  current = next;
  document.documentElement.lang = next;
  translateShell(document, next);
  paintSwitches();
  if (save) {
    try {
      localStorage.setItem(STORE_KEY, next);
    } catch {
      /* the choice just lasts this visit */
    }
  }
  for (const fn of listeners) fn();
}

/** Picks the starting language and wires every EN | IT switch. */
export function initLang(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-lang]')) {
    button.addEventListener('click', () => {
      const next = button.dataset['lang'];
      if ((next === 'en' || next === 'it') && next !== current) setLang(next);
    });
  }
  // ?lang=en|it (plan §10.83: the Italian site links the Reader with
  // ?lang=it) is an explicit choice, saved like the switch's.
  const asked = new URLSearchParams(location.search).get('lang');
  if (asked === 'en' || asked === 'it') {
    setLang(asked);
    return;
  }
  const browser = navigator.languages.length > 0 ? navigator.languages : [navigator.language];
  const start = initialLang(readSaved(), browser);
  if (start === 'en') paintSwitches();
  else setLang(start, false);
}
