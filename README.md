# 🎲 Action Ludo

Classic Ludo in 3D — except every capture is an animal fight.

Each player picks a **colour** and an **animal**. Pieces move by normal Ludo rules with a fair die, but when you land on an opponent your animal attacks: the loser is torn apart, its pieces snap back together, chains shoot out from its cage and drag it back home, and the cage slams shut. Roll a **6** and a golden key flies in, unlocks a cage, and the animal leaps onto the board.

## The 10 animals

| Animal | Finishing move | What happens |
| --- | --- | --- |
| 🦅 Eagle | **Sky Shred** | Vanishes into the sky, dive-bombs, carries the prey up and tears it apart mid-air |
| 🐅 Tiger | **Pounce & Maul** | Crouch, butt-wiggle, pounce, then a flurry of glowing claw slashes |
| 🐺 Wolf | **Pack Ambush** | Howls up two ghost wolves; the pack plays tug-of-war with the prey |
| 🐻 Bear | **Pancake Slam** | Rears up to double size and body-slams the prey flat |
| 🐍 Cobra | **Coil & Venom** | Crushing coils spiral up the prey, then a toxic bite turns it green |
| 🦈 Shark | **Deep Strike** | A whirlpool opens under the prey, a fin circles… then it erupts jaws-first |
| 🦍 Gorilla | **Ground Pound** | Chest-beats, hoists the prey overhead and pile-drives it twice |
| 🦏 Rhino | **Stampede** | Paws the ground, charges and horn-launches the prey into the air |
| 🦂 Scorpion | **Death Sting** | Pins the prey in its pincers and stings until it swells and pops |
| 🐊 Crocodile | **Death Roll** | Snaps its jaws shut and spins the prey in a brutal death roll |

The attacker decides the move; the victim decides what it breaks into (feathers, fur, scales, water, shell). Every one of the 100 matchups plays out a little differently. Use **⚔ Battle Arena** on the main menu to watch any matchup without playing a game.

## Rules

- Each player has 4 animals, all starting locked in cages.
- A **6** releases an animal onto its start square (key-and-cage animation).
- Move clockwise around the 52-square track, then up your coloured home column. You need the exact roll to reach the centre.
- Landing on an opponent on a normal square captures it (battle → chains → cage).
- ⭐ Star squares and coloured start squares are **safe**; animals can share them.
- A 6, a capture, or getting an animal home earns another roll. Three 6s in a row forfeit the turn.
- First to get all four animals home wins; play continues until the final standings are decided.

The die uses `crypto.getRandomValues` with rejection sampling, so every face has exactly a 1/6 chance.

## Controls

- **Roll:** click the hovering die, press the **Roll** button, or hit <kbd>Space</kbd>.
- **Move:** click a glowing animal (hover shows where it will land).
- **Camera:** drag to orbit, scroll or pinch to zoom, 🎥 resets the view.
- **⏩ 1× / 2× / 3×** changes animation speed, 🔊 toggles sound.

Any seat can be **Human**, **CPU** or **Off** (2–4 players). Several humans can share one device and take turns.

## Running it

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # static site in dist/
npm run preview   # serve the production build
npm test          # rules / AI unit tests
```

The build uses relative paths, so `dist/` can be hosted from any static host or sub-folder (GitHub Pages, Netlify, S3…).

## How it's built

- **Three.js** for rendering. Everything is procedural: the board, cages, key, chains, dice textures and all ten animals are built from primitives in code. There are no model or image assets.
- **WebAudio** synthesises every sound effect at runtime (roars, screeches, chain rattles, dice clatter…).
- **Vite** for dev server and bundling.

```
src/
  game/board.js       board geometry: track, home columns, safe squares
  game/rules.js       pure Ludo rules (legal moves, captures, turns, three-sixes)
  game/ai.js          CPU move scoring
  game/controller.js  turn loop, input, movement, battle → chain → cage sequences
  render/animals.js   the 10 procedural animals with named, animatable parts
  render/battles.js   one attack choreography per animal
  render/effects.js   particles, shockwaves, comic text, rip-apart & reassemble
  render/chains.js    instanced chain links along any path
  render/cage.js      cages, padlocks and the golden key
  render/dice.js      3D die with bounce-and-settle roll
  render/world.js     renderer, lights, camera moves, screen shake
  ui/hud.js           setup screen, arena, HUD, banners
tests/rules.test.js   node:test suite for the rules and AI
```
