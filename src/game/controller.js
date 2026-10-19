import * as THREE from 'three';
import { COLORS, animalById } from '../config.js';
import { FINISH_PROGRESS, START_INDEX, TRACK_LENGTH, squareKey } from './board.js';
import {
  advanceTurn,
  applyMove,
  createGame,
  currentPlayer,
  distinctMoves,
  fairRoll,
  legalMoves,
  registerRoll,
  resolveDuel,
} from './rules.js';
import { chooseMove } from './ai.js';
import { Duel } from './duel.js';
import { DuelUI } from '../ui/duelUI.js';
import { TokenView } from '../render/token.js';
import { Cage, unlockWithKey } from '../render/cage.js';
import { BOARD_Y, finishSpot, squareWorld, yardCenter, yardSpot } from '../render/boardMesh.js';
import { TRAY } from '../render/diceTray.js';
import { ATTACKS, makeContext, victimReacts } from '../render/battles.js';
import { KID_ATTACKS, kidFloatHome, kidVictimReacts } from '../render/battlesKid.js';
import { isKids, settings } from '../settings.js';
import { Director } from '../render/director.js';
import { BULK } from '../render/animals.js';
import { Gore } from '../render/gore.js';
import { Chain, arcPoints, circlePoints } from '../render/chains.js';
import { Ease, arc, clamp, lerp } from '../engine/anim.js';

const STACK_OFFSETS = {
  1: [[0, 0]],
  2: [[-0.2, -0.2], [0.2, 0.2]],
  3: [[-0.2, -0.18], [0.2, -0.18], [0, 0.2]],
  4: [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]],
};
const STACK_SCALE = { 1: 1, 2: 0.74, 3: 0.64, 4: 0.6 };
const YARD_SCALE = 0.86;
const FINISH_SCALE = 0.6;

function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

const ORDINALS = ['1st', '2nd', '3rd', '4th'];
// Kids-mode confetti / sparkle colours.
const CANDY = [0xff6b8b, 0xffb84d, 0xffe066, 0x6fdc8c, 0x5ec8ff, 0xb49bff, 0xffffff];

// Player-facing copy, Action vs Kids mode.
const COPY = {
  action: {
    rolling: (who) => `${who} is rolling…`,
    yourRoll: (who) => `${who}, grab the die and fling it! <kbd>Space</kbd>`,
    forfeit: 'Three 6s in a row — turn forfeited!',
    noMovesSix: 'No moves — but a 6 rolls again!',
    noMoves: (roll) => `No moves with a ${roll}.`,
    onlyMove: 'Only one move — moving.',
    pick: (roll, animal) => `Rolled a ${roll}. Pick a glowing ${animal} to move.`,
    finished: (who, place) => `${who} finishes ${place}!`,
    bonus: (why) => `${why === 'capture' ? 'Capture bonus' : why === 'home' ? 'Made it home' : 'Rolled a 6'} — roll again!`,
    spared: (who) => `${who} survives — the two share the square.`,
  },
  kids: {
    rolling: (who) => `${who} is rolling…`,
    yourRoll: (who) => `${who}, grab the die and toss it! 🎲`,
    forfeit: 'Oopsie! Three 6s in a row — turn skipped!',
    noMovesSix: 'No hops this time — but a 6 rolls again!',
    noMoves: (roll) => `No hops with a ${roll} — next friend's turn!`,
    onlyMove: 'Only one way to go — hop hop!',
    pick: (roll, animal) => `You rolled a ${roll}! Tap a bouncing ${animal} to hop.`,
    finished: (who, place) => `${who} got everyone home — ${place} place! 🎉`,
    bonus: (why) => (why === 'capture' ? 'Bonus roll for the bonk — go again! 🎲' : why === 'home' ? 'Home sweet home — roll again! 🏡' : 'A six! Roll again! 🎲'),
    spared: (who) => `${who} wiggled free — now they share the square! 🤝`,
  },
};
const copy = () => (isKids() ? COPY.kids : COPY.action);

export class GameController {
  constructor({ world, board, fx, dice, sfx, hud }) {
    this.world = world;
    this.anim = world.anim;
    this.board = board;
    this.fx = fx;
    this.dice = dice;
    this.sfx = sfx;
    this.hud = hud;
    this.gore = new Gore(world, fx);
    this.director = new Director(world);
    this.views = new Map();
    this.cages = new Map();
    this.game = null;
    this.session = 0;
    this.pending = null;
    this.hovered = null;
    this.duelUI = new DuelUI();
    this.activeDuel = null;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.setupInput();
    world.onFrame((dt, time) => {
      for (const v of this.views.values()) v.update(dt, time);
      board.update(dt, time);
    });
  }

  // ---------------------------------------------------------------- pieces
  clearPieces() {
    for (const v of this.views.values()) this.world.scene.remove(v.root);
    for (const c of this.cages.values()) c.dispose();
    this.views.clear();
    this.cages.clear();
    this.fx.clear();
    this.gore.clear();
  }

  buildPieces(game) {
    this.clearPieces();
    this.dice.setSeats(game.players.map((p) => p.seat));
    for (const player of game.players) {
      const color = COLORS[player.seat];
      for (const token of game.tokens.filter((t) => t.seat === player.seat)) {
        const view = new TokenView(token, color.hex, player.animal, settings.mode);
        view.player = player;
        this.world.scene.add(view.root);
        this.views.set(token.id, view);
        const cage = new Cage(this.world.scene, yardSpot(player.seat, token.index), color.hex, settings.mode);
        cage.setClosed(token.progress < 0);
        this.cages.set(token.id, cage);
      }
    }
    this.relayout(0);
  }

  // Show the chosen line-up in the yards while the setup screen is open.
  preview(players) {
    this.abort();
    this.dice.hide();
    this.game = createGame(players);
    this.buildPieces(this.game);
  }

