// Popup (T18.5, §10.31 "UX"): default extracted-article → standalone
// .wdf.html (§10.38); options: full page, bare .wdf. First capture shows
// the one-time privacy notice (no session heuristic — httpOnly cookies
// are invisible and a detector would give false safety; the notice forms
// the habit, then responsibility is the user's).
import {
  PRIVACY_ACK_KEY,
  type CaptureOptions,
  type StartRequest,
  type StatusMessage,
} from './protocol.js';
import { ext } from './compat.js';
import { isGoogleDocsUrl } from './gdocs.js';

function $(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`missing element #${id}`);
  return node;
}

async function activeTab(): Promise<{ id?: number; url?: string }> {
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  return {
    ...(tab?.id !== undefined && { id: tab.id }),
    ...(tab?.url !== undefined && { url: tab.url }),
  };
}

function showStatus(lines: string[], isError: boolean): void {
  const status = $('status');
  status.hidden = false;
  status.textContent = '';
  const head = document.createElement('div');
  head.textContent = isError ? 'Conversion failed:' : 'Saved. Conversion report:';
  if (isError) head.className = 'error';
  status.append(head);
  const ul = document.createElement('ul');
  for (const line of lines) {
    const li = document.createElement('li');
    li.textContent = line;
    if (isError) li.className = 'error';
    ul.append(li);
  }
  if (lines.length > 0) status.append(ul);
}

function setBusy(busy: boolean): void {
  ($('save-standalone') as HTMLButtonElement).disabled = busy;
  ($('save-wdf') as HTMLButtonElement).disabled = busy;
  if (busy) {
    const status = $('status');
    status.hidden = false;
    status.textContent = 'Capturing and converting…';
  }
}

async function start(output: CaptureOptions['output']): Promise<void> {
  const tab = await activeTab();
  if (tab.id === undefined) return;
  const mode = (document.querySelector('input[name="mode"]:checked') as HTMLInputElement | null)
    ?.value;
  // Site-aware capture (T18.9): on a Google Doc the DOM is a canvas —
  // the official export is the honest source, and it is always the
  // whole document.
  const gdocs = isGoogleDocsUrl(tab.url ?? '');
  const options: CaptureOptions = gdocs
    ? { mode: 'full-page', output, site: 'gdocs' }
    : { mode: mode === 'full-page' ? 'full-page' : 'article', output };
  const request: StartRequest = { type: 'wdf-start', tabId: tab.id, options };
  setBusy(true);
  await ext.runtime.sendMessage(request);
}

ext.runtime.onMessage.addListener((message: unknown) => {
  const status = message as Partial<StatusMessage>;
  if (status.type !== 'wdf-status') return;
  setBusy(false);
  showStatus(status.lines ?? [], status.ok !== true);
});

void (async () => {
  const stored = await ext.storage.local.get(PRIVACY_ACK_KEY);
  const acknowledged = stored[PRIVACY_ACK_KEY] === true;
  $('privacy-notice').hidden = acknowledged;
  $('controls').hidden = !acknowledged;

  // Google Doc open in the active tab → announce the export path and
  // hide the article/full-page choice (the export is the whole document).
  const tab = await activeTab();
  if (isGoogleDocsUrl(tab.url ?? '')) {
    $('gdocs-note').hidden = false;
    $('mode-fieldset').hidden = true;
  }

  $('privacy-ack').addEventListener('click', () => {
    void ext.storage.local.set({ [PRIVACY_ACK_KEY]: true }).then(() => {
      $('privacy-notice').hidden = true;
      $('controls').hidden = false;
    });
  });
  $('save-standalone').addEventListener('click', () => {
    void start('standalone');
  });
  $('save-wdf').addEventListener('click', () => {
    void start('wdf');
  });
})();
