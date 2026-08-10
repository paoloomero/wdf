// Options page (T18.5): restore the one-time privacy notice (§10.31).
import { PRIVACY_ACK_KEY } from './protocol.js';
import { ext } from './compat.js';

const state = document.getElementById('ack-state');

async function render(): Promise<void> {
  const stored = await ext.storage.local.get(PRIVACY_ACK_KEY);
  if (state !== null) {
    state.textContent =
      stored[PRIVACY_ACK_KEY] === true ? 'already acknowledged' : 'not yet acknowledged';
  }
}

document.getElementById('reset-privacy')?.addEventListener('click', () => {
  void ext.storage.local.remove(PRIVACY_ACK_KEY).then(render);
});

void render();