  // ---------------------------------------------------------------- layout
  squarePos(seat, progress) {
    return squareWorld(seat, progress, new THREE.Vector3());
  }

  facingFor(token) {
    if (token.progress < 0) return 0;
    if (token.progress >= FINISH_PROGRESS) {
      const p = finishSpot(token.seat, token.index);
      return Math.atan2(-p.x, -p.z);
    }
    const here = this.squarePos(token.seat, token.progress);
    const next = this.squarePos(token.seat, token.progress + 1);
    return Math.atan2(next.x - here.x, next.z - here.z);
  }

  targetFor(token) {
    if (token.progress < 0) return { pos: yardSpot(token.seat, token.index), scale: YARD_SCALE, rot: 0 };
    if (token.progress >= FINISH_PROGRESS) {
      return { pos: finishSpot(token.seat, token.index), scale: FINISH_SCALE, rot: this.facingFor(token) };
    }
    const key = squareKey(token.seat, token.progress);
    const group = this.game.tokens.filter((t) => t.progress >= 0 && t.progress < FINISH_PROGRESS && squareKey(t.seat, t.progress) === key);
    group.sort((a, b) => (a.id < b.id ? -1 : 1));
    const n = Math.min(4, group.length);
    const i = Math.min(3, group.indexOf(token));
    const [ox, oz] = STACK_OFFSETS[n][i % n];
    const pos = this.squarePos(token.seat, token.progress);
    pos.x += ox;
    pos.z += oz;
    return { pos, scale: STACK_SCALE[n], rot: this.facingFor(token) };
  }

  relayout(duration = 0.3, skip = null) {
    const jobs = [];
    for (const v of this.views.values()) {
      if (v === skip || v.busy) continue;
      const t = this.targetFor(v.token);
      if (duration <= 0) {
        v.root.position.copy(t.pos);
        v.root.scale.setScalar(t.scale);
        v.root.rotation.set(0, t.rot, 0);
        continue;
      }
      const p0 = v.root.position.clone();
      const s0 = v.root.scale.x;
      const r0 = v.root.rotation.y;
      if (p0.distanceToSquared(t.pos) < 1e-6 && Math.abs(s0 - t.scale) < 1e-3 && Math.abs(r0 - t.rot) < 1e-3) continue;
      jobs.push(
        this.anim.tween(duration, (k) => {
          v.root.position.lerpVectors(p0, t.pos, k);
          v.root.scale.setScalar(lerp(s0, t.scale, k));
          v.root.rotation.y = lerpAngle(r0, t.rot, k);
        }, Ease.outCubic),
      );
    }
    return Promise.all(jobs);
  }

