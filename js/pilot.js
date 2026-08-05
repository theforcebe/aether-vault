// Aether Vault: pilot guide generator.
// Turns a deck plus its analysis into a structured, deck-specific playbook:
// opening hands with reasons, turn-by-turn plan, key cards, matchups, weaknesses.
// Rendered by the pilot view and print-styled for save-as-PDF.

const Pilot = (() => {
  const lower = (s) => (s || '').toLowerCase();

  // Authored per-archetype playbook. Parameterized at build time with the deck's cards.
  const PLAYBOOK = {
    aristocrats: {
      plan: 'Turn creatures into resources. Every body is fuel: sacrifice it on your terms for cards, mana, or drain, then bring it back and do it again. You do not fear removal or board wipes the way other decks do; your creatures dying is the plan working.',
      strong: ['Board wipe decks: your creatures dying triggers your whole engine', 'Targeted removal: sacrificing in response turns their kill spells into blanks', 'Slow value decks that cannot pressure your engine early'],
      weak: ['Graveyard exile: one Rest in Peace or Bojuka Bog can strand the engine', 'Fast combo that ignores the board entirely', 'Stax pieces that tax activated abilities or sacrifices'],
      hate: ['Rest in Peace', 'Bojuka Bog', 'Leyline of the Void', 'Grafdigger\'s Cage'],
      tips: ['Sacrifice at instant speed in response to removal and exile effects', 'Hold one drain piece back when a wipe is likely so the rebuild closes the game', 'Count your drain triggers before combat; lethal is often earlier than it looks'],
    },
    graveyard: {
      plan: 'The graveyard is your second hand. Fill it deliberately, then return the best pieces at a discount. Card disadvantage is temporary; everything you bin comes back with interest.',
      strong: ['Attrition and removal-heavy decks: they trade one for one against a deck that never truly loses a card', 'Slow midrange tables that give you setup turns', 'Board wipes: you rebuild faster than anyone'],
      weak: ['Graveyard exile effects, the single scariest cards at the table for you', 'Aggressive starts that end the game before the engine spins up', 'Counterspell decks that tax your key reanimation spells'],
      hate: ['Rest in Peace', 'Dauthi Voidwalker', 'Scavenger Grounds', 'Soul-Guide Lantern'],
      tips: ['Do not dump everything to the yard against open black or white mana; pace your setup', 'Reanimate value engines first, finishers second, unless lethal is on the table', 'Play around one exile effect per game; assume it is coming'],
    },
    tokens: {
      plan: 'Go wide, then make the width lethal. Tokens come from many small engines; anthems and payoffs convert the swarm into damage, cards, or drain. Rebuild fast after every sweeper.',
      strong: ['Single-target removal decks: one token is never worth their card', 'Blockers-based defense: you simply outnumber it', 'Decks that stumble early; your snowball starts turn two'],
      weak: ['Repeated board wipes, especially at instant speed', 'Fliers and evasion going over your ground swarm', 'Damage-based sweepers that undo a turn of setup for two mana'],
      hate: ['Blasphemous Act', 'Cyclonic Rift', 'Toxic Deluge', 'Farewell'],
      tips: ['Deploy in waves, not all at once; keep one token maker in hand through wipes', 'Anthems before attacks, payoffs before anthems when mana is tight', 'Attack the open player to keep pressure while engines rebuild'],
    },
    counters: {
      plan: 'Every counter compounds. Small creatures become huge, proliferate multiplies everything, and your board outgrows answers if left alone for even two turns.',
      strong: ['Fair combat decks: your creatures are permanently bigger', 'Removal-light tables where growth goes unchecked', 'Grindy games; your late draws scale, theirs do not'],
      weak: ['Mass bounce and exile wipes that ignore size', 'Counters-matter hate is rare, but -1/-1 effects and Toxic Deluge scale past you', 'Fliers over a grounded board'],
      hate: ['Cyclonic Rift', 'Farewell', 'Toxic Deluge'],
      tips: ['Spread counters across multiple bodies before a wipe, concentrate after', 'Proliferate at end of turn unless attacking demands it earlier', 'Protect the one creature carrying the team; removal aims there'],
    },
    spells: {
      plan: 'Cheap instants and sorceries are both your fuel and your win. Every cast triggers your payoffs; a big turn with three or four spells cascades into damage, tokens, or cards.',
      strong: ['Slow decks that let you sculpt a hand', 'Creature-light tables where your payoffs go unanswered', 'Games that go long; your card quality wins attrition'],
      weak: ['Early aggro that punishes durdle turns', 'Payoff removal; the deck is engines plus fuel, and they aim at the engines', 'Taxing effects that make cheap spells expensive'],
      hate: ['Drannith Magistrate', 'Thalia, Guardian of Thraben', 'Rule of Law effects'],
      tips: ['Do not cast payoffs into open mana without protection or a follow-up', 'Count triggers before a storm turn; know if it is lethal before you start', 'Hold instants for opponent end steps until a payoff makes main phase casting better'],
    },
    artifacts: {
      plan: 'Artifacts discount artifacts. Cost reducers plus draw engines chain into explosive turns, and your payoffs turn the pile of trinkets into a clock.',
      strong: ['Fair value decks; your snowball out-resources them', 'Color-screwed or slow starts elsewhere; your ramp is colorless and constant', 'Single-target removal, which never keeps pace with your cheap threats'],
      weak: ['Artifact board wipes are catastrophic; one Vandalblast can end you', 'Stony Silence style lockouts', 'Graveyard-free games if your recursion mattered'],
      hate: ['Vandalblast', 'Stony Silence', 'Collector Ouphe', 'Farewell'],
      tips: ['Play around one artifact wipe per game; keep a rebuild hand', 'Sequence cost reducers before the draw engine turns', 'Your creatures are artifacts too; removal math is different at this table'],
    },
    lifegain: {
      plan: 'Life is a resource everyone else ignores. Incidental gain triggers snowball into counters, cards, and drain; the payoffs convert a fat life total into an actual win.',
      strong: ['Aggro and burn; their whole plan feeds your triggers', 'Racing decks; your clock plus buffer beats theirs', 'Attrition; every gain trigger is extra value'],
      weak: ['Combo decks that ignore life totals', 'Effects that stop lifegain outright', 'Commander damage and infect, which bypass the buffer'],
      hate: ['Rampaging Ferocidon', 'Erebos, God of the Dead', 'Roiling Vortex'],
      tips: ['Prioritize repeatable gain over big one-shots; triggers per turn beat totals', 'Deploy payoffs only once gain engines are running', 'Watch commander damage separately; a 40 life buffer does not help there'],
    },
    landfall: {
      plan: 'Land drops are spells. Extra lands per turn plus landfall payoffs make every fetch a two-for-one, and the deck converts mana into an avalanche of bodies and cards.',
      strong: ['Grindy tables; your resource engine never stalls', 'Sweeper-heavy decks; lands survive wipes', 'Removal decks; your threats are hydra-headed and replaceable'],
      weak: ['Fast combo before the avalanche starts', 'Mass land destruction, rare but fatal', 'Flying pressure while you set up'],
      hate: ['Armageddon effects', 'Blood Moon effects on greedy mana bases'],
      tips: ['Hold a fetch or bounce land for the payoff turn when it matters', 'Sequence ramp so every turn hits a land drop plus a spell', 'Do not overextend into open sweepers; lands rebuild you fast anyway'],
    },
    blink: {
      plan: 'Enter-the-battlefield triggers, twice. Blink turns every creature into a repeatable spell: value on entry, protection on demand, and an engine that compounds each turn.',
      strong: ['Targeted removal: blinking in response blanks it', 'Attrition decks; your creatures are card advantage on legs', 'Board stalls, which your triggers slowly break'],
      weak: ['Aggro that ignores your value and races', 'Sweepers, which do not care about ETBs', 'Graveyard-free? Not an issue, but stax on casting hits the engine'],
      hate: ['Hushbringer', 'Torpor Orb', 'Toxic Deluge'],
      tips: ['Blink at instant speed for protection first, value second', 'Stack ETB triggers in the order that maximizes information', 'One blink engine plus one draw ETB beats three vanilla values'],
    },
    voltron: {
      plan: 'One threat, made unanswerable. Suit up the commander, protect it with everything, and end games through commander damage in two or three connections.',
      strong: ['Multiplayer politics; 21 commander damage ignores life totals', 'Wipe-heavy decks if your gear survives; equipment persists', 'Slow decks that cannot block a huge evasive attacker'],
      weak: ['Exile and tuck effects on the commander', 'Sacrifice edicts that dodge protection', 'Chump blockers plus lifegain stalling the clock'],
      hate: ['Edict effects', 'Darksteel Mutation', 'Imprisoned in the Moon'],
      tips: ['Always hold one protection spell once the commander is suited', 'Equipment before creatures on wipe turns; gear survives', 'Track 21 damage per player; spread hits only when forced'],
    },
    wheels: {
      plan: 'Everyone draws; only you profit. Wheel effects refill your hand, punish theirs, and feed payoffs that turn each drawn card into damage or resources.',
      strong: ['Slow decks with sculpted hands; wheels ruin their planning', 'Empty-handed topdeck tables; you refill first', 'Value engines that need specific pieces held'],
      weak: ['Decks that use the cards you give them faster than you do', 'Payoff removal before the wheel turn', 'Narrow hate like Notion Thief turned against you'],
      hate: ['Notion Thief', 'Narset, Parter of Veils', 'Sheoldred, the Apocalypse'],
      tips: ['Wheel with a payoff on board, not before', 'Count table outs before handing everyone seven new cards', 'Hold one wheel as recovery after a wipe or discard hit'],
    },
    zombies: {
      plan: 'The horde recurs. Zombies flood the board, die profitably, and come back; tribal payoffs turn every body into drain, cards, or more zombies.',
      strong: ['Attrition; the horde does not stay dead', 'Board wipes; you rebuild from the yard faster than anyone', 'Fair combat; deathtouch chump blocks and drain triggers tax every swing'],
      weak: ['Graveyard exile hurts recursion badly', 'Fliers over the shambling ground horde', 'Exile-based sweepers'],
      hate: ['Rest in Peace', 'Farewell', 'Bojuka Bog'],
      tips: ['Feed the yard early; it is a second hand', 'Drain payoffs before combat make chump math brutal for opponents', 'Keep one lord back to rebuild after exile effects'],
    },
    dragons: {
      plan: 'Overwhelming quality in the air. Ramp hard, deploy haymakers that demand answers every turn, and let dragon payoffs snowball card advantage.',
      strong: ['Ground-based decks; five power flying is a fast clock', 'Removal-light tables; each dragon left alive takes over', 'Late game; your topdecks are the best at the table'],
      weak: ['Aggro punishing slow ramp turns', 'Counterspells taxing five-drops', 'Sweepers timed after a double deploy'],
      hate: ['Cyclonic Rift', 'Farewell', 'Counterspell-heavy tables'],
      tips: ['One threat per turn against open mana; two when it is safe', 'Ramp turns are weak turns; hold interaction where possible', 'Haste enablers decide games; sequence them with your biggest dragon'],
    },
    elves: {
      plan: 'Mana out of nowhere. Elves make absurd amounts of green mana by turn four; overrun effects and draw engines convert the board into lethal or a refilled hand.',
      strong: ['Slow decks; your explosive starts outpace them badly', 'One-for-one removal; elves multiply faster', 'Mana screw elsewhere; you never miss'],
      weak: ['Board wipes are devastating; the deck is creatures all the way down', 'Pinger effects that machine-gun one-toughness elves', 'Flying blockers against your ground overrun'],
      hate: ['Blasphemous Act', 'Pyroclasm effects', 'Toxic Deluge'],
      tips: ['Play around the first wipe: keep two elves and a payoff in hand', 'Overrun effects end games; do not cast them for value', 'Draw engines before dumping the hand; refuel mid-wipe-recovery'],
    },
  };
  const DEFAULT_BOOK = {
    plan: 'Deploy your engine pieces early, protect what matters, and convert your advantage into a close before the table can answer it.',
    strong: ['Slower decks that give you setup time', 'Tables without much interaction'],
    weak: ['Focused hate against your core engine', 'Faster clocks than yours'],
    hate: [],
    tips: ['Identify the deck\'s engine cards and protect them', 'Sequence the cheapest engine piece first'],
  };

  function keyOf(archName) {
    const t = window.VAULT_TEMPLATES;
    if (!t) return null;
    const a = (t.archetypes || []).find((x) => x.name === archName);
    return a ? a.key : null;
  }

  // Build the guide model from a deck view + analysis.
  function model(dv, r) {
    const cards = dv.cards;
    const facts = (n) => Store.card(n);
    const brainF = {};
    const archKey = r.brainMatches && r.brainMatches[0] ? r.brainMatches[0].key
      : (r.archetypes[0] ? keyOf(r.archetypes[0].name) : null);
    const B = window.VAULT_BRAIN;
    if (B && archKey && B.archetypes[archKey]) {
      for (const bc of B.archetypes[archKey].cards) brainF[Store.norm(bc.n)] = bc.f;
    }
    const book = PLAYBOOK[archKey] || DEFAULT_BOOK;
    const archName = (r.brainMatches && r.brainMatches[0] ? r.brainMatches[0].name : (r.archetypes[0] || {}).name) || 'Commander';

    const nonland = cards.filter((c) => { const f = facts(c.n); return !f || !f.t.includes('Land'); });
    const byFreq = nonland
      .filter((c) => c.src !== 'commander')
      .map((c) => ({ ...c, f: brainF[Store.norm(c.n)] || 0, mv: (facts(c.n) || {}).mv || 0 }))
      .sort((a, b) => b.f - a.f);

    // opening hand pieces
    const earlyRamp = byFreq.filter((c) => {
      const f = facts(c.n);
      return f && c.mv <= 3 && (Rules.isRamp({ o: '', t: f.t.toLowerCase(), mv: f.mv }) || ['ramp'].includes(c.role));
    });
    // role info is not on deck cards; recompute cheaply from analysis comp membership is unavailable — approximate with brain roles
    const rampNames = [];
    const engineNames = [];
    const interactionNames = [];
    if (B && archKey && B.archetypes[archKey]) {
      const inDeck = new Set(cards.map((c) => Store.norm(c.n)));
      for (const bc of B.archetypes[archKey].cards) {
        if (!inDeck.has(Store.norm(bc.n))) continue;
        if (bc.role === 'ramp' && bc.mv <= 3 && rampNames.length < 4) rampNames.push(bc.n);
        else if (bc.role === 'none' && bc.mv <= 4 && engineNames.length < 5 && bc.f >= 0.2) engineNames.push(bc.n);
        else if ((bc.role === 'removal' || bc.role === 'wipe') && interactionNames.length < 3) interactionNames.push(bc.n);
      }
    }
    if (!engineNames.length) {
      for (const c of byFreq.slice(0, 5)) engineNames.push(c.n);
    }

    const landTarget = r.comp.lands >= 36 ? '3 to 4' : '2 to 4';
    const finishers = nonland
      .map((c) => ({ n: c.n, mv: (facts(c.n) || {}).mv || 0, f: brainF[Store.norm(c.n)] || 0 }))
      .filter((c) => c.mv >= 5)
      .sort((a, b) => (b.f - a.f) || (b.mv - a.mv))
      .slice(0, 4)
      .map((c) => c.n);

    const keyCards = [];
    if (dv.commander) keyCards.push({ n: dv.commander, why: 'Your commander and the deck\'s centerpiece. The whole list is tuned around casting and protecting it.' });
    for (const c of byFreq.slice(0, 7)) {
      if (keyCards.length >= 8) break;
      const pct = c.f ? Math.round(c.f * 100) + '% of ' + archName.toLowerCase() + ' decks run it. ' : '';
      keyCards.push({ n: c.n, why: pct + (c.mv <= 2 ? 'Cheap enough to deploy early and rebuild after answers.' : c.mv >= 5 ? 'A top-end play that should close or dominate when it resolves.' : 'A core engine piece; protect it when the table starts pointing removal.') });
    }
    for (const p of r.combos || []) {
      keyCards.push({ n: p.a + ' + ' + p.b, why: 'Combo line: ' + p.result + '. Assemble with protection open when possible.' });
    }

    // computed strengths/weaknesses on top of the authored book
    const strengths = [...book.strong];
    const weaknesses = [...book.weak];
    if (r.comp.wipes >= 3) strengths.push('Go-wide decks: you run ' + r.comp.wipes + ' sweepers');
    if ((r.free || []).length >= 2) strengths.push('Combo tables: free interaction (' + r.free.join(', ') + ') works even when tapped out');
    if (r.comp.draw < 8) weaknesses.push('Running out of gas: only ' + r.comp.draw + ' draw effects, so value every card');
    if (r.comp.ramp < 9) weaknesses.push('Slow starts: ' + r.comp.ramp + ' ramp pieces is below par, mulligan for early mana');
    if (parseFloat(r.avgMv) >= 3.4) weaknesses.push('A top-heavy curve (avg ' + r.avgMv + '): fast tables can punish setup turns');

    return {
      name: dv.name,
      commander: dv.commander,
      commanderSid: dv.commanderSid,
      ci: dv.ci,
      archetype: archName,
      bracket: r.bracket,
      bracketName: Rules.BRACKETS[r.bracket - 1].name,
      feel: r.feel,
      value: cards.reduce((s, c) => s + Store.cardValue(c.n, c.sid || Store.sidFor(c.n)) * c.q, 0),
      count: cards.reduce((s, c) => s + c.q, 0),
      comp: r.comp,
      avgMv: r.avgMv,
      gcs: r.gcs,
      combos: r.combos || [],
      similarDecks: r.similarDecks || [],
      plan: book.plan,
      landTarget, rampNames, engineNames, interactionNames, finishers,
      keyCards,
      strengths, weaknesses,
      hate: book.hate,
      tips: book.tips,
    };
  }

  return { model, PLAYBOOK };
})();
