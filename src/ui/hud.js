import { ANIMALS, COLORS, animalById } from '../config.js';

const $ = (id) => document.getElementById(id);

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'style') Object.assign(node.style, v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') node.innerHTML = v;
    else node[k] = v;
  }
  for (const c of [].concat(children)) node.append(c);
  return node;
}

const DEFAULT_ANIMALS = ['eagle', 'tiger', 'shark', 'gorilla'];
const MEDALS = ['🥇', '🥈', '🥉', '🏳️'];
const STORAGE_KEY = 'action-ludo-setup-v1';

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function save(slots) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slots));
  } catch {
    /* storage unavailable */
  }
}

export class Hud {
  constructor(handlers) {
    this.h = handlers;
    const saved = loadSaved();
    this.slots = COLORS.map((c, i) => {
      const s = saved?.[i];
      const animal = s && animalById(s.animal) ? s.animal : DEFAULT_ANIMALS[i];
      return {
        seat: c.seat,
        mode: s?.mode ?? (i === 0 ? 'human' : 'cpu'),
        animal,
        name: s?.name ?? '',
      };
    });
    this.arenaPick = { atk: { seat: 0, animal: 'eagle' }, vic: { seat: 3, animal: 'tiger' } };
    this.renderSlots();
    this.renderArena();
    this.bind();
  }

  // ---------------------------------------------------------------- setup screen
  defaultName(slot) {
    return `${COLORS[slot.seat].name} ${animalById(slot.animal).name}`;
  }

  players() {
    return this.slots
      .filter((s) => s.mode !== 'off')
      .map((s) => ({
        seat: s.seat,
        color: COLORS[s.seat].id,
        animal: s.animal,
        cpu: s.mode === 'cpu',
        name: s.name.trim() || this.defaultName(s),
      }));
  }

  renderSlots() {
    const root = $('slots');
    root.innerHTML = '';
    this.slots.forEach((slot) => {
      const color = COLORS[slot.seat];
      const animal = animalById(slot.animal);
      const card = el('div', { className: `slot ${slot.mode === 'off' ? 'off' : ''}`, style: { '--team': color.css } });
      card.style.setProperty('--team', color.css);
      const seg = el(
        'div',
        { className: 'seg' },
        ['off', 'human', 'cpu'].map((mode) =>
          el('button', {
            className: slot.mode === mode ? 'on' : '',
            textContent: mode === 'cpu' ? 'CPU' : mode[0].toUpperCase() + mode.slice(1),
            onclick: () => {
              slot.mode = mode;
              this.slotsChanged();
            },
          }),
        ),
      );
      card.append(el('div', { className: 'slot-head' }, [el('span', { className: 'dot' }), el('b', { textContent: color.name }), seg]));
      const name = el('input', {
        className: 'name',
        maxLength: 16,
        placeholder: this.defaultName(slot),
        value: slot.name,
        oninput: (e) => {
          slot.name = e.target.value;
          save(this.slots);
        },
      });
      card.append(name);
      const grid = el(
        'div',
        { className: 'animals' },
        ANIMALS.map((a) =>
          el('button', {
            className: `animal ${a.id === slot.animal ? 'on' : ''}`,
            title: `${a.name} — ${a.move}`,
            html: `<span>${a.emoji}</span><small>${a.name}</small>`,
            onclick: () => {
              slot.animal = a.id;
              this.slotsChanged();
            },
          }),
        ),
      );
      card.append(grid);
      card.append(el('div', { className: 'animal-info', html: `<b>${animal.move}</b> — ${animal.blurb}` }));
      root.append(card);
    });
    const active = this.slots.filter((s) => s.mode !== 'off').length;
    const humans = this.slots.filter((s) => s.mode === 'human').length;
    $('btn-start').disabled = active < 2;
    $('setup-error').textContent = active < 2 ? 'Turn on at least two players.' : humans === 0 ? 'All CPU — sit back and watch the carnage.' : '';
  }

  slotsChanged() {
    save(this.slots);
    this.renderSlots();
    this.h.onConfigChange?.(this.players());
  }

