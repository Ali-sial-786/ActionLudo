export const COLORS = [
  { id: 'red', name: 'Red', hex: 0xe53935, css: '#e53935', seat: 0 },
  { id: 'green', name: 'Green', hex: 0x2fa84f, css: '#2fa84f', seat: 1 },
  { id: 'yellow', name: 'Yellow', hex: 0xf7c31a, css: '#f7c31a', seat: 2 },
  { id: 'blue', name: 'Blue', hex: 0x1e7be5, css: '#1e7be5', seat: 3 },
];

export const colorOfSeat = (seat) => COLORS[seat];

export const ANIMALS = [
  {
    id: 'eagle',
    name: 'Eagle',
    emoji: '🦅',
    move: 'Sky Shred',
    verb: 'shreds',
    blurb: 'Vanishes into the clouds, dive-bombs its prey and tears it apart in mid-air.',
  },
  {
    id: 'tiger',
    name: 'Tiger',
    emoji: '🐅',
    move: 'Pounce & Maul',
    verb: 'mauls',
    blurb: 'Crouches, wiggles, pounces — then a flurry of claw swipes.',
  },
  {
    id: 'wolf',
    name: 'Wolf',
    emoji: '🐺',
    move: 'Pack Ambush',
    verb: 'ambushes',
    blurb: 'Howls up a ghost pack that pins the prey down and plays tug-of-war.',
  },
  {
    id: 'bear',
    name: 'Bear',
    emoji: '🐻',
    move: 'Pancake Slam',
    verb: 'flattens',
    blurb: 'Rears up to twice its size and body-slams the prey flat.',
  },
  {
    id: 'cobra',
    name: 'Cobra',
    emoji: '🐍',
    move: 'Coil & Venom',
    verb: 'constricts',
    blurb: 'Wraps the prey in crushing coils, then delivers a toxic bite.',
  },
  {
    id: 'shark',
    name: 'Shark',
    emoji: '🦈',
    move: 'Deep Strike',
    verb: 'devours',
    blurb: 'Opens a whirlpool under the prey, circles... then erupts jaws-first.',
  },
  {
    id: 'gorilla',
    name: 'Gorilla',
    emoji: '🦍',
    move: 'Ground Pound',
    verb: 'smashes',
    blurb: 'Beats its chest, hoists the prey overhead and pile-drives it.',
  },
  {
    id: 'rhino',
    name: 'Rhino',
    emoji: '🦏',
    move: 'Stampede',
    verb: 'launches',
    blurb: 'Paws the ground, charges, and horn-launches the prey into orbit.',
  },
  {
    id: 'scorpion',
    name: 'Scorpion',
    emoji: '🦂',
    move: 'Death Sting',
    verb: 'stings',
    blurb: 'Pins the prey in its pincers and stings until it swells and pops.',
  },
  {
    id: 'crocodile',
    name: 'Crocodile',
    emoji: '🐊',
    move: 'Death Roll',
    verb: 'death-rolls',
    blurb: 'Snaps its jaws shut and spins into a brutal death roll.',
  },
];

export const animalById = (id) => ANIMALS.find((a) => a.id === id);
