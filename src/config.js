export const COLORS = [
  { id: 'red', name: 'Red', hex: 0xe53935, css: '#e53935', seat: 0 },
  { id: 'green', name: 'Green', hex: 0x2fa84f, css: '#2fa84f', seat: 1 },
  { id: 'yellow', name: 'Yellow', hex: 0xf7c31a, css: '#f7c31a', seat: 2 },
  { id: 'blue', name: 'Blue', hex: 0x1e7be5, css: '#1e7be5', seat: 3 },
];

export const colorOfSeat = (seat) => COLORS[seat];

// move / verb / blurb describe the Action-mode kill; kidMove / kidVerb / kidBlurb the Kids-mode romp.
export const ANIMALS = [
  {
    id: 'eagle',
    name: 'Eagle',
    emoji: '🦅',
    move: 'Sky Shred',
    verb: 'shreds',
    blurb: 'Plummets talons-first, hauls its prey into the sky and tears it in half.',
    kidMove: 'Swoop & Scoop',
    kidVerb: 'scooped up',
    kidBlurb: 'Zooms down from the clouds, scoops up its pal and takes them on a loop-the-loop ride.',
  },
  {
    id: 'tiger',
    name: 'Tiger',
    emoji: '🐅',
    move: 'Pounce & Maul',
    verb: 'mauls',
    blurb: 'Stalks low, pounces in slow motion, crushes the throat and rakes the body open.',
    kidMove: 'Pounce Tickle',
    kidVerb: 'tickled',
    kidBlurb: 'Creeps up on tippy-toes, pounces, and tickles until everybody is giggling.',
  },
  {
    id: 'wolf',
    name: 'Wolf',
    emoji: '🐺',
    move: 'Pack Ambush',
    verb: 'tears apart',
    blurb: 'Howls in the pack — three sets of jaws pull the prey apart in three directions.',
    kidMove: 'Puppy Pile',
    kidVerb: 'piled on',
    kidBlurb: 'Howls for its fluffy friends, and the whole pack tumbles on for one big puppy pile.',
  },
  {
    id: 'bear',
    name: 'Bear',
    emoji: '🐻',
    move: 'Maul & Crush',
    verb: 'crushes',
    blurb: 'Rears up, rakes with its claws, drops its full weight and rips the carcass apart.',
    kidMove: 'Bear Hug',
    kidVerb: 'hugged',
    kidBlurb: 'Stands up tall, opens its arms wide and gives the biggest, squishiest hug ever.',
  },
  {
    id: 'cobra',
    name: 'Cobra',
    emoji: '🐍',
    move: 'Strike & Constrict',
    verb: 'constricts',
    blurb: 'Fangs to the neck, venom blackens the flesh, then coils crush it until it bursts.',
    kidMove: 'Twisty Twirl',
    kidVerb: 'twirled',
    kidBlurb: 'Wiggles in close, wraps around like a ribbon and spins its pal like a spinning top.',
  },
  {
    id: 'shark',
    name: 'Shark',
    emoji: '🦈',
    move: 'Deep Strike',
    verb: 'bites through',
    blurb: 'Circles beneath a black pool, erupts jaws-first and bites the prey clean in two.',
    kidMove: 'Splash Attack',
    kidVerb: 'soaked',
    kidBlurb: 'Paddles around its paddling pool, then leaps out with a giant, soaking SPLASH!',
  },
  {
    id: 'gorilla',
    name: 'Gorilla',
    emoji: '🦍',
    move: 'Pulverize',
    verb: 'pulverizes',
    blurb: 'Hoists its prey overhead, pile-drives it into the board and tears it apart by hand.',
    kidMove: 'Trampoline Thump',
    kidVerb: 'bounced',
    kidBlurb: 'Drums its chest, then thumps the board so hard its pal bounces sky-high. Boing!',
  },
  {
    id: 'rhino',
    name: 'Rhino',
    emoji: '🦏',
    move: 'Gore & Trample',
    verb: 'impales',
    blurb: 'Charges, impales on its horn, tosses the body and stamps it into the board.',
    kidMove: 'Bumper Bash',
    kidVerb: 'bumped',
    kidBlurb: 'Revs up like a bumper car and bonks its pal with a big, bouncy bump.',
  },
  {
    id: 'scorpion',
    name: 'Scorpion',
    emoji: '🦂',
    move: 'Death Sting',
    verb: 'stings to death',
    blurb: 'Pins the prey in its pincers and hammers the stinger home until it stops moving.',
    kidMove: 'Tickle Tail',
    kidVerb: 'tickled',
    kidBlurb: 'Holds on with its pincers and tickles with its tail until its pal falls over laughing.',
  },
  {
    id: 'crocodile',
    name: 'Crocodile',
    emoji: '🐊',
    move: 'Death Roll',
    verb: 'death-rolls',
    blurb: 'Clamps down, spins in a blood-flinging death roll and thrashes the body apart.',
    kidMove: 'Spin-a-Roo',
    kidVerb: 'spun',
    kidBlurb: 'Gives a gentle chomp-hold, then spins round and round like a merry-go-round.',
  },
];

export const animalById = (id) => ANIMALS.find((a) => a.id === id);

// Mode-aware copy for an animal: Kids mode swaps in the playful move name, verb and blurb.
export const moveOf = (a, kids) => (kids ? a.kidMove : a.move);
export const verbOf = (a, kids) => (kids ? a.kidVerb : a.verb);
export const blurbOf = (a, kids) => (kids ? a.kidBlurb : a.blurb);