  showSetup() {
    $('setup').classList.remove('hidden');
    $('hud').classList.add('hidden');
    $('arena').classList.add('hidden');
    $('arena-hud').classList.add('hidden');
    $('gameover').classList.add('hidden');
    this.hideBanner();
  }

  // ---------------------------------------------------------------- arena screen
  renderArena() {
    const side = (key, label) => {
      const root = $(key === 'atk' ? 'arena-atk' : 'arena-vic');
      root.innerHTML = '';
      const pick = this.arenaPick[key];
      const other = this.arenaPick[key === 'atk' ? 'vic' : 'atk'];
      const team = COLORS[pick.seat].css;
      root.style.setProperty('--team', team);
      root.append(el('h3', { textContent: label }));
      root.append(
        el(
          'div',
          { className: 'color-chips' },
          COLORS.map((c) => {
            const chip = el('button', {
              className: `chip ${c.seat === pick.seat ? 'on' : ''}`,
              title: c.name,
              disabled: c.seat === other.seat,
              onclick: () => {
                pick.seat = c.seat;
                this.renderArena();
              },
            });
            chip.style.setProperty('--c', c.css);
            return chip;
          }),
        ),
      );
      root.append(
        el(
          'div',
          { className: 'animals' },
          ANIMALS.map((a) =>
            el('button', {
              className: `animal ${a.id === pick.animal ? 'on' : ''}`,
              title: `${a.name} — ${a.move}`,
              html: `<span>${a.emoji}</span><small>${a.name}</small>`,
              onclick: () => {
                pick.animal = a.id;
                this.renderArena();
              },
            }),
          ),
        ),
      );
      const a = animalById(pick.animal);
      root.append(el('div', { className: 'animal-info', html: key === 'atk' ? `<b>${a.move}</b> — ${a.blurb}` : `Gets torn apart, chained and dragged back to its cage.` }));
    };
    side('atk', 'Attacker');
    side('vic', 'Defender');
  }

  showArena() {
    $('setup').classList.add('hidden');
    $('arena').classList.remove('hidden');
    $('arena-hud').classList.add('hidden');
    $('hud').classList.add('hidden');
    this.renderArena();
  }

  arenaFighting() {
    $('arena').classList.add('hidden');
    $('arena-hud').classList.remove('hidden');
  }

  randomArena() {
    const pickAnimal = () => ANIMALS[Math.floor(Math.random() * ANIMALS.length)].id;
    const seats = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
    this.arenaPick = { atk: { seat: seats[0], animal: pickAnimal() }, vic: { seat: seats[1], animal: pickAnimal() } };
    this.renderArena();
  }

  // ---------------------------------------------------------------- in-game HUD
  showGame(game) {
    $('setup').classList.add('hidden');
    $('arena').classList.add('hidden');
    $('arena-hud').classList.add('hidden');
    $('gameover').classList.add('hidden');
    $('hud').classList.remove('hidden');
    $('die-face').textContent = '–';
    this.updatePlayers(game);
  }

  updatePlayers(game) {
    this.game = game;
    const root = $('players');
    root.innerHTML = '';
    const active = game.players[game.turn];
    for (const p of game.players) {
      const color = COLORS[p.seat];
      const animal = animalById(p.animal);
      const home = game.tokens.filter((t) => t.seat === p.seat && t.progress === 56).length;
      const out = game.tokens.filter((t) => t.seat === p.seat && t.progress >= 0 && t.progress < 56).length;
      const rank = game.standings.indexOf(p.seat);
      const chip = el('div', { className: `pchip ${p === active && !game.over ? 'active' : ''} ${p.done ? 'done' : ''}` }, [
        el('div', { className: 'avatar', textContent: animal.emoji }),
        el('div', { className: 'meta' }, [
          el('b', { textContent: p.name + (p.cpu ? ' 🤖' : '') }),
          el('small', { textContent: rank >= 0 ? `${MEDALS[rank]} finished` : `🏠 ${home}/4 · 🐾 ${out} out` }),
        ]),
      ]);
      chip.style.setProperty('--team', color.css);
      root.append(chip);
    }
  }

  setTurn(game, player) {
    this.updatePlayers(game);
    $('turn-card').style.setProperty('--team', COLORS[player.seat].css);
  }

