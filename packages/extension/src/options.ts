// Options page (T18.5): restore the one-time privacy notice (§10.31).
import { PRIVACY_ACK_KEY } from './protocol.js';

const state = document.getElementById('ack-state');

async function render(): Promise<void> {
  const stored = await chrome.storage.local.get(PRIVACY_ACK_KEY);
  if (state !== null) {
    state.textContent =
      stored[PRIVACY_ACK_KEY] === true ? 'already acknowledged' : 'not yet acknowledged';
  }
}

document.getElementById('reset-privacy')?.addEventListener('click', () => {
  void chrome.storage.local.remove(PRIVACY_ACK_KEY).then(render);
});

void render();
