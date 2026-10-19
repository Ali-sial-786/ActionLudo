import './style.css';
import { World } from './render/world.js';
import { BoardView } from './render/boardMesh.js';
import { Effects } from './render/effects.js';
import { Dice } from './render/dice.js';
import { GameController } from './game/controller.js';
import { Hud } from './ui/hud.js';
import { sfx } from './engine/audio.js';
import { goreSettings } from './render/gore.js';
import { initialMode, normalizeMode, saveMode, settings } from './settings.js';

const storage = (() => {
  try {
    return window.localStorage;
  } catch {
    return null; // storage unavailable
  }
})();

// Game mode: ?mode=kids|action in the URL, else the last choice saved in this browser.
settings.mode = initialMode(location.search, storage);
// Theme the page before anything renders so there is no flash of the wrong look.
applyPageTheme(settings.mode);

function applyPageTheme(mode) {
  const kids = mode === 'kids';
  document.body.classList.toggle('kids', kids);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', kids ? '#8fd6ff' : '#0d1230');
  document.title = kids ? 'Action Ludo — Kids' : 'Action Ludo';
}

const world = new World(document.getElementById('stage'), settings.mode);
const board = new BoardView(world.scene, settings.mode);
const fx = new Effects(world);
const dice = new Dice(world, fx, sfx, settings.mode);

const SPEEDS = [1, 2, 3];
let speedIndex = 0;
// Fast-forward multiplies the chosen speed until the current cinematic ends.
let fastForward = false;
const applySpeed = () => (world.anim.timeScale = SPEEDS[speedIndex] * (fastForward ? 4 : 1));

let controller;
const hud = new Hud({
  onConfigChange: (players) => controller.preview(players),
  onStart: (players) => {
    sfx.unlock();
    controller.start(players);
  },
  onArenaOpen: () => {
    sfx.unlock();
    hud.showArena();
  },
  onArenaBack: () => toMenu(),
  onFight: async ({ atk, vic }) => {
    sfx.unlock();
    hud.arenaFighting();
    const done = await controller.arena({ attacker: atk.animal, victim: vic.animal, attackerSeat: atk.seat, victimSeat: vic.seat });
    if (done) {
      await world.anim.wait(0.6);
      hud.showArena();
    }
  },
  onArenaSkip: () => {
    controller.abort();
    controller.preview(hud.players());
    world.resetView(0.6);
    hud.showArena();
  },
  onRoll: () => {
    sfx.unlock();
    controller.requestRoll();
  },
  onRollPress: () => {
    sfx.unlock();
    controller.pressRoll();
  },
  onRollRelease: () => controller.releaseRoll(),
  onSpeed: () => {
    speedIndex = (speedIndex + 1) % SPEEDS.length;
    applySpeed();
    return SPEEDS[speedIndex];
  },
  onSound: () => {
    sfx.setMuted(!sfx.muted);
    return !sfx.muted;
  },
  onCamera: () => {
    if (!world.cinematic && !world.directed) world.resetView(0.6);
  },
  onMenu: () => toMenu(),
  onGore: (on) => (goreSettings.enabled = on && settings.mode !== 'kids'),
  onMode: (mode) => {
    sfx.unlock();
    if (normalizeMode(mode) === settings.mode) return;
    setMode(mode);
    sfx.play(settings.mode === 'kids' ? 'boing' : 'click');
  },
});

controller = new GameController({ world, board, fx, dice, sfx, hud });

// Switch between Action and Kids mode from the menu: re-theme the page and the 3D scene,
// re-render the menu copy and rebuild the preview pieces with the matching animal style.
function setMode(mode) {
  settings.mode = normalizeMode(mode);
  saveMode(settings.mode, storage);
  // Keep a ?mode= link in sync so a reload doesn't flip back.
  try {
    const url = new URL(location.href);
    if (url.searchParams.has('mode')) {
      url.searchParams.set('mode', settings.mode);
      history.replaceState(null, '', url);
    }
  } catch {
    /* history unavailable */
  }
  applyMode();
  controller.preview(hud.players());
}

function applyMode() {
  const { mode } = settings;
  applyPageTheme(mode);
  goreSettings.enabled = mode !== 'kids' && hud.goreChecked();
  world.setTheme(mode);
  board.setTheme(mode);
  dice.setTheme(mode);
  hud.setMode(mode);
}

function toMenu() {
  controller.abort();
  controller.preview(hud.players());
  world.resetView(0.8).then(() => (world.idleOrbit = true));
  hud.showSetup();
}

const ffButton = document.getElementById('btn-ff');
const startFastForward = () => {
  if (!world.cinematic) return;
  fastForward = true;
  applySpeed();
};
ffButton.onclick = startFastForward;
world.onFrame(() => {
  if (!world.cinematic && fastForward) {
    fastForward = false;
    applySpeed();
  }
  ffButton.classList.toggle('hidden', !world.cinematic);
  ffButton.classList.toggle('on', fastForward);
});

// Space / Enter: hold to shake the die, release to throw it (or fast-forward a cinematic).
const isRollKey = (e) => (e.code === 'Space' || e.code === 'Enter') && !(e.target instanceof HTMLInputElement);
window.addEventListener('keydown', (e) => {
  if (!isRollKey(e)) return;
  e.preventDefault();
  if (e.repeat) return;
  sfx.unlock();
  if (world.cinematic) startFastForward();
  else controller.pressRoll();
});
window.addEventListener('keyup', (e) => {
  if (!isRollKey(e)) return;
  e.preventDefault();
  controller.releaseRoll();
});

applyMode();
controller.preview(hud.players());
world.idleOrbit = true;
hud.showSetup();

// Handy for debugging from the console.
window.actionLudo = { world, controller, hud, sfx, settings, setMode };