  // ---------------------------------------------------------------- input
  setupInput() {
    const el = this.world.renderer.domElement;
    let down = null;
    // While a roll is pending, pressing anywhere picks the die up; it follows the pointer over the
    // tray while held, and letting go throws it (a flick throws it the way it was flung).
    this.rollPointer = null;
    const letGo = (e) => {
      if (this.rollPointer !== e.pointerId) return false;
      this.rollPointer = null;
      down = null;
      this.throwDie();
      return true;
    };
    el.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY };
      if (this.pending?.type === 'roll' && this.rollPointer === null) {
        this.sfx.unlock();
        this.rollPointer = e.pointerId;
        el.setPointerCapture?.(e.pointerId);
        this.dice.grab();
        this.aimDie(e);
      }
    });
    el.addEventListener('pointercancel', letGo);
    el.addEventListener('pointerup', (e) => {
      if (letGo(e)) return;
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 8) return;
      this.handleClick(e);
    });
    el.addEventListener('pointermove', (e) => {
      if (this.rollPointer === e.pointerId) this.aimDie(e);
      else this.handleHover(e);
    });
  }

  aimDie(e) {
    const rect = this.world.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.world.camera);
    const point = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.dice.holdPlane, point)) this.dice.aim(point);
  }

  throwDie() {
    if (this.pending?.type !== 'roll' || !this.dice.held) return;
    this.resolvePending(this.dice.release());
  }

  pick(e) {
    const rect = this.world.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.world.camera);
    if (!this.pending) return null;
    if (this.pending.type === 'roll') return null;
    const targets = [];
    for (const m of this.pending.moves) {
      const v = this.views.get(m.token.id);
      targets.push(v.root);
      if (m.kind === 'release') targets.push(this.cages.get(m.token.id).group);
    }
    const hits = this.raycaster.intersectObjects(targets, true);
    for (const h of hits) {
      let o = h.object;
      while (o) {
        const move = this.pending.moves.find((m) => this.views.get(m.token.id).root === o || this.cages.get(m.token.id).group === o);
        if (move) return { move };
        o = o.parent;
      }
    }
    // Fall back to the nearest movable token around the clicked board point (helps on small screens).
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BOARD_Y);
    const pt = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(plane, pt)) {
      let best = null;
      let bestD = 0.55;
      for (const m of this.pending.moves) {
        const d = this.views.get(m.token.id).root.position.distanceTo(pt);
        if (d < bestD) {
          bestD = d;
          best = m;
        }
      }
      if (best) return { move: best };
    }
    return null;
  }

  handleClick(e) {
    this.sfx.unlock();
    const hit = this.pick(e);
    if (!hit || !this.pending) return;
    if (hit.move && this.pending.type === 'move') this.resolvePending(hit.move);
  }

  handleHover(e) {
    if (e.pointerType === 'touch') return;
    const hit = this.pick(e);
    const el = this.world.renderer.domElement;
    el.style.cursor = hit ? 'pointer' : '';
    const move = hit?.move ?? null;
    if (move === this.hovered) return;
    if (this.hovered) this.views.get(this.hovered.token.id).hoverBoost = 0;
    this.hovered = move;
    if (move) {
      this.views.get(move.token.id).hoverBoost = 1;
      this.board.showDestination(this.squarePos(move.token.seat, move.to), COLORS[move.token.seat].hex);
    } else {
      this.board.showDestination(null);
    }
  }

  resolvePending(value) {
    const p = this.pending;
    this.pending = null;
    this.hovered = null;
    this.board.showDestination(null);
    this.world.renderer.domElement.style.cursor = '';
    for (const v of this.views.values()) {
      v.setSelectable(false);
      v.hoverBoost = 0;
    }
    p?.resolve(value);
  }

  waitForRoll() {
    return new Promise((resolve) => {
      this.pending = { type: 'roll', resolve };
      this.hud.enableRoll(true);
    });
  }

  // Space / Enter / the Roll button: press and hold to shake, release to throw. A plain click
  // (requestRoll) is a quick toss.
  pressRoll() {
    if (this.pending?.type !== 'roll' || this.dice.held) return;
    this.dice.grab();
  }

  releaseRoll() {
    if (this.rollPointer === null) this.throwDie();
  }

  requestRoll() {
    if (this.pending?.type !== 'roll') return;
    this.dice.grab();
    this.throwDie();
  }

  waitForMove(moves) {
    return new Promise((resolve) => {
      this.pending = { type: 'move', moves, resolve };
      for (const m of moves) this.views.get(m.token.id).setSelectable(true);
    });
  }

  // ---------------------------------------------------------------- game flow
  abort() {
    this.session++;
    this.pending = null;
    this.anim.reset();
    this.world.cinematic = false;
    this.world.directed = false;
    this.diceCamReturn = null;
    this.rollPointer = null;
    this.dice.drop();
    this.activeDuel?.cancel();
    this.activeDuel = null;
    this.duelUI.close();
    this.world.slow.hold = 0;
    this.anim.slow = 1;
    this.world.setCinematicLook(false);
    this.world.setFov(this.world.baseFov);
    this.hud.enableRoll(false);
    this.board.showDestination(null);
  }

  async start(players) {
    this.abort();
    const session = this.session;
    this.game = createGame(players);
    this.buildPieces(this.game);
    this.world.idleOrbit = false;
    this.hud.showGame(this.game);
    await this.world.resetView(1.0);
    if (session !== this.session) return;
    this.loop(session);
  }

  alive(session) {
    return session === this.session;
  }

  // The dice cam: swoop over to the player's tray, let them grab, shake and fling the die (CPU
  // players just toss it), follow the tumble and push in on the result. The camera stays there
  // until leaveDiceCam(), so a roll with no moves can go straight on to the next player's tray.
  async rollDie(player, message, session) {
    const { world, dice } = this;
    const color = COLORS[player.seat];
    this.diceCamReturn ??= this.saveCamera();
    world.directed = true;
    const tray = dice.trayCenter(player.seat).setY(TRAY.floor + 0.3);
    const shot = world.frameView(tray, 2.4, 38);
    this.hud.setMessage(message);
    await Promise.all([dice.present(player.seat, color.hex), world.cameraTo(shot.pos, shot.target, player.cpu ? 0.6 : 0.7)]);
    if (!this.alive(session)) return null;
    let spec;
    if (player.cpu) {
      spec = await dice.autoThrow();
    } else {
      spec = await this.waitForRoll();
      this.hud.enableRoll(false);
    }
    if (!this.alive(session)) return null;
    // The number is drawn only now, as the die leaves the hand, and nothing about the throw can
    // change it: the tumble is fitted to the number, never the other way round.
    const roll = fairRoll();
    const follow = this.anim.every((dt) => world.follow(world.frameView(dice.mesh.position.clone().setY(TRAY.floor + 0.25), 1.8, 36), dt, 3.5));
    await dice.throw(roll, spec);
    follow();
    if (!this.alive(session)) return null;
    const close = world.frameView(dice.mesh.position.clone(), 0.95, 58);
    const push = world.cameraTo(close.pos, close.target, 0.4, Ease.outCubic);
    dice.celebrate(roll, color.hex);
    this.hud.showRoll(roll, color.css);
    await push;
    await this.anim.wait(player.cpu ? 0.25 : 0.45);
    return roll;
  }

  async leaveDiceCam(duration = 0.6) {
    const saved = this.diceCamReturn;
    if (!saved) return;
    await this.restoreCamera(saved, duration);
    this.diceCamReturn = null;
    this.world.directed = false;
  }

  async loop(session) {
    const g = this.game;
    const text = copy();
    const kids = isKids();
    while (!g.over) {
      const player = currentPlayer(g);
      const animal = animalById(player.animal);
      const who = `${animal.emoji} ${player.name}`;
      this.hud.setTurn(g, player);
      const roll = await this.rollDie(player, player.cpu ? text.rolling(who) : text.yourRoll(who), session);
      if (roll === null || !this.alive(session)) return;

      if (registerRoll(g, roll).forfeit) {
        this.sfx.play('sad');
        this.hud.toast(text.forfeit);
        await this.anim.wait(1.2);
        advanceTurn(g);
        continue;
      }

      const moves = legalMoves(g, player.seat, roll);
      if (!moves.length) {
        this.hud.setMessage(roll === 6 ? text.noMovesSix : text.noMoves(roll));
        await this.anim.wait(roll === 6 ? 0.8 : 1.0);
        if (!this.alive(session)) return;
        if (roll !== 6) advanceTurn(g);
        continue;
      }

      // there's a move to make: back to the board
      await this.leaveDiceCam(player.cpu ? 0.5 : 0.6);
      if (!this.alive(session)) return;
      let move;
      const distinct = distinctMoves(moves);
      if (player.cpu) {
        await this.anim.wait(0.35);
        move = chooseMove(g, moves);
      } else if (distinct.length === 1) {
        this.hud.setMessage(text.onlyMove);
        move = distinct[0];
        await this.anim.wait(0.35);
      } else {
        this.hud.setMessage(text.pick(roll, animal.name.toLowerCase()));
        move = await this.waitForMove(moves);
      }
      if (!this.alive(session)) return;

      const result = applyMove(g, move, roll);
      await this.animateMove(move, result);
      if (!this.alive(session)) return;
      this.hud.updatePlayers(g);

      if (result.playerFinished) {
        const place = g.standings.indexOf(player.seat);
        this.sfx.play(kids ? 'tada' : 'fanfare');
        if (kids) this.sfx.play('yay');
        this.hud.toast(text.finished(who, ORDINALS[place]));
        await this.anim.wait(1.4);
      }
      if (g.over) break;
      if (result.bonus) {
        this.hud.toast(text.bonus(result.captured.length ? 'capture' : result.finishedToken ? 'home' : 'six'));
        continue;
      }
      advanceTurn(g);
    }
    if (!this.alive(session)) return;
    this.sfx.play('fanfare');
    if (kids) this.sfx.play('yay');
    this.hud.showGameOver(g);
  }

  // ---------------------------------------------------------------- move animations
  // `duel: false` skips the clash mini-game (the arena showcase always ends in a kill).
  async animateMove(move, result, { duel = true } = {}) {
    const view = this.views.get(move.token.id);
    view.busy = true;
    view.clearWounds(); // last kill's blood washes off when it moves on
    if (move.kind === 'release') {
      await this.releaseFromCage(view);
    } else {
      const path = [];
      for (let p = move.from + 1; p <= move.to; p++) {
        path.push(p === FINISH_PROGRESS ? finishSpot(move.token.seat, move.token.index) : this.squarePos(move.token.seat, p));
      }
      if (result.duel) {
        await this.hopAlong(view, path.slice(0, -1));
        const V = path[path.length - 1];
        await this.battle(view, this.views.get(result.duel.id), V, (won) => resolveDuel(this.game, result, won), { duel });
      } else {
        await this.hopAlong(view, path);
      }
      if (move.kind === 'finish') await this.celebrateHome(view);
    }
    view.busy = false;
    await this.relayout(0.3);
  }

  async hopAlong(view, path) {
    if (!path.length) return;
    const kids = isKids();
    const s0 = view.root.scale.x;
    if (Math.abs(s0 - 1) > 0.01) {
      await this.anim.tween(0.12, (k) => view.root.scale.setScalar(lerp(s0, 1, k)));
    }
    // Squash & stretch: a toy-like bounce in Kids mode, a subtler spring in Action.
    const amt = kids ? 1 : 0.5;
    const height = kids ? 0.42 : 0.32;
    const crouch = 1 - 0.14 * amt;
    const stretch = 1 + 0.12 * amt;

    // anticipation: a quick crouch while turning to face the first square
    const r0 = view.root.rotation.y;
    const r1 = Math.atan2(path[0].x - view.root.position.x, path[0].z - view.root.position.z);
    await this.anim.tween(0.09, (k) => {
      view.root.rotation.y = lerpAngle(r0, r1, Ease.outCubic(k));
      view.hopPose(lerp(1, crouch, Ease.outQuad(k)), 0.1 * k, 0);
    });

    for (let i = 0; i < path.length; i++) {
      const from = view.root.position.clone();
      const to = path[i];
      const ra = view.root.rotation.y;
      const rb = Math.atan2(to.x - from.x, to.z - from.z);
      const turn = ((rb - ra + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      this.sfx.play('hop', { step: i });
      await this.anim.tween(0.2, (k) => {
        // each hop launches and settles (eased), so the squares read as separate steps
        view.root.position.lerpVectors(from, to, Ease.inOutSine(k));
        view.root.position.y = BOARD_Y + arc(k, height);
        view.root.rotation.y = lerpAngle(ra, rb, Math.min(1, k * 4));
        // spring out of the crouch, stretch while moving fast, squash again on touchdown
        let sy = 1 + (stretch - 1) * Math.abs(1 - 2 * k);
        if (k < 0.15) sy = lerp(crouch, sy, k / 0.15);
        else if (k > 0.88) sy = lerp(sy, crouch, (k - 0.88) / 0.12);
        // nose up on take-off, down for the landing; lean into the track's corners
        view.hopPose(sy, Math.sin(k * Math.PI * 2) * -0.18, -turn * 0.35 * Math.sin(k * Math.PI));
      });
    }

    // touchdown: dust, then spring back up out of the squash
    if (kids) this.sfx.play('boing');
    else this.sfx.play('land');
    this.fx.dust(view.root.position.clone().setY(BOARD_Y + 0.03), 6, kids ? 0xfff4e0 : undefined);
    await this.anim.tween(kids ? 0.24 : 0.16, (k) => {
      view.hopPose(1 - (1 - crouch) * Math.cos(k * Math.PI * 2.5) * (1 - k), 0, 0);
    });
    view.clearHopPose();
  }

  // A burst of fluttering paper confetti (Kids mode).
  confetti(pos, count = 30) {
    this.fx.burst(pos, { count, colors: CANDY, shape: 'feather', speed: 2.6, up: 3.2, size: [0.025, 0.045], life: [1.4, 2.2] });
  }

  // Kids-mode happy dance: two bouncy hops with a twirl and a wiggle.
  async happyDance(view, duration = 0.9) {
    view.resetPose();
    const head = view.parts.head;
    const ry0 = view.model.rotation.y;
    await this.anim.tween(duration, (k) => {
      view.model.position.y = 0.07 + arc((k * 2) % 1, 0.24);
      view.model.rotation.y = ry0 + Ease.inOutCubic(k) * Math.PI * 2;
      view.model.rotation.z = Math.sin(k * Math.PI * 4) * 0.14;
      if (head) head.rotation.z = Math.sin(k * Math.PI * 6) * 0.25;
      if (view.parts.setWings) view.parts.setWings(Math.sin(k * Math.PI), 0.4 * Math.sin(k * Math.PI * 6));
      if (view.parts.tail?.rotation) view.parts.tail.rotation.y = Math.sin(k * Math.PI * 8) * 0.5;
    });
    view.resetPose();
  }

  async celebrateHome(view) {
    const p = view.root.position.clone();
    if (isKids()) {
      this.sfx.play('tada');
      this.sfx.play('cheer');
      this.fx.ring(p, { color: COLORS[view.token.seat].hex, from: 0.2, to: 1.4, duration: 0.8, opacity: 0.8 });
      this.confetti(p.clone().setY(BOARD_Y + 0.5), 34);
      await this.happyDance(view, 0.8);
      return;
    }
    this.sfx.play('roar', { pitch: 1.1 });
    this.sfx.play('cheer');
    this.fx.ring(p, { color: COLORS[view.token.seat].hex, from: 0.2, to: 1.4, duration: 0.8, opacity: 0.8 });
    this.fx.sparks(p.clone().setY(BOARD_Y + 0.4), 0xffd24a, 20, 2.5);
    const head = view.parts.head;
    await this.anim.tween(0.7, (k) => {
      const s = Math.sin(k * Math.PI);
      if (head) head.rotation.x = -0.6 * s;
      if (view.parts.jaw) view.parts.jaw.rotation.x = 0.6 * s;
      view.model.position.y = 0.07 + 0.08 * s;
    });
    view.resetPose();
  }

  async releaseFromCage(view) {
    const { token } = view;
    const cage = this.cages.get(token.id);
    const camSaved = this.saveCamera();
    const yc = yardCenter(token.seat);
    this.world.cinematic = true;
    const spot = yardSpot(token.seat, token.index);
    const focus = spot.clone().lerp(yc, 0.3).setY(BOARD_Y + 0.6);
    const close = this.world.frameView(focus, 1.7, 34);
    await this.world.cameraTo(close.pos, close.target, 0.6);
    await unlockWithKey({
      cage,
      anim: this.anim,
      scene: this.world.transient,
      fx: this.fx,
      sfx: this.sfx,
      from: spot.clone().lerp(yc, 0.6).setY(BOARD_Y + 1.6),
    });
    // leap out onto the start square
    const start = this.squarePos(token.seat, 0);
    const from = view.root.position.clone();
    const s0 = view.root.scale.x;
    const r0 = view.root.rotation.y;
    const r1 = Math.atan2(start.x - from.x, start.z - from.z);
    const kids = isKids();
    this.sfx.play(kids ? 'yay' : 'roar', { pitch: 1.2 });
    await this.anim.tween(0.25, (k) => {
      view.root.rotation.y = lerpAngle(r0, r1, k);
      view.model.position.y = 0.07 - 0.05 * k;
      view.model.rotation.x = 0.15 * k;
    });
    const camMove = this.restoreCamera(camSaved, 0.7);
    await this.anim.tween(0.55, (k) => {
      view.root.position.lerpVectors(from, start, k);
      view.root.position.y = BOARD_Y + arc(k, 1.0);
      view.root.scale.setScalar(lerp(s0, 1, k));
      view.root.rotation.y = r1;
      view.model.position.y = 0.07 - 0.05 * (1 - Math.min(1, k * 4));
      view.model.rotation.x = lerp(-0.35, 0.25, k);
    });
    view.model.rotation.x = 0;
    view.model.position.y = 0.07;
    if (kids) {
      this.sfx.play('boing');
      this.fx.dust(start.clone().setY(BOARD_Y + 0.03), 10, 0xfff4e0);
      this.confetti(start.clone().setY(BOARD_Y + 0.35), 18);
    } else {
      this.sfx.play('land');
      this.fx.dust(start.clone().setY(BOARD_Y + 0.03), 12);
    }
    this.fx.sparks(start.clone().setY(BOARD_Y + 0.3), COLORS[token.seat].hex, 14, 2.5);
    await camMove;
    this.world.cinematic = false;
  }

  saveCamera() {
    return { pos: this.world.camera.position.clone(), target: this.world.controls.target.clone() };
  }

  restoreCamera(saved, duration = 0.8) {
    return this.world.cameraTo(saved.pos, saved.target, duration);
  }

  // Full capture sequence: cinematic kill, the carcass is pulled together and dragged home in chains.
  // `decide(attackerWins)` is called once the clash is settled (before any kill is shown).
  async battle(atk, vic, V, decide = () => {}, { duel = true } = {}) {
    const A = atk.root.position.clone().setY(BOARD_Y);
    const camSaved = this.saveCamera();
    vic.busy = true;
    for (const v of [atk, vic]) {
      v.idle = false;
      v.resetPose();
      v.setSelectable(false);
    }
    // victim steps to the centre of its square, both face off
    const v0 = vic.root.position.clone();
    const vs0 = vic.root.scale.x;
    const faceA = Math.atan2(V.x - A.x, V.z - A.z);
    const faceV = Math.atan2(A.x - V.x, A.z - V.z);
    const ar0 = atk.root.rotation.y;
    const vr0 = vic.root.rotation.y;
    const as0 = atk.root.scale.x;

    this.world.cinematic = true;
    const D = this.director;
    const kids = isKids();
    D.begin(A, V, Math.max(BULK[atk.animal] ?? 1, BULK[vic.animal] ?? 1), kids ? 'kids' : 'action');
    const atkPlayer = atk.player;
    const vicPlayer = vic.player;
    if (!duel) this.hud.battleBanner(atkPlayer, vicPlayer);
    if (!kids) this.sfx.play('heartbeat');
    await Promise.all([
      D.move({ at: D.at('mid'), yaw: 12, pitch: 20, dist: 3.2, lift: 0.3, fov: 38 }, 0.8),
      this.anim.tween(0.4, (k) => {
        vic.root.position.lerpVectors(v0, V, k);
        vic.root.scale.setScalar(lerp(vs0, 1, k));
        atk.root.scale.setScalar(lerp(as0, 1, k));
        atk.root.rotation.y = lerpAngle(ar0, faceA, k);
        vic.root.rotation.y = lerpAngle(vr0, faceV, k);
      }),
    ]);
    const session = this.session;
    const attackerWins = duel ? await this.clash(atk, vic, A, V, kids) : true;
    if (!this.alive(session)) return;
    decide(attackerWins);
    if (!attackerWins) {
      await this.repel(atk, vic, A, V, camSaved);
      return;
    }
    let titled = false;
    const ctx = makeContext({
      world: this.world,
      fx: this.fx,
      gore: this.gore,
      sfx: this.sfx,
      atk,
      vic,
      A,
      V,
      director: D,
      onKill: () => {
        titled = true;
        this.hud.killTitle(atkPlayer, vicPlayer);
      },
    });
    // team bases tuck away for the fight; the attacker's reappears under it on the victim's square
    this.anim.tween(0.2, (k) => {
      atk.base.scale.setScalar(1 - k);
      vic.base.scale.setScalar(1 - k);
    });
    await (kids ? kidVictimReacts : victimReacts)(ctx);
    await (kids ? KID_ATTACKS : ATTACKS)[atk.animal](ctx);
    // every kids romp gets its title card, even if the choreography never called onKill
    if (kids && !titled) ctx.onKill();

    // Re-root the attacker on the victim's square without a visual jump.
    const mw = new THREE.Vector3();
    atk.model.getWorldPosition(mw);
    atk.root.position.set(V.x, BOARD_Y, V.z);
    atk.model.position.set(0, 0.07 + Math.max(0, mw.y - BOARD_Y - 0.07), 0);
    atk.model.rotation.set(0, 0, 0);
    atk.base.scale.setScalar(0.01);
    this.anim.tween(0.3, (k) => atk.base.scale.setScalar(k), Ease.outBack);
    vic.base.visible = false;

    if (kids) {
      await this.kidAftermath(atk, vic, V, camSaved);
      D.end();
      vic.busy = false;
      vic.idle = true;
      this.world.cinematic = false;
      return;
    }

    // the victor stands over the remains and roars
    D.cut({ at: V, yaw: 25, pitch: 6, dist: 1.6, lift: 0.4, fov: 34 });
    this.sfx.play('roar', { pitch: 0.9 });
    atk.resetPose();
    const head = atk.parts.head;
    await this.anim.tween(0.9, (k) => {
      const s = Math.sin(k * Math.PI);
      if (head) head.rotation.x = -0.55 * s;
      if (atk.parts.jaw) atk.parts.jaw.rotation.x = 0.75 * s;
      if (atk.parts.setWings) atk.parts.setWings(s, 0.2 * s);
      if (atk.parts.hood) atk.parts.hood.scale.set(1 + 0.5 * s, 1 + 0.2 * s, 1);
    });
    atk.resetPose();
    atk.idle = true;

    // the remains are dragged together into a mangled carcass, a little beyond the square
    const ko = V.clone().addScaledVector(ctx.dir, 0.62).setY(BOARD_Y + 0.17);
    vic.root.position.copy(ko);
    vic.root.rotation.set(0, faceV, Math.PI / 2);
    vic.root.scale.setScalar(1);
    vic.resetPose();
    D.move({ at: ko.clone().setY(BOARD_Y), yaw: 55, pitch: 24, dist: 1.9, lift: 0.15, fov: 34 }, 0.8);
    this.sfx.play('squelch');
    await this.gore.gather(vic, 1.0, 0.35);
    vic.tint(this.gore.on ? 0x4a0508 : 0x6a7280, 0.4);
    this.gore.pool(ko.clone(), 0.75, 2.5);
    await this.anim.wait(0.35);

    await this.dragHome(vic, camSaved);
    D.end();
    vic.busy = false;
    vic.idle = true;
    this.world.cinematic = false;
  }

  // The clash mini-game before a kill. Resolves true if the attacker wins, with both animals back
  // on their marks for the kill.
  async clash(atk, vic, A, V, kids) {
    const side = (view) => ({ view, player: view.player, color: COLORS[view.token.seat], animal: animalById(view.animal) });
    const duel = (this.activeDuel = new Duel({ world: this.world, sfx: this.sfx, fx: this.fx, ui: this.duelUI, a: side(atk), b: side(vic), A, V, kids }));
    const attackerWins = await duel.run();
    this.activeDuel = null;
    this.duelUI.result(attackerWins);
    this.sfx.play(kids ? 'yay' : attackerWins ? 'roar' : 'thud', { power: 0.8 });
    await this.anim.wait(1.0);
    this.duelUI.fadeOut();
    if (attackerWins) {
      const a0 = atk.root.position.clone();
      const v0 = vic.root.position.clone();
      await this.anim.tween(0.25, (k) => {
        atk.root.position.lerpVectors(a0, A, k);
        vic.root.position.lerpVectors(v0, V, k);
      }, Ease.inOutCubic);
      atk.resetPose();
      vic.resetPose();
    }
    return attackerWins;
  }

  // The defender won the clash: it throws the attacker back, then the attacker steps in and the
  // two share the square.
  async repel(atk, vic, A, V, camSaved) {
    const kids = isKids();
    const dir = V.clone().sub(A).setY(0).normalize();
    const a0 = atk.root.position.clone();
    const v0 = vic.root.position.clone();
    const back = A.clone().addScaledVector(dir, -0.15).setY(BOARD_Y);
    const lunge = v0.clone().addScaledVector(dir, -0.18);
    this.sfx.play(kids ? 'boing' : 'thud', { power: 0.8 });
    this.fx.sparks(a0.clone().lerp(v0, 0.5).setY(BOARD_Y + 0.35), kids ? 0xffe066 : 0xfff0d0, 14, 3);
    this.fx.dust(a0.clone().setY(BOARD_Y + 0.03), 8);
    this.world.shake(0.12);
    const r0 = atk.root.rotation.y;
    const spin = (Math.random() < 0.5 ? -1 : 1) * 0.7;
    await this.anim.tween(0.55, (k) => {
      const out = Math.sin(Math.min(1, k * 2) * Math.PI);
      vic.root.position.lerpVectors(v0, lunge, out);
      vic.model.rotation.x = 0.35 * out;
      atk.root.position.lerpVectors(a0, back, Ease.outCubic(k));
      atk.root.position.y = BOARD_Y + arc(k, 0.3);
      atk.root.rotation.y = r0 + spin * Math.sin(k * Math.PI);
      atk.model.rotation.x = -0.5 * Math.sin(k * Math.PI);
    });
    atk.resetPose();
    vic.resetPose();
    this.hud.toast(copy().spared(`${animalById(vic.animal).emoji} ${vic.player.name}`), 2400);
    await this.anim.wait(0.35);
    // the attacker steps in beside its rival
    const a1 = atk.root.position.clone();
    const r1 = atk.root.rotation.y;
    const r2 = Math.atan2(V.x - a1.x, V.z - a1.z);
    this.sfx.play('hop', { step: 2 });
    await this.anim.tween(0.32, (k) => {
      atk.root.position.lerpVectors(a1, V, k);
      atk.root.position.y = BOARD_Y + arc(k, 0.28);
      atk.root.rotation.y = lerpAngle(r1, r2, Math.min(1, k * 2));
    });
    this.sfx.play('land');
    atk.idle = true;
    vic.idle = true;
    vic.busy = false;
    this.director.end();
    await this.restoreCamera(camSaved, 0.7);
    this.world.cinematic = false;
  }

  // Kids mode: the winner does a happy dance in a shower of confetti, the loser floats back home
  // (camera tracking it), the cage boings shut around it and the camera returns to the board.
  async kidAftermath(atk, vic, V, camSaved) {
    const D = this.director;
    const { token } = vic;
    const cage = this.cages.get(token.id);
    const spot = yardSpot(token.seat, token.index);

    // settle the winner back onto the square if the move ended mid-air
    const y0 = atk.model.position.y;
    if (y0 > 0.08) await this.anim.tween(0.3, (k) => (atk.model.position.y = lerp(y0, 0.07, Ease.outBounce(k))));
    D.move({ at: V, yaw: 18, pitch: 16, dist: 2.1, lift: 0.35, fov: 36 }, 0.5);
    this.sfx.play('yay');
    this.confetti(V.clone().setY(BOARD_Y + 0.7), 36);
    this.fx.ring(V, { color: COLORS[atk.token.seat].hex, from: 0.2, to: 1.3, duration: 0.7, opacity: 0.7 });
    await this.happyDance(atk);
    atk.idle = true;

    // the loser floats home in a bubble (kidFloatHome keeps both it and its cage in frame)
    this.hud.toast('Bonk! Back to the cage! 🎈');
    this.fx.ring(spot, { color: COLORS[token.seat].hex, from: 0.2, to: 1.1, duration: 0.6 });
    await kidFloatHome({ world: this.world, anim: this.anim, fx: this.fx, sfx: this.sfx, vic, spot });

    // safe and sound in the yard, good as new
    vic.root.position.copy(spot);
    vic.root.rotation.set(0, 0, 0);
    vic.root.scale.setScalar(YARD_SCALE);
    vic.restoreMaterials();
    vic.resetPose();
    vic.base.visible = true;
    vic.base.scale.setScalar(0.01);
    this.anim.tween(0.25, (k) => vic.base.scale.setScalar(k), Ease.outBack);
    await cage.close(this.anim, this.sfx, this.fx);
    this.sfx.play('giggle');
    await this.anim.wait(0.2);
    await this.restoreCamera(camSaved, 0.8);
  }

  async dragHome(vic, camSaved) {
    const { token } = vic;
    const cage = this.cages.get(token.id);
    const spot = yardSpot(token.seat, token.index);
    const anchor = spot.clone().setY(BOARD_Y + 0.5);
    const scene = this.world.transient;
    const body = () => vic.root.position.clone().setY(BOARD_Y + 0.18);
    const dist = anchor.distanceTo(body());
    // Tracking shot that keeps both the cage and the captive in frame, tightening as they meet.
    const shot = () => {
      const b = body();
      const sep = b.distanceTo(spot);
      const center = b.clone().add(spot).multiplyScalar(0.5).setY(BOARD_Y + 0.3);
      return this.world.frameView(center, Math.max(1.6, sep * 0.5 + 0.9), 50);
    };
    const track = (dt) => this.world.follow(shot(), dt, 3.5);

    // a glowing portal marks the cage the chain comes from
    this.fx.ring(spot, { color: COLORS[token.seat].hex, from: 0.2, to: 1.1, duration: 0.6 });
    this.fx.sparks(anchor, 0xcfd6e0, 12, 2);

    const chain = new Chain(scene);
    const wrap = new Chain(scene, 80);
    this.sfx.play('chain', { dur: 0.7 });
    const camPose = shot();
    this.world.cameraTo(camPose.pos, camPose.target, 0.8);
    await this.anim.tween(0.8, (k) => chain.setPath(arcPoints(anchor, body(), 0.6 + dist * 0.22), Ease.outCubic(k)));
    this.sfx.play('clank');
    this.fx.sparks(body(), 0xcfd6e0, 10, 2);
    await this.anim.tween(0.45, (k, _, dt) => {
      wrap.setPath(circlePoints(body(), 0.26, BOARD_Y + 0.06, 18, 2.2, 0.26), k);
      chain.setPath(arcPoints(anchor, body(), (0.6 + dist * 0.22) * (1 - k * 0.6)), 1);
      track(dt);
    });

    // yank and drag across the board
    const start = vic.root.position.clone();
    const end = spot.clone().setY(BOARD_Y + 0.17);
    const dur = clamp(dist * 0.16, 1.1, 2.4);
    this.sfx.play('chain', { dur });
    let lastDust = 0;
    let lastSmear = null;
    const r0 = vic.root.rotation.y;
    const rTarget = Math.atan2(anchor.x - start.x, anchor.z - start.z) + Math.PI / 2;
    await this.anim.tween(dur, (k, raw, dt) => {
      const e = Ease.inOutQuad(k);
      vic.root.position.lerpVectors(start, end, e);
      vic.root.position.y = BOARD_Y + 0.17 + Math.abs(Math.sin(raw * dur * 14)) * 0.05 * (1 - k);
      vic.root.rotation.y = lerpAngle(r0, rTarget, Math.min(1, k * 2));
      const b = body();
      this.world.mood.center.copy(b);
      chain.setPath(arcPoints(anchor, b, 0.24 * (1 - e) + 0.05), 1, -e * dist);
      wrap.setPath(circlePoints(b, 0.26, BOARD_Y + 0.06, 18, 2.2, 0.26), 1);
      track(dt);
      if (raw - lastDust > 0.06) {
        lastDust = raw;
        // the carcass leaves a smeared trail of blood behind it
        if (lastSmear) this.gore.smear(lastSmear, b, 0.24);
        lastSmear = b.clone();
        if (Math.random() < 0.4) this.gore.spray(b, null, { count: 2, speed: 0.4, up: 0.1 });
        if (Math.random() < 0.3) this.fx.sparks(b.clone().setY(BOARD_Y + 0.05), 0xffc04d, 2, 1.2);
      }
    });
    chain.dispose();
    this.sfx.play('clank');
    // stand back up inside the yard and get locked in
    const p0 = vic.root.position.clone();
    const rz0 = vic.root.rotation.z;
    await this.anim.tween(0.35, (k, _, dt) => {
      vic.root.position.lerpVectors(p0, spot, k);
      vic.root.position.y = BOARD_Y + 0.17 * (1 - k) + arc(k, 0.3);
      vic.root.rotation.z = rz0 * (1 - k);
      vic.root.rotation.y = lerpAngle(rTarget, 0, k);
      vic.root.scale.setScalar(lerp(1, YARD_SCALE, k));
      wrap.setPath(circlePoints(vic.root.position.clone().setY(BOARD_Y + 0.18), 0.26, BOARD_Y + 0.06, 18, 2.2, 0.26), 1 - k);
      track(dt);
    });
    wrap.dispose();
    vic.root.rotation.set(0, 0, 0);
    const closing = cage.close(this.anim, this.sfx, this.fx);
    await this.anim.wait(0.3);
    // behind bars the animal is whole again, ready for its next release
    vic.restoreMaterials();
    vic.clearWounds();
    vic.resetPose();
    vic.base.visible = true;
    vic.base.scale.setScalar(0.01);
    this.anim.tween(0.25, (k) => vic.base.scale.setScalar(k), Ease.outBack);
    await closing;
    await this.anim.wait(0.25);
    await this.restoreCamera(camSaved, 0.8);
  }

  // ---------------------------------------------------------------- arena (watch any matchup)
  async arena({ attacker, victim, attackerSeat = 0, victimSeat = 3, duel = false }) {
    this.abort();
    const session = this.session;
    const players = [
      { seat: attackerSeat, color: COLORS[attackerSeat].id, animal: attacker, cpu: true, name: `${COLORS[attackerSeat].name} ${animalById(attacker).name}` },
      { seat: victimSeat, color: COLORS[victimSeat].id, animal: victim, cpu: true, name: `${COLORS[victimSeat].name} ${animalById(victim).name}` },
    ];
    this.game = createGame(players);
    const atkToken = this.game.tokens.find((t) => t.seat === attackerSeat && t.index === 0);
    const vicToken = this.game.tokens.find((t) => t.seat === victimSeat && t.index === 0);
    // Put the fight on a non-safe square on the far side of the victim's yard so the drag home is long.
    const victimIndex = (START_INDEX[(victimSeat + 2) % 4] + 4) % TRACK_LENGTH;
    const atkIndex = (victimIndex - 2 + TRACK_LENGTH) % TRACK_LENGTH;
    atkToken.progress = (atkIndex - START_INDEX[attackerSeat] + TRACK_LENGTH) % TRACK_LENGTH;
    vicToken.progress = (victimIndex - START_INDEX[victimSeat] + TRACK_LENGTH) % TRACK_LENGTH;
    this.buildPieces(this.game);
    this.cages.get(atkToken.id).setClosed(false);
    this.cages.get(vicToken.id).setClosed(false);
    this.world.idleOrbit = false;
    await this.world.resetView(0.8);
    await this.anim.wait(0.4);
    if (!this.alive(session)) return;
    const move = legalMoves(this.game, attackerSeat, 2).find((m) => m.token === atkToken);
    const result = applyMove(this.game, move, 2);
    await this.animateMove(move, result, { duel });
    if (!this.alive(session)) return;
    return true;
  }
}
