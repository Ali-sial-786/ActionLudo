import * as THREE from 'three';
import { Ease, arc, lerp } from '../engine/anim.js';
import { BOARD_Y } from './boardMesh.js';

// Kids mode: playful, bloodless "capture" battles.
//
// Contract (same ctx as battles.js / makeContext):
//   KID_ATTACKS[animal](ctx)  one choreography per attacking animal. Must not use ctx.gore.
//     End state: attacker model at local (0, 0.07, ctx.dist) (standing on the victim's square),
//     victim visible and upright near ctx.V, any material changes undone.
//   kidVictimReacts(ctx)      short reaction before the attack.
//   kidFloatHome({ world, anim, fx, sfx, vic, spot })
//     carries the defeated victim from where it is to `spot` (its yard spot, board level),
//     resolves with vic.root at spot; the controller then closes the cage.
//
// Placeholder implementations below; the full set replaces them.

async function bonk(ctx) {
  const { anim, atk, vic, dist } = ctx;
  await anim.tween(0.5, (k) => {
    atk.model.position.z = lerp(0, dist, k);
    atk.model.position.y = 0.07 + arc(k, 0.5);
  });
  ctx.sfx.play('pop');
  await anim.tween(0.5, (k) => (vic.model.rotation.y = k * Math.PI * 4), Ease.outCubic);
  vic.model.rotation.y = 0;
}

const ids = ['eagle', 'tiger', 'wolf', 'bear', 'cobra', 'shark', 'gorilla', 'rhino', 'scorpion', 'crocodile'];
export const KID_ATTACKS = Object.fromEntries(ids.map((id) => [id, bonk]));

export async function kidVictimReacts(ctx) {
  await ctx.anim.tween(0.4, (k) => (ctx.vic.model.position.y = 0.07 + arc(k, 0.2)));
}

export async function kidFloatHome({ anim, vic, spot }) {
  const from = vic.root.position.clone();
  await anim.tween(1.2, (k) => {
    vic.root.position.lerpVectors(from, spot, Ease.inOutCubic(k));
    vic.root.position.y = BOARD_Y + arc(k, 2);
  });
  vic.root.position.copy(spot).setY(BOARD_Y);
  void THREE;
}
