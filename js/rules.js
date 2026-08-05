// Aether Vault: encoded Commander knowledge.
// Sources: WotC / Commander Format Panel bracket system (October 2025 revision,
// February 2026 Game Changers update), EDHREC bracket guide, Commander Spellbook,
// and widely used deckbuilding templates. Names are matched case-insensitively.

const Rules = (() => {
  const GAME_CHANGERS = [
    'Ad Nauseam', 'Ancient Tomb', 'Aura Shards', 'Biorhythm', "Bolas's Citadel", 'Braids, Cabal Minion',
    'Chrome Mox', 'Coalition Victory', 'Consecrated Sphinx', 'Crop Rotation', 'Cyclonic Rift',
    'Demonic Tutor', 'Drannith Magistrate', 'Enlightened Tutor', 'Farewell', 'Field of the Dead',
    'Fierce Guardianship', 'Force of Will', "Gaea's Cradle", 'Gamble', 'Gifts Ungiven', 'Glacial Chasm',
    'Grand Arbiter Augustin IV', 'Grim Monolith', 'Humility', 'Imperial Seal', 'Intuition', "Jeska's Will",
    "Lion's Eye Diamond", 'Mana Vault', "Mishra's Workshop", 'Mox Diamond', 'Mystical Tutor',
    'Narset, Parter of Veils', 'Natural Order', 'Necropotence', 'Notion Thief', 'Opposition Agent',
    'Orcish Bowmasters', 'Panoptic Mirror', 'Rhystic Study', 'Seedborn Muse', "Serra's Sanctum",
    'Smothering Tithe', 'Survival of the Fittest', "Teferi's Protection", 'Tergrid, God of Fright',
    "Thassa's Oracle", 'The One Ring', 'The Tabernacle at Pendrell Vale', 'Underworld Breach',
    'Vampiric Tutor', 'Worldly Tutor',
  ];

  const FAST_MANA = [
    'Sol Ring', 'Mana Crypt', 'Mana Vault', 'Chrome Mox', 'Mox Diamond', 'Mox Opal', 'Mox Amber',
    'Jeweled Lotus', 'Lotus Petal', 'Grim Monolith', 'Ancient Tomb', 'City of Traitors',
    "Gaea's Cradle", "Serra's Sanctum", 'Dark Ritual', 'Cabal Ritual', "Jeska's Will", 'Rite of Flame',
    'Pyretic Ritual', 'Desperate Ritual', 'Seething Song', 'Elvish Spirit Guide', 'Simian Spirit Guide',
    "Lion's Eye Diamond", 'Treasonous Ogre', 'Culling the Weak',
  ];

  const FREE_INTERACTION = [
    'Force of Will', 'Force of Negation', 'Fierce Guardianship', 'Deadly Rollick', 'Deflecting Swat',
    'Flawless Maneuver', 'Obscuring Haze', 'Pact of Negation', 'Slaughter Pact', 'Mental Misstep',
    'Misdirection', 'Commandeer', 'Snapback', 'Foil',
  ];

  const TUTOR_NAMES = [
    'Demonic Tutor', 'Vampiric Tutor', 'Imperial Seal', 'Diabolic Intent', 'Grim Tutor', 'Diabolic Tutor',
    'Wishclaw Talisman', 'Mystical Tutor', 'Personal Tutor', 'Worldly Tutor', 'Enlightened Tutor',
    'Sylvan Tutor', "Green Sun's Zenith", 'Finale of Devastation', 'Chord of Calling', 'Natural Order',
    "Eladamri's Call", 'Tooth and Nail', 'Birthing Pod', 'Survival of the Fittest', 'Fauna Shaman',
    'Eldritch Evolution', 'Neoform', 'Gamble', 'Imperial Recruiter', 'Recruiter of the Guard',
    'Ranger-Captain of Eos', 'Ranger of Eos', 'Stoneforge Mystic', "Steelshaper's Gift", 'Open the Armory',
    'Fabricate', 'Whir of Invention', 'Reshape', 'Transmute Artifact', 'Tinker', 'Tribute Mage',
    'Trinket Mage', 'Trophy Mage', 'Muddle the Mixture', 'Merchant Scroll', 'Solve the Equation',
    'Idyllic Tutor', "Heliod's Pilgrim", 'Three Dreams', 'Sidisi, Undead Vizier', 'Rune-Scarred Demon',
    'Razaketh, the Foulblooded', 'Profane Tutor', 'Scheming Symmetry', "Thalia's Lancers",
    'Burning-Rune Demon', 'Mangara, the Diplomat',
  ];

  const EXTRA_TURNS = [
    'Time Warp', 'Temporal Manipulation', 'Capture of Jingzhou', 'Temporal Mastery',
    "Alrund's Epiphany", 'Nexus of Fate', 'Time Stretch', 'Expropriate', 'Temporal Trespass',
    "Karn's Temporal Sundering", 'Part the Waterveil', 'Savor the Moment', 'Walk the Aeons',
    'Plea for Power', 'Temporal Extortion', 'Beacon of Tomorrows', 'Wanderwine Prophets',
    'Timestream Navigator', 'Emrakul, the Aeons Torn', 'Time Sieve', 'Magistrate of Deals? no',
  ].filter((n) => !n.includes('?'));

  const MASS_LAND_DENIAL = [
    'Armageddon', 'Ravages of War', 'Sunder', 'Jokulhaups', 'Obliterate', 'Decree of Annihilation',
    'Cataclysm', 'Devastation', 'Global Ruin', 'Impending Disaster', 'Death Cloud', 'Tectonic Break',
    'Epicenter', 'Wildfire', 'Burning of Xinye', 'Keldon Firebombers', 'Winter Orb', 'Static Orb',
    'Stasis', 'Rising Waters', 'Ruination', 'Fall of the Thran', 'Boom // Bust',
  ];

  // Famous two-card pairs. mvSum is a rough total cost used to call a combo "fast".
  const COMBO_PAIRS = [
    { a: "Thassa's Oracle", b: 'Demonic Consultation', result: 'wins the game on the spot', mvSum: 3 },
    { a: "Thassa's Oracle", b: 'Tainted Pact', result: 'wins the game on the spot', mvSum: 4 },
    { a: 'Heliod, Sun-Crowned', b: 'Walking Ballista', result: 'infinite damage', mvSum: 7 },
    { a: 'Exquisite Blood', b: 'Sanguine Bond', result: 'infinite drain', mvSum: 10 },
    { a: 'Exquisite Blood', b: 'Vito, Thorn of the Dusk Rose', result: 'infinite drain', mvSum: 8 },
    { a: 'Exquisite Blood', b: 'Marauding Blight-Priest', result: 'infinite drain', mvSum: 8 },
    { a: 'Exquisite Blood', b: 'Cliffhaven Vampire', result: 'infinite drain', mvSum: 9 },
    { a: 'Exquisite Blood', b: 'Defiant Bloodlord', result: 'infinite drain', mvSum: 12 },
    { a: 'Isochron Scepter', b: 'Dramatic Reversal', result: 'infinite mana with 3+ rock mana', mvSum: 4 },
    { a: 'Kiki-Jiki, Mirror Breaker', b: 'Zealous Conscripts', result: 'infinite hasty attackers', mvSum: 10 },
    { a: 'Kiki-Jiki, Mirror Breaker', b: 'Deceiver Exarch', result: 'infinite hasty attackers', mvSum: 9 },
    { a: 'Kiki-Jiki, Mirror Breaker', b: 'Pestermite', result: 'infinite hasty attackers', mvSum: 8 },
    { a: 'Kiki-Jiki, Mirror Breaker', b: 'Felidar Guardian', result: 'infinite hasty attackers', mvSum: 9 },
    { a: 'Splinter Twin', b: 'Deceiver Exarch', result: 'infinite hasty attackers', mvSum: 8 },
    { a: 'Splinter Twin', b: 'Pestermite', result: 'infinite hasty attackers', mvSum: 7 },
    { a: 'Devoted Druid', b: 'Vizier of Remedies', result: 'infinite green mana', mvSum: 4 },
    { a: 'Devoted Druid', b: 'Swift Reconfiguration', result: 'infinite mana', mvSum: 3 },
    { a: 'Mikaeus, the Unhallowed', b: 'Triskelion', result: 'infinite damage', mvSum: 12 },
    { a: 'Mikaeus, the Unhallowed', b: 'Walking Ballista', result: 'infinite damage with a sac outlet', mvSum: 8 },
    { a: 'Godo, Bandit Warlord', b: 'Helm of the Host', result: 'infinite combat steps', mvSum: 11 },
    { a: 'Basalt Monolith', b: 'Rings of Brighthearth', result: 'infinite colorless mana', mvSum: 6 },
    { a: 'Basalt Monolith', b: 'Kinnan, Bonder Prodigy', result: 'infinite colorless mana', mvSum: 5 },
    { a: 'Grim Monolith', b: 'Power Artifact', result: 'infinite colorless mana', mvSum: 4 },
    { a: 'Food Chain', b: 'Squee, the Immortal', result: 'infinite creature mana', mvSum: 6 },
    { a: 'Food Chain', b: 'Eternal Scourge', result: 'infinite creature mana', mvSum: 6 },
    { a: 'Worldgorger Dragon', b: 'Animate Dead', result: 'infinite mana and ETBs', mvSum: 8 },
    { a: 'Karmic Guide', b: 'Reveillark', result: 'recursion engine loop', mvSum: 10 },
    { a: 'Niv-Mizzet, Parun', b: 'Curiosity', result: 'draws the deck, lethal pings', mvSum: 7 },
    { a: 'Niv-Mizzet, Parun', b: 'Ophidian Eye', result: 'draws the deck, lethal pings', mvSum: 9 },
    { a: 'Niv-Mizzet, the Firemind', b: 'Curiosity', result: 'draws the deck, lethal pings', mvSum: 7 },
    { a: 'Deadeye Navigator', b: 'Peregrine Drake', result: 'infinite mana', mvSum: 11 },
    { a: 'Archangel of Thune', b: 'Spike Feeder', result: 'infinite life and counters', mvSum: 8 },
    { a: 'Witherbloom Apprentice', b: 'Chain of Smog', result: 'infinite drain', mvSum: 4 },
    { a: 'Ad Nauseam', b: "Angel's Grace", result: 'draw your whole deck', mvSum: 6 },
    { a: 'Time Sieve', b: 'Thopter Assembly', result: 'infinite turns', mvSum: 8 },
    { a: 'Rest in Peace', b: 'Helm of Obedience', result: 'mills a player out', mvSum: 6 },
    { a: "Painter's Servant", b: 'Grindstone', result: 'mills a player out', mvSum: 5 },
    { a: 'Aggravated Assault', b: 'Savage Ventmaw', result: 'infinite combat steps', mvSum: 9 },
    { a: 'Aggravated Assault', b: 'Neheb, the Eternal', result: 'infinite combats with burn mana', mvSum: 8 },
    { a: 'Sanguine Bond', b: 'Beacon of Immortality', result: 'one-shots a player', mvSum: 11 },
  ];

  // Composition baselines (widely used template, tuned by format consensus)
  const BASELINES = {
    lands: [35, 38], ramp: [10, 12], draw: [8, 10], removal: [8, 10], wipes: [2, 4],
  };

  const BRACKETS = [
    { n: 1, name: 'Exhibition', turn: 'nine or later', blurb: 'Theme over power. No Game Changers, no mass land denial, no extra turns, no two-card combos.' },
    { n: 2, name: 'Core', turn: 'eight or later', blurb: 'Precon strength. No Game Changers, no mass land denial, no chained extra turns, no two-card combos.' },
    { n: 3, name: 'Upgraded', turn: 'six or later', blurb: 'Up to three Game Changers. No mass land denial. Two-card combos only late (turn seven on). No chained extra turns.' },
    { n: 4, name: 'Optimized', turn: 'four or later', blurb: 'No restrictions beyond the banned list. Fast mana, combos, and tutors expected.' },
    { n: 5, name: 'cEDH', turn: 'any turn', blurb: 'Tournament mindset. Maximum consistency, wins contested from turn one.' },
  ];

  // ---------- archetypes ----------
  // test(card) receives {n, o (oracle lower), t (type_line lower), mv, ci}
  const ARCHETYPES = [
    { key: 'tokens', name: 'Tokens', test: (c) => /create[^.]*token/.test(c.o), min: 8,
      staples: ['Anointed Procession', 'Mondrak, Glory Dominus', 'Parallel Lives', 'Doubling Season', 'Skullclamp', 'Purphoros, God of the Forge', 'Impact Tremors', 'Jetmir, Nexus of Revels', 'Second Harvest'] },
    { key: 'counters', name: '+1/+1 Counters', test: (c) => /\+1\/\+1 counter/.test(c.o), min: 8,
      staples: ['Hardened Scales', 'Branching Evolution', 'Kami of Whispered Hopes', 'The Ozolith', 'Conclave Mentor', 'Inspiring Call', 'Cathars’ Crusade'] },
    { key: 'aristocrats', name: 'Aristocrats / Sacrifice', test: (c) => /sacrifice a creature|whenever [^.]*dies|dies, /.test(c.o), min: 8,
      staples: ['Blood Artist', 'Zulaport Cutthroat', 'Bastion of Remembrance', 'Viscera Seer', 'Phyrexian Altar', 'Ashnod’s Altar', 'Dictate of Erebos', 'Grave Pact', 'Pitiless Plunderer', 'Mayhem Devil'] },
    { key: 'graveyard', name: 'Graveyard / Reanimator', test: (c) => /from (your|a) graveyard|mill (a|two|three|x)|return [^.]*graveyard[^.]*battlefield/.test(c.o), min: 8,
      staples: ['Animate Dead', 'Reanimate', 'Entomb', 'Buried Alive', 'Living Death', 'Syr Konrad, the Grim', 'Eternal Witness', 'Genesis Wave'] },
    { key: 'spells', name: 'Spellslinger', test: (c) => /instant or sorcery|whenever you cast a noncreature/.test(c.o), min: 6,
      staples: ['Talrand, Sky Summoner', 'Archmage Emeritus', 'Guttersnipe', 'Storm-Kiln Artist', 'Young Pyromancer', 'Whirlwind of Thought'] },
    { key: 'artifacts', name: 'Artifacts', test: (c) => c.t.includes('artifact') || /artifact you control|artifact spells/.test(c.o), min: 18,
      staples: ['Emry, Lurker of the Loch', 'Sai, Master Thopterist', 'Etherium Sculptor', 'Foundry Inspector', 'Kappa Cannoneer', 'Vedalken Archmage', 'Thought Monitor'] },
    { key: 'lifegain', name: 'Lifegain', test: (c) => /gain[s]? [^.]*life|lifelink/.test(c.o), min: 8,
      staples: ['Soul Warden', "Soul's Attendant", 'Vito, Thorn of the Dusk Rose', 'Sanguine Bond', 'Archangel of Thune', 'Heliod, Sun-Crowned', 'Cleric Class'] },
    { key: 'landfall', name: 'Lands Matter', test: (c) => /landfall|whenever a land you control enters|play an additional land/.test(c.o), min: 5,
      staples: ['Lotus Cobra', 'Tireless Provisioner', 'Scute Swarm', 'Avenger of Zendikar', 'Aesi, Tyrant of Gyre Strait', 'Tatyova, Benthic Druid'] },
    { key: 'blink', name: 'Blink / ETB Value', test: (c) => /exile [^.]*return [^.]*battlefield|when [^.]*enters/.test(c.o), min: 14,
      staples: ['Ephemerate', 'Conjurer’s Closet', 'Panharmonicon', 'Thassa, Deep-Dwelling', 'Soulherder', 'Charming Prince'] },
    { key: 'voltron', name: 'Voltron / Equipment', test: (c) => c.t.includes('equipment') || c.t.includes('aura') || /attach|equipped creature/.test(c.o), min: 8,
      staples: ['Sigarda’s Aid', 'Puresteel Paladin', 'Sram, Senior Edificer', 'Colossus Hammer', 'All That Glitters', 'Swiftfoot Boots'] },
    { key: 'wheels', name: 'Wheels / Group Draw', test: (c) => /each player draws|discards? (their|his or her) hand/.test(c.o), min: 3,
      staples: ['Wheel of Misfortune', 'Windfall', 'Waste Not', 'The Locust God', 'Sheoldred, the Apocalypse'] },
  ];

  // ---------- role detectors ----------
  const isLand = (c) => c.t.includes('land');
  const isRamp = (c) => !isLand(c) && (
    /add \{|adds? (one|two) mana/.test(c.o) && !c.t.includes('instant') && !c.t.includes('sorcery') ||
    /search your librar[^.]*land[^.]*battlefield/.test(c.o) ||
    /spells? you cast cost \{?\d\}? less/.test(c.o)
  );
  const isDraw = (c) => /draw (a card|two|three|four|x|cards)/.test(c.o) && !/opponent draws/.test(c.o.split('draw')[0] || '');
  const isRemoval = (c) => !isLand(c) && (
    /destroy target|exile target (creature|artifact|enchantment|planeswalker|permanent|nonland)/.test(c.o) ||
    /counter target [^.]*spell/.test(c.o) ||
    /deals? \d+ damage to (any target|target creature)/.test(c.o) ||
    /(target|each) (player|opponent) sacrifices a creature/.test(c.o)
  );
  const isWipe = (c) => /destroy all|exile all (creatures|nonland)|all creatures get -|each creature|deals? \d+ damage to each creature/.test(c.o) &&
    (c.t.includes('sorcery') || c.t.includes('instant') || /when [^.]*enters/.test(c.o));

  const genericTutor = (c) => /search your library for a[^.]*card/.test(c.o) && !/land card/.test(c.o);

  // gap suggestions by need, filtered by color identity at call time
  const GAP_SUGGESTIONS = {
    ramp: ['Arcane Signet', 'Fellwar Stone', 'Nature’s Lore', 'Three Visits', 'Cultivate', 'Kodama’s Reach', 'Farseek', 'Talisman of Dominance', 'Mind Stone', 'Sakura-Tribe Elder'],
    draw: ['Esper Sentinel', 'Rhystic Study', 'Mystic Remora', 'Phyrexian Arena', 'Night’s Whisper', 'Read the Bones', 'Harmonize', 'Guardian Project', 'Beast Whisperer', 'Ledger Shredder'],
    removal: ['Swords to Plowshares', 'Path to Exile', 'Beast Within', 'Generous Gift', 'Chaos Warp', 'Anguished Unmaking', 'Assassin’s Trophy', 'Counterspell', 'Feed the Serpent', 'Rapid Hybridization'],
    wipes: ['Blasphemous Act', 'Toxic Deluge', 'Damnation', 'Wrath of God', 'Austere Command', 'Vanquish the Horde', 'Cyclonic Rift'],
    lands: [],
  };

  const set = (arr) => new Set(arr.map((n) => n.toLowerCase()));
  return {
    GAME_CHANGERS, GC: set(GAME_CHANGERS),
    FAST_MANA, FAST: set(FAST_MANA),
    FREE_INTERACTION, FREE: set(FREE_INTERACTION),
    TUTOR_NAMES, TUTORS: set(TUTOR_NAMES),
    EXTRA_TURNS, TURNS: set(EXTRA_TURNS),
    MASS_LAND_DENIAL, MLD: set(MASS_LAND_DENIAL),
    COMBO_PAIRS, BASELINES, BRACKETS, ARCHETYPES,
    isLand, isRamp, isDraw, isRemoval, isWipe, genericTutor, GAP_SUGGESTIONS,
  };
})();
