import { isKids } from '../settings.js';

// The Sound settings: one volume slider per group of sounds, shown on the main menu and in the
// in-game menu (the two stay in sync). The levels are kept in localStorage.

const STORAGE_KEY = 'action-ludo-sound-v1';
const DEFAULTS = { master: 1, fight: 1, cage: 1, dice: 1, move: 1, music: 1, ambience: 0.6 };

// [key, Action label, Kids label, sound played when the slider is let go]
const ROWS = [
  ['master', 'All sounds', 'All sounds', 'click'],
  ['fight', 'Fights & animals', 'Bonks & animals', 'clash'],
  ['cage', 'Cages, keys & chains', 'Cages & keys', 'lockSnap'],
  ['dice', 'Dice', 'Dice', 'diceHit'],
  ['move', 'Footsteps & hops', 'Hops', 'hop'],
  ['music', 'Cheers, fanfares & menus', 'Cheers, songs & menus', 'cheer'],
  ['ambience', 'Background (night jungle)', 'Background (garden birds)', null],
];

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
    // the old on/off switch for background sounds
    if (localStorage.getItem('action-ludo-ambience') === 'off') return { ...DEFAULTS, ambience: 0 };
  } catch {
    /* storage unavailable */
  }
  return { ...DEFAULTS };
}

function save(levels) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(levels));
  } catch {
    /* storage unavailable */
  }
}

export class SoundPanel {
  // roots: elements to render the sliders into (a <details> gets a summary line too)
  constructor(roots, sfx) {
    this.roots = roots;
    this.sfx = sfx;
    this.levels = load();
    for (const [key, v] of Object.entries(this.levels)) sfx.setVolume(key, v);
    this.render();
  }

  set(key, v, preview = null) {
    this.levels[key] = v;
    this.sfx.setVolume(key, v);
    save(this.levels);
    for (const root of this.roots) {
      const input = root.querySelector(`input[data-key="${key}"]`);
      if (input && +input.value !== Math.round(v * 100)) input.value = Math.round(v * 100);
      const out = root.querySelector(`output[data-key="${key}"]`);
      if (out) out.textContent = `${Math.round(v * 100)}%`;
    }
    if (preview && v > 0) {
      this.sfx.unlock();
      this.sfx.play(preview);
    }
  }

  render() {
    const kids = isKids();
    this.roots.forEach((root, r) => {
      const open = root.open;
      root.innerHTML = '';
      if (root.tagName === 'DETAILS') {
        const summary = document.createElement('summary');
        summary.textContent = '🔊 Sound';
        root.append(summary);
      }
      const list = document.createElement('div');
      list.className = 'vol-list';
      for (const [key, action, kid, preview] of ROWS) {
        const id = `vol-${key}-${r}`;
        const row = document.createElement('div');
        row.className = `vol-row${key === 'master' ? ' master' : ''}`;
        const label = Object.assign(document.createElement('label'), { htmlFor: id, textContent: kids ? kid : action });
        const input = Object.assign(document.createElement('input'), { type: 'range', id, min: 0, max: 100, step: 5, value: Math.round(this.levels[key] * 100) });
        input.dataset.key = key;
        const out = document.createElement('output');
        out.dataset.key = key;
        out.htmlFor = id;
        out.textContent = `${input.value}%`;
        input.oninput = () => this.set(key, input.value / 100);
        input.onchange = () => this.set(key, input.value / 100, preview);
        row.append(label, input, out);
        list.append(row);
      }
      root.append(list);
      if (root.tagName === 'DETAILS') root.open = open;
    });
  }
}
