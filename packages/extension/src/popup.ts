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

function $(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`missing element #${id}`);
  return node;
}

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
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
  const tabId = await activeTabId();
  if (tabId === undefined) return;
  const mode = (document.querySelector('input[name="mode"]:checked') as HTMLInputElement | null)
    ?.value;
  const request: StartRequest = {
    type: 'wdf-start',
    tabId,
    options: { mode: mode === 'full-page' ? 'full-page' : 'article', output },
  };
  setBusy(true);
  await chrome.runtime.sendMessage(request);
}

chrome.runtime.onMessage.addListener((message: unknown) => {
  const status = message as Partial<StatusMessage>;
  if (status.type !== 'wdf-status') return;
  setBusy(false);
  showStatus(status.lines ?? [], status.ok !== true);
});

void (async () => {
  const stored = await chrome.storage.local.get(PRIVACY_ACK_KEY);
  const acknowledged = stored[PRIVACY_ACK_KEY] === true;
  $('privacy-notice').hidden = acknowledged;
  $('controls').hidden = !acknowledged;

  $('privacy-ack').addEventListener('click', () => {
    void chrome.storage.local.set({ [PRIVACY_ACK_KEY]: true }).then(() => {
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