  setMessage(html) {
    $('message').innerHTML = html;
  }

  enableRoll(on) {
    $('btn-roll').disabled = !on;
  }

  showRoll(value, css) {
    const face = $('die-face');
    face.textContent = value;
    face.style.color = value === 6 ? css : '#1b1b1b';
    face.classList.remove('pop');
    void face.offsetWidth;
    face.classList.add('pop');
  }

  toast(text, ms = 1800) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  battleBanner(atk, vic) {
    const a = animalById(atk.animal);
    const v = animalById(vic.animal);
    const side = (cls, p, animal) => {
      const node = el('span', { className: `side ${cls}`, textContent: `${animal.emoji} ${p.name}` });
      node.style.setProperty('--c', COLORS[p.seat].css);
      return node;
    };
    this.showBanner([el('div', { className: 'row' }, [side('a', atk, a), el('span', { className: 'vs', textContent: 'VS' }), side('b', vic, v)])], 1800);
  }

  // Brutal title card at the moment of the kill.
  killTitle(atk, vic) {
    const a = animalById(atk.animal);
    const card = el('div', { className: 'kill-card' }, [
      el('div', { className: 'kill-move', textContent: a.move.toUpperCase() }),
      el('div', { className: 'kill-line', textContent: `${atk.name} ${a.verb} ${vic.name}` }),
    ]);
    card.style.setProperty('--c', COLORS[atk.seat].css);
    this.showBanner([card], 2400, 'kill');
  }

  showBanner(children, ms, extra = '') {
    const b = $('banner');
    b.className = `banner ${extra}`;
    b.innerHTML = '';
    b.append(...children);
    clearTimeout(this.bannerTimer);
    clearTimeout(this.bannerTimer2);
    this.bannerTimer = setTimeout(() => {
      b.classList.add('out');
      this.bannerTimer2 = setTimeout(() => this.hideBanner(), 400);
    }, ms);
  }

  hideBanner() {
    $('banner').className = 'banner hidden';
  }

  showGameOver(game) {
    this.updatePlayers(game);
    const list = $('standings');
    list.innerHTML = '';
    game.standings.forEach((seat, i) => {
      const p = game.players.find((x) => x.seat === seat);
      const a = animalById(p.animal);
      const li = el('li', {}, [el('span', { className: 'medal', textContent: MEDALS[i] }), el('span', { textContent: `${a.emoji} ${p.name}` })]);
      li.style.setProperty('--team', COLORS[seat].css);
      list.append(li);
    });
    $('gameover').classList.remove('hidden');
  }

  // ---------------------------------------------------------------- wiring
  bind() {
    const h = this.h;
    const gore = $('opt-gore');
    try {
      gore.checked = localStorage.getItem('action-ludo-gore') !== 'off';
    } catch {
      /* storage unavailable */
    }
    gore.onchange = () => {
      try {
        localStorage.setItem('action-ludo-gore', gore.checked ? 'on' : 'off');
      } catch {
        /* storage unavailable */
      }
      h.onGore?.(gore.checked);
    };
    h.onGore?.(gore.checked);
    $('btn-start').onclick = () => h.onStart(this.players());
    $('btn-arena').onclick = () => h.onArenaOpen();
    $('btn-arena-back').onclick = () => h.onArenaBack();
    $('btn-fight').onclick = () => h.onFight(this.arenaPick);
    $('btn-random').onclick = () => {
      this.randomArena();
      h.onFight(this.arenaPick);
    };
    $('btn-arena-skip').onclick = () => h.onArenaSkip();
    $('btn-roll').onclick = () => h.onRoll();
    $('btn-speed').onclick = (e) => {
      const next = h.onSpeed();
      e.currentTarget.textContent = `${next}×`;
    };
    $('btn-sound').onclick = (e) => {
      const on = h.onSound();
      e.currentTarget.textContent = on ? '🔊' : '🔇';
    };
    $('btn-cam').onclick = () => h.onCamera();
    $('btn-menu').onclick = () => {
      if (confirm('Quit this game and return to the menu?')) h.onMenu();
    };
    $('btn-menu2').onclick = () => h.onMenu();
    $('btn-again').onclick = () => h.onStart(this.players());
  }
}
