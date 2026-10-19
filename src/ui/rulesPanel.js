import { DEFAULT_RULES, RULE_PRESETS, normalizeRules } from '../game/rules.js';
import { isKids } from '../settings.js';

// The "House rules" panel on the setup screen: presets plus a switch for every rule. The choice is
// kept in localStorage and handed to the game when it starts.

const STORAGE_KEY = 'action-ludo-rules-v1';

// [rule, label, description] per section; Kids mode gets friendlier wording.
const SECTIONS = (kids) => [
  [
    kids ? 'Bonking' : 'Fights',
    [
      ['clash', kids ? 'Bonk-off first' : 'Head-to-head clash', kids ? 'Before a bonk, both friends tap as fast as they can. If the bonkee wins, it stays!' : 'Before any kill, attacker and defender mash it out. If the defender wins, it survives and shares the square.'],
      ['safePairs', kids ? 'Buddies are safe' : 'Safe pairs', kids ? 'Two pals sharing a square can’t be bonked.' : 'Two pieces sharing a square (any colours) can’t be attacked.'],
      ['safeSquares', kids ? 'Safe stars' : 'Safe stars', kids ? 'Nobody can be bonked on a star ⭐ (start squares are always safe).' : 'Nobody can be attacked on a star square (start squares are always safe).'],
      ['blockades', 'Blockades', kids ? 'Two pals of one colour on a square make a wall: only a 6 can hop over it.' : 'Two pieces of one colour form a wall: opponents can’t land on it, and only a 6 jumps it.'],
    ],
  ],
  [
    'Getting going',
    [
      ['release', kids ? 'Leave the cage on' : 'Release on', kids ? 'Which roll lets a pal out of its cage.' : 'Which roll lets an animal out of its cage.', [['6', 'a 6'], ['1or6', 'a 1 or 6']]],
      ['quickStart', 'Quick start', kids ? 'Everyone starts with one pal already out.' : 'Every player starts with one animal already on the board.'],
    ],
  ],
  [
    'Extra rolls',
    [
      ['captureBonus', kids ? 'Roll again after a bonk' : 'Roll again after a capture', ''],
      ['homeBonus', 'Roll again after getting home', ''],
      ['threeSixes', 'Three 6s skip your turn', kids ? 'Rolling three 6s in a row ends your turn.' : 'Three 6s in a row forfeit the turn.'],
    ],
  ],
  [
    'Going home',
    [
      ['killToEnter', kids ? 'Bonk to go home' : 'Kill to enter home', kids ? 'You need to bonk someone before your pals can go up your home path.' : 'Your animals can’t enter their home column until you’ve captured someone.'],
      ['bounce', 'Finishing', kids ? 'Too big a number: wait for the right one, or bounce back.' : 'Roll too high for the centre: wait for the exact roll, or bounce back.', [[false, 'exact roll'], [true, 'bounce back']]],
      ['piecesToWin', 'Pieces to win', kids ? 'How many pals you need to get home.' : 'How many animals a player must get home.', [[1, '1'], [2, '2'], [3, '3'], [4, 'all 4']]],
    ],
  ],
];

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return normalizeRules(raw ? JSON.parse(raw) : {});
  } catch {
    return normalizeRules({});
  }
}

function save(rules) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
  } catch {
    /* storage unavailable */
  }
}

const same = (a, b) => Object.keys(DEFAULT_RULES).every((k) => a[k] === b[k]);

export class RulesPanel {
  constructor(root) {
    this.root = root;
    this.rules = load();
    this.render();
  }

  get() {
    return { ...this.rules };
  }

  presetKey() {
    return Object.keys(RULE_PRESETS).find((k) => same(this.rules, normalizeRules(RULE_PRESETS[k].rules))) ?? null;
  }

  set(rules) {
    this.rules = normalizeRules(rules);
    save(this.rules);
    this.render();
  }

  render() {
    const kids = isKids();
    const open = this.root.open;
    this.root.innerHTML = '';
    const preset = this.presetKey();
    const summary = document.createElement('summary');
    summary.innerHTML = `⚙ House rules <span class="rules-preset">${preset ? RULE_PRESETS[preset].name : 'Custom'}</span>`;
    this.root.append(summary);

    const presets = document.createElement('div');
    presets.className = 'rule-presets';
    for (const [key, p] of Object.entries(RULE_PRESETS)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `rule-preset${key === preset ? ' on' : ''}`;
      b.innerHTML = `<b>${p.name}</b><small>${p.blurb}</small>`;
      b.onclick = () => this.set(p.rules);
      presets.append(b);
    }
    this.root.append(presets);

    for (const [title, rows] of SECTIONS(kids)) {
      const sec = document.createElement('div');
      sec.className = 'rule-section';
      sec.append(Object.assign(document.createElement('h3'), { textContent: title }));
      for (const [key, label, desc, options] of rows) {
        const row = document.createElement('div');
        row.className = 'rule-row';
        const text = document.createElement('div');
        text.className = 'rule-text';
        text.innerHTML = `<b>${label}</b>${desc ? `<small>${desc}</small>` : ''}`;
        row.append(text);
        if (options) {
          const seg = document.createElement('div');
          seg.className = 'rule-seg';
          seg.setAttribute('role', 'radiogroup');
          seg.setAttribute('aria-label', label);
          for (const [value, name] of options) {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = name;
            const on = this.rules[key] === value;
            b.className = on ? 'on' : '';
            b.setAttribute('role', 'radio');
            b.setAttribute('aria-checked', String(on));
            b.onclick = () => this.set({ ...this.rules, [key]: value });
            seg.append(b);
          }
          row.append(seg);
        } else {
          const sw = document.createElement('label');
          sw.className = 'rule-switch';
          const input = Object.assign(document.createElement('input'), { type: 'checkbox', checked: !!this.rules[key] });
          input.setAttribute('aria-label', label);
          input.onchange = () => this.set({ ...this.rules, [key]: input.checked });
          sw.append(input, document.createElement('span'));
          row.append(sw);
        }
        sec.append(row);
      }
      this.root.append(sec);
    }
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'btn ghost small rule-reset';
    reset.textContent = 'Reset to standard rules';
    reset.onclick = () => this.set({});
    this.root.append(reset);
    this.root.open = open;
  }
}
