// On-screen side of the clash mini-game: the tug-of-war bar, a mash pad for each side, the
// countdown, the timer and the result call. Input is forwarded to the duel through onPad /
// onBackground.

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const COPY = {
  action: {
    title: 'CLASH!',
    roles: ['ATTACKER', 'DEFENDER'],
    sub: { 0: 'CPU vs CPU', a: 'Mash any key or tap to win the fight!', b: 'Mash any key or tap to survive!', 2: 'Left: mash A S D F · Right: mash J K L' },
    win: (name) => `${name} wins the clash!`,
    hold: (name) => `${name} fights it off!`,
  },
  kids: {
    title: 'BONK-OFF!',
    roles: ['BONKER', 'BONKEE'],
    sub: { 0: 'Who will win?', a: 'Tap tap tap as fast as you can!', b: 'Tap tap tap to wiggle free!', 2: 'Left: tap A S D F · Right: tap J K L' },
    win: (name) => `${name} wins the bonk-off!`,
    hold: (name) => `${name} wiggles free!`,
  },
};

export class DuelUI {
  constructor() {
    this.root = null;
    this.onPad = null;
    this.onBackground = null;
  }

  // a / b: { player, color: { css }, animal: { name, emoji } } for attacker and defender.
  open({ kids, humans, a, b }) {
    this.close();
    const copy = (this.copy = kids ? COPY.kids : COPY.action);
    const root = (this.root = el('div', `duel${kids ? ' kids' : ''}`));
    root.style.setProperty('--ca', a.color.css);
    root.style.setProperty('--cb', b.color.css);
    const human = humans === 1 ? (a.player.cpu ? 'b' : 'a') : humans;

    const head = el('div', 'duel-head');
    head.append(el('div', 'duel-title', copy.title), el('div', 'duel-sub', copy.sub[human]));
    this.countEl = el('div', 'duel-count');

    const bar = (this.bar = el('div', 'duel-bar'));
    this.fillA = el('div', 'duel-fill a');
    this.fillB = el('div', 'duel-fill b');
    this.knot = el('div', 'duel-knot');
    bar.append(this.fillA, this.fillB, this.knot);

    const pad = (side, s, role) => {
      const p = el('button', `duel-pad ${side}${s.player.cpu ? ' cpu' : ''}`);
      p.type = 'button';
      const hint = s.player.cpu ? 'CPU' : humans === 2 ? (side === 'a' ? 'A S D F · tap here' : 'J K L · tap here') : kids ? 'TAP!' : 'MASH!';
      p.append(el('span', 'role', role), el('span', 'who', `${s.animal.emoji} ${s.player.name}`), el('span', 'hint', hint), el('b', 'taps', '0'));
      p.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.onPad?.(side, e);
      });
      return p;
    };
    this.padA = pad('a', a, copy.roles[0]);
    this.padB = pad('b', b, copy.roles[1]);
    this.timer = el('div', 'duel-timer', '');
    const row = el('div', 'duel-row');
    row.append(this.padA, this.timer, this.padB);
    const foot = el('div', 'duel-foot');
    foot.append(bar, row);
    root.append(head, this.countEl, foot);
    root.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.onBackground?.(e);
    });
    this.names = { a: a.player.name, b: b.player.name };
    document.body.append(root);
    document.body.classList.add('dueling');
    this.update({ x: 0, left: null, taps: { a: 0, b: 0 } });
  }

  count(text) {
    if (!this.countEl) return;
    this.countEl.textContent = text;
    this.countEl.classList.remove('pop');
    void this.countEl.offsetWidth;
    this.countEl.classList.add('pop');
  }

  update({ x, left, taps }) {
    if (!this.root) return;
    const split = ((1 + x) / 2) * 100;
    this.fillA.style.width = `${split}%`;
    this.fillB.style.width = `${100 - split}%`;
    this.knot.style.left = `${split}%`;
    this.root.classList.toggle('danger-a', x < -0.6);
    this.root.classList.toggle('danger-b', x > 0.6);
    this.timer.textContent = left === null ? '' : left.toFixed(1);
    this.padA.querySelector('.taps').textContent = taps.a;
    this.padB.querySelector('.taps').textContent = taps.b;
  }

  hit(side) {
    const p = side === 'a' ? this.padA : this.padB;
    if (!p) return;
    p.classList.remove('hit');
    void p.offsetWidth;
    p.classList.add('hit');
  }

  // Announce the winner (the caller decides how long it stays up).
  result(attackerWins) {
    if (!this.root) return;
    this.root.classList.add('over', attackerWins ? 'won-a' : 'won-b');
    this.count(attackerWins ? this.copy.win(this.names.a) : this.copy.hold(this.names.b));
    this.countEl.classList.add('result');
  }

  fadeOut() {
    const root = this.root;
    if (!root) return;
    root.classList.add('out');
    document.body.classList.remove('dueling');
    this.root = null;
    this.countEl = null;
    setTimeout(() => root.remove(), 320);
  }

  close() {
    document.body.classList.remove('dueling');
    this.root?.remove();
    this.root = null;
    this.countEl = null;
  }
}
