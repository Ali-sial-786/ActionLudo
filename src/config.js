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
    blurb: 'Plummets talons-first, hauls its prey into the sky and tears it in half.',
  },
  {
    id: 'tiger',
    name: 'Tiger',
    emoji: '🐅',
    move: 'Pounce & Maul',
    verb: 'mauls',
    blurb: 'Stalks low, pounces in slow motion, crushes the throat and rakes the body open.',
  },
  {
    id: 'wolf',
    name: 'Wolf',
    emoji: '🐺',
    move: 'Pack Ambush',
    verb: 'tears apart',
    blurb: 'Howls in the pack — three sets of jaws pull the prey apart in three directions.',
  },
  {
    id: 'bear',
    name: 'Bear',
    emoji: '🐻',
    move: 'Maul & Crush',
    verb: 'crushes',
    blurb: 'Rears up, rakes with its claws, drops its full weight and rips the carcass apart.',
  },
  {
    id: 'cobra',
    name: 'Cobra',
    emoji: '🐍',
    move: 'Strike & Constrict',
    verb: 'constricts',
    blurb: 'Fangs to the neck, venom blackens the flesh, then coils crush it until it bursts.',
  },
  {
    id: 'shark',
    name: 'Shark',
    emoji: '🦈',
    move: 'Deep Strike',
    verb: 'bites through',
    blurb: 'Circles beneath a black pool, erupts jaws-first and bites the prey clean in two.',
  },
  {
    id: 'gorilla',
    name: 'Gorilla',
    emoji: '🦍',
    move: 'Pulverize',
    verb: 'pulverizes',
    blurb: 'Hoists its prey overhead, pile-drives it into the board and tears it apart by hand.',
  },
  {
    id: 'rhino',
    name: 'Rhino',
    emoji: '🦏',
    move: 'Gore & Trample',
    verb: 'impales',
    blurb: 'Charges, impales on its horn, tosses the body and stamps it into the board.',
  },
  {
    id: 'scorpion',
    name: 'Scorpion',
    emoji: '🦂',
    move: 'Death Sting',
    verb: 'stings to death',
    blurb: 'Pins the prey in its pincers and hammers the stinger home until it stops moving.',
  },
  {
    id: 'crocodile',
    name: 'Crocodile',
    emoji: '🐊',
    move: 'Death Roll',
    verb: 'death-rolls',
    blurb: 'Clamps down, spins in a blood-flinging death roll and thrashes the body apart.',
  },
];

export const animalById = (id) => ANIMALS.find((a) => a.id === id);
