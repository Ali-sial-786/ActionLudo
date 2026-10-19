// Global game settings shared by the UI and the renderer.
//   mode 'action' = realistic animals, brutal kill-cam battles
//   mode 'kids'   = cute characters, playful no-blood battles
export const settings = { mode: 'action' };

export const MODES = ['action', 'kids'];
export const MODE_STORAGE_KEY = 'action-ludo-mode';

export const isKids = () => settings.mode === 'kids';

export const normalizeMode = (mode) => (mode === 'kids' ? 'kids' : 'action');

// Startup mode: ?mode=kids|action in the URL wins, else the last choice saved in this browser.
export function initialMode(search = '', storage = null) {
  let fromUrl = null;
  try {
    fromUrl = new URLSearchParams(search).get('mode');
  } catch {
    /* malformed query */
  }
  if (fromUrl === 'kids' || fromUrl === 'action') return fromUrl;
  try {
    return normalizeMode(storage?.getItem(MODE_STORAGE_KEY));
  } catch {
    return 'action'; // storage unavailable
  }
}

export function saveMode(mode, storage) {
  try {
    storage?.setItem(MODE_STORAGE_KEY, normalizeMode(mode));
  } catch {
    /* storage unavailable */
  }
}
