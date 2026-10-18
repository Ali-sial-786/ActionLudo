import './style.css';
import { World } from './render/world.js';
import { BoardView } from './render/boardMesh.js';
import { Effects } from './render/effects.js';
import { Dice } from './render/dice.js';
import { GameController } from './game/controller.js';
import { Hud } from './ui/hud.js';
import { sfx } from './engine/audio.js';
import { goreSettings } from './render/gore.js';

const world = new World(document.getElementById('stage'));
const board = new BoardView(world.scene);
const fx = new Effects(world);
const dice = new Dice(world, fx, sfx);

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
    if (!world.cinematic) world.resetView(0.6);
  },
  onMenu: () => toMenu(),
  onGore: (on) => (goreSettings.enabled = on),
});

controller = new GameController({ world, board, fx, dice, sfx, hud });

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

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.code === 'Space' || e.code === 'Enter') {
    e.preventDefault();
    sfx.unlock();
    if (world.cinematic) startFastForward();
    else controller.requestRoll();
  }
});

controller.preview(hud.players());
world.idleOrbit = true;
hud.showSetup();

// Handy for debugging from the console.
window.actionLudo = { world, controller, hud, sfx };
