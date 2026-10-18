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
} from './rules.js';
import { chooseMove } from './ai.js';
import { TokenView } from '../render/token.js';
import { Cage, unlockWithKey } from '../render/cage.js';
import { BOARD_Y, finishSpot, squareWorld, yardCenter, yardSpot } from '../render/boardMesh.js';
import { ATTACKS, CAMERA_HINTS, makeContext, victimReacts } from '../render/battles.js';
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

export class GameController {
  constructor({ world, board, fx, dice, sfx, hud }) {
    this.world = world;
    this.anim = world.anim;
    this.board = board;
    this.fx = fx;
    this.dice = dice;
    this.sfx = sfx;
    this.hud = hud;
    this.views = new Map();
    this.cages = new Map();
    this.game = null;
    this.session = 0;
    this.pending = null;
    this.hovered = null;
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
  }

  buildPieces(game) {
    this.clearPieces();
    for (const player of game.players) {
      const color = COLORS[player.seat];
      for (const token of game.tokens.filter((t) => t.seat === player.seat)) {
        const view = new TokenView(token, color.hex, player.animal);
        view.player = player;
        this.world.scene.add(view.root);
        this.views.set(token.id, view);
        const cage = new Cage(this.world.scene, yardSpot(player.seat, token.index), color.hex);
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
    el.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY };
    });
    el.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 8) return;
      this.handleClick(e);
    });
    el.addEventListener('pointermove', (e) => this.handleHover(e));
  }

  pick(e) {
    const rect = this.world.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.world.camera);
    if (!this.pending) return null;
    if (this.pending.type === 'roll') {
      return this.raycaster.intersectObject(this.dice.mesh, false).length ? { roll: true } : null;
    }
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
    if (hit.roll && this.pending.type === 'roll') this.resolvePending(true);
    else if (hit.move && this.pending.type === 'move') this.resolvePending(hit.move);
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

  requestRoll() {
    if (this.pending?.type === 'roll') this.resolvePending(true);
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

  async loop(session) {
    const g = this.game;
    while (!g.over) {
      const player = currentPlayer(g);
      const color = COLORS[player.seat];
      const animal = animalById(player.animal);
      this.hud.setTurn(g, player);
      await this.dice.present(player.seat, color.hex);
      if (!this.alive(session)) return;

      if (player.cpu) {
        this.hud.setMessage(`${animal.emoji} ${player.name} is rolling…`);
        await this.anim.wait(0.45);
      } else {
        this.hud.setMessage(`${animal.emoji} ${player.name}, roll the die! <kbd>Space</kbd>`);
        await this.waitForRoll();
        this.hud.enableRoll(false);
      }
      if (!this.alive(session)) return;
      const roll = fairRoll();
      await this.dice.roll(roll);
      if (!this.alive(session)) return;
      this.hud.showRoll(roll, color.css);

      if (registerRoll(g, roll).forfeit) {
        this.sfx.play('sad');
        this.hud.toast('Three 6s in a row — turn forfeited!');
        await this.anim.wait(1.2);
        advanceTurn(g);
        continue;
      }

      const moves = legalMoves(g, player.seat, roll);
      if (!moves.length) {
        this.hud.setMessage(roll === 6 ? 'No moves — but a 6 rolls again!' : `No moves with a ${roll}.`);
        await this.anim.wait(roll === 6 ? 0.8 : 1.0);
        if (!this.alive(session)) return;
        if (roll !== 6) advanceTurn(g);
        continue;
      }

      let move;
      const distinct = distinctMoves(moves);
      if (player.cpu) {
        await this.anim.wait(0.35);
        move = chooseMove(g, moves);
      } else if (distinct.length === 1) {
        this.hud.setMessage(`Only one move — moving.`);
        move = distinct[0];
        await this.anim.wait(0.35);
      } else {
        this.hud.setMessage(`Rolled a ${roll}. Pick a glowing ${animal.name.toLowerCase()} to move.`);
        move = await this.waitForMove(moves);
      }
      if (!this.alive(session)) return;

      const result = applyMove(g, move, roll);
      await this.animateMove(move, result);
      if (!this.alive(session)) return;
      this.hud.updatePlayers(g);

      if (result.playerFinished) {
        const place = g.standings.indexOf(player.seat);
        this.sfx.play('fanfare');
        this.hud.toast(`${animal.emoji} ${player.name} finishes ${ORDINALS[place]}!`);
        await this.anim.wait(1.4);
      }
      if (g.over) break;
      if (result.bonus) {
        const why = result.captured.length ? 'Capture bonus' : result.finishedToken ? 'Made it home' : 'Rolled a 6';
        this.hud.toast(`${why} — roll again!`);
        continue;
      }
      advanceTurn(g);
    }
    if (!this.alive(session)) return;
    this.sfx.play('fanfare');
    this.hud.showGameOver(g);
  }

  // ---------------------------------------------------------------- move animations
  async animateMove(move, result) {
    const view = this.views.get(move.token.id);
    view.busy = true;
    if (move.kind === 'release') {
      await this.releaseFromCage(view);
    } else {
      const path = [];
      for (let p = move.from + 1; p <= move.to; p++) {
        path.push(p === FINISH_PROGRESS ? finishSpot(move.token.seat, move.token.index) : this.squarePos(move.token.seat, p));
      }
      if (result.captured.length) {
        const back = path.length >= 2 ? path[path.length - 2] : view.root.position.clone();
        await this.hopAlong(view, path.slice(0, -1));
        const V = path[path.length - 1];
        for (const [i, { token }] of result.captured.entries()) {
          if (i > 0) await this.hopAlong(view, [back]);
          await this.battle(view, this.views.get(token.id), V);
        }
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
    const s0 = view.root.scale.x;
    if (Math.abs(s0 - 1) > 0.01) {
      await this.anim.tween(0.12, (k) => view.root.scale.setScalar(lerp(s0, 1, k)));
    }
    for (let i = 0; i < path.length; i++) {
      const from = view.root.position.clone();
      const to = path[i];
      const r0 = view.root.rotation.y;
      const r1 = Math.atan2(to.x - from.x, to.z - from.z);
      this.sfx.play('hop', { step: i });
      await this.anim.tween(0.2, (k) => {
        view.root.position.lerpVectors(from, to, k);
        view.root.position.y = BOARD_Y + arc(k, 0.42);
        view.root.rotation.y = lerpAngle(r0, r1, Math.min(1, k * 3));
        const sq = Math.sin(k * Math.PI);
        view.model.scale.set(1 - sq * 0.06, 1 + sq * 0.1, 1 - sq * 0.06);
      });
      view.model.scale.set(1, 1, 1);
    }
    this.sfx.play('land');
    this.fx.dust(view.root.position.clone().setY(BOARD_Y + 0.03), 6);
  }

  async celebrateHome(view) {
    this.sfx.play('cheer');
    const p = view.root.position.clone().setY(BOARD_Y + 0.5);
    this.fx.sparks(p, COLORS[view.token.seat].hex, 30, 4);
    this.fx.text(p.clone().setY(BOARD_Y + 1.4), 'HOME!', { color: COLORS[view.token.seat].css, stroke: '#ffffff', size: 1 });
    await this.anim.tween(0.6, (k) => {
      view.root.position.y = BOARD_Y + arc(k, 0.8);
      view.root.rotation.y += 0.25;
    });
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
    this.sfx.play('cheer');
    await this.anim.tween(0.15, (k) => view.model.scale.set(1 + 0.1 * k, 1 - 0.25 * k, 1 + 0.1 * k));
    const camMove = this.restoreCamera(camSaved, 0.7);
    await this.anim.tween(0.6, (k) => {
      view.root.position.lerpVectors(from, start, k);
      view.root.position.y = BOARD_Y + arc(k, 1.3);
      view.root.scale.setScalar(lerp(s0, 1, k));
      view.root.rotation.y = lerpAngle(r0, r1, Math.min(1, k * 2));
      view.model.rotation.x = -Math.PI * 2 * Ease.inOutQuad(k);
      view.model.scale.set(1 - 0.1 * Math.sin(k * Math.PI), 1 + 0.15 * Math.sin(k * Math.PI), 1);
    });
    view.model.rotation.x = 0;
    view.model.scale.set(1, 1, 1);
    this.sfx.play('land');
    this.fx.dust(start.clone().setY(BOARD_Y + 0.03), 12);
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

  // Full capture sequence: cinematic camera, attack, victim torn apart, reassembled and dragged home in chains.
  async battle(atk, vic, V) {
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
    const hint = CAMERA_HINTS[atk.animal] ?? {};
    const view = this.world.battleView(A, V, hint.dist, hint.height, hint.lift);
    const atkPlayer = atk.player;
    const vicPlayer = vic.player;
    this.hud.battleBanner(atkPlayer, vicPlayer);
    await Promise.all([
      this.world.cameraTo(view.pos, view.target, 0.7),
      this.anim.tween(0.4, (k) => {
        vic.root.position.lerpVectors(v0, V, k);
        vic.root.scale.setScalar(lerp(vs0, 1, k));
        atk.root.scale.setScalar(lerp(as0, 1, k));
        atk.root.rotation.y = lerpAngle(ar0, faceA, k);
        vic.root.rotation.y = lerpAngle(vr0, faceV, k);
      }),
    ]);
    const ctx = makeContext({ world: this.world, fx: this.fx, sfx: this.sfx, atk, vic, A, V });
    await victimReacts(ctx);

    // Team bases tuck away for the fight; the attacker's reappears under it on the victim's square.
    this.anim.tween(0.2, (k) => {
      atk.base.scale.setScalar(1 - k);
      vic.base.scale.setScalar(1 - k);
    });
    await ATTACKS[atk.animal](ctx);

    // Re-root the attacker on the victim's square without a visual jump.
    const mw = new THREE.Vector3();
    atk.model.getWorldPosition(mw);
    atk.root.position.set(V.x, BOARD_Y, V.z);
    atk.model.position.set(0, 0.07 + Math.max(0, mw.y - BOARD_Y - 0.07), 0);
    atk.model.rotation.set(0, 0, 0);
    atk.base.scale.setScalar(0.01);
    this.anim.tween(0.3, (k) => atk.base.scale.setScalar(k), Ease.outBack);
    vic.base.visible = false;

    // victory pose
    this.sfx.play('roar', { pitch: 1.2 });
    this.hud.battleResult(atkPlayer, vicPlayer);
    await this.anim.tween(0.45, (k) => {
      atk.model.position.y = 0.07 + arc(k, 0.35);
      atk.model.rotation.y = k * Math.PI * 2;
    });
    atk.model.rotation.y = 0;
    atk.model.position.y = 0.07;
    atk.resetPose();
    atk.idle = true;

    // the beaten animal pulls itself back together, knocked out on its side, a little beyond the square
    await this.anim.wait(0.35);
    const ko = V.clone().addScaledVector(ctx.dir, 0.62).setY(BOARD_Y + 0.17);
    vic.root.position.copy(ko);
    vic.root.rotation.set(0, faceV, Math.PI / 2);
    vic.root.scale.setScalar(1);
    vic.resetPose();
    vic.restoreMaterials();
    vic.tint(0x8f99ab, 0.5);
    this.sfx.play('whoosh', { dur: 0.6 });
    await this.fx.reassemble(vic, 0.9);
    const stopDizzy = this.fx.dizzy(vic.model, 0.45);
    this.sfx.play('sad');
    await this.anim.wait(0.35);

    await this.dragHome(vic, camSaved, stopDizzy);
    vic.busy = false;
    vic.idle = true;
    this.world.cinematic = false;
  }

  async dragHome(vic, camSaved, onArrive = () => {}) {
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
    const r0 = vic.root.rotation.y;
    const rTarget = Math.atan2(anchor.x - start.x, anchor.z - start.z) + Math.PI / 2;
    await this.anim.tween(dur, (k, raw, dt) => {
      const e = Ease.inOutQuad(k);
      vic.root.position.lerpVectors(start, end, e);
      vic.root.position.y = BOARD_Y + 0.17 + Math.abs(Math.sin(raw * dur * 14)) * 0.05 * (1 - k);
      vic.root.rotation.y = lerpAngle(r0, rTarget, Math.min(1, k * 2));
      const b = body();
      chain.setPath(arcPoints(anchor, b, 0.24 * (1 - e) + 0.05), 1, -e * dist);
      wrap.setPath(circlePoints(b, 0.26, BOARD_Y + 0.06, 18, 2.2, 0.26), 1);
      track(dt);
      if (raw - lastDust > 0.08) {
        lastDust = raw;
        this.fx.dust(b.clone().setY(BOARD_Y + 0.03), 3);
        if (Math.random() < 0.5) this.fx.sparks(b.clone().setY(BOARD_Y + 0.05), 0xffc04d, 3, 1.5);
      }
    });
    chain.dispose();
    onArrive();
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
    vic.restoreMaterials();
    vic.base.visible = true;
    vic.base.scale.setScalar(0.01);
    this.anim.tween(0.25, (k) => vic.base.scale.setScalar(k), Ease.outBack);
    await cage.close(this.anim, this.sfx, this.fx);
    await this.anim.wait(0.25);
    await this.restoreCamera(camSaved, 0.8);
  }

  // ---------------------------------------------------------------- arena (watch any matchup)
  async arena({ attacker, victim, attackerSeat = 0, victimSeat = 3 }) {
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
    await this.animateMove(move, result);
    if (!this.alive(session)) return;
    return true;
  }
}
