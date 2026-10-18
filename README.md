# 🎲 Action Ludo

Classic Ludo in 3D — except every capture is a brutal, cinematic kill.

Each player picks a **colour** and an **animal**. Pieces move by normal Ludo rules with a fair die, but when you land on an opponent the game cuts to a kill-cam: the lights drop, letterbox bars slide in, and your animal hunts its prey in slow-motion close-ups. Blood sprays and stains the board, wounds open, heads and limbs are torn off and bodies are ripped in half. The mangled carcass is then chained and dragged back to its cage, leaving a smeared blood trail, and the cage slams shut. Roll a **6** and a golden key unlocks a cage so the animal can leap back onto the board.

> Contains graphic animal violence. Untick **Blood & gore** on the main menu for a bloodless version.

## The 10 animals

| Animal | Finishing move | What happens |
| --- | --- | --- |
| 🦅 Eagle | **Sky Shred** | Dives talons-first, carries the prey into the sky, tears at it with its beak and rips it in half |
| 🐅 Tiger | **Pounce & Maul** | Stalks low, slow-motion pounce, crushes the throat, head-shakes and claw-rakes it open |
| 🐺 Wolf | **Pack Ambush** | Howls in two more wolves; three sets of jaws pull the prey apart |
| 🐻 Bear | **Maul & Crush** | Rears up, rakes with its claws, drops its full weight and rips the carcass apart |
| 🐍 Cobra | **Strike & Constrict** | Fangs to the neck, venom blackens the flesh, coils crush bones until it bursts |
| 🦈 Shark | **Deep Strike** | Circles under a black pool, erupts jaws-first, thrashes the water red and bites it in two |
| 🦍 Gorilla | **Pulverize** | Hoists the prey overhead, pile-drives it, pounds it with both fists and tears it apart |
| 🦏 Rhino | **Gore & Trample** | Charges, impales it on its horn, tosses the body and stamps it into the board |
| 🦂 Scorpion | **Death Sting** | Pins it in its pincers, hammers the stinger home until it convulses, then rips it apart |
| 🐊 Crocodile | **Death Roll** | Clamps down, spins in a blood-flinging death roll and thrashes the body apart |

The attacker decides the kill; the victim's own anatomy is what gets torn off (an eagle loses wings, a scorpion its pincers and tail, a cobra its whole neck). Use **⚔ Battle Arena** on the main menu to watch any matchup without playing a game.

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
- **1× / 2× / 3×** changes animation speed; during a kill, **⏩ Fast-forward** (or <kbd>Space</kbd>) speeds through it and skips the slow motion. 🔊 toggles sound.

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

- **Three.js** for rendering. Everything is procedural: the board, cages, key, chains, dice and all ten animals are built in code, with fur, stripes, scales and hide painted onto canvas textures at startup. There are no model or image assets.
- Kill-cam post-processing: depth of field, a desaturated colour grade with vignette, film grain and a red impact flash, plus dramatic spot/red rim lighting during fights.
- Gore: instanced blood droplets that splat into stains, spreading pools and drag smears, wounds stuck to the body, and dismemberment where torsos are split with clipping planes to show the flesh inside.
- **WebAudio** synthesises every sound effect at runtime (roars, bone crunches, tearing flesh, chain rattles, dice clatter…).
- **Vite** for dev server and bundling.

```
src/
  game/board.js       board geometry: track, home columns, safe squares
  game/rules.js       pure Ludo rules (legal moves, captures, turns, three-sixes)
  game/ai.js          CPU move scoring
  game/controller.js  turn loop, input, movement, battle → chain → cage sequences
  render/animals.js   the 10 procedural animals with named, animatable parts
  render/textures.js  procedural fur / stripe / scale / skin / feather textures
  render/battles.js   one kill choreography (with camera shots) per animal
  render/director.js  kill-cam shot language: cuts, tracking, orbits, slow motion
  render/gore.js      blood droplets, stains, wounds, dismemberment
  render/effects.js   dust, water, sparks, shockwaves
  render/chains.js    instanced chain links along any path
  render/cage.js      cages, padlocks and the golden key
  render/dice.js      3D die with bounce-and-settle roll
  render/world.js     renderer, lights, post-processing, camera moves, screen shake
  ui/hud.js           setup screen, arena, HUD, banners
tests/rules.test.js   node:test suite for the rules and AI
```
