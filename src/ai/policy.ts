import { legalCards, resolveTrick, TRUMP, type Card, type KitsuneMode, type Play } from '../engine/index.js';

/** A playable choice: a card plus, for the Kitsune, the mode it is declared as. */
export interface Option {
  card: Card;
  as?: KitsuneMode;
}

/** Every legal choice for `hand` on the trick so far; the Kitsune yields two. */
export function optionsFor(hand: readonly Card[], plays: readonly Play[]): Option[] {
  const out: Option[] = [];
  for (const card of legalCards(hand, plays)) {
    if (card.kind === 'kitsune') out.push({ card, as: 'master' }, { card, as: 'smokeBomb' });
    else out.push({ card });
  }
  return out;
}

/** How hard the option is to beat once on the table. */
function power({ card, as }: Option): number {
  switch (card.kind) {
    case 'number':
      return card.suit === TRUMP ? 20 + card.rank : card.rank;
    case 'smokeBomb':
      return 0;
    case 'geisha':
      return 40;
    case 'master':
      return 50;
    case 'shogun':
      return 60;
    case 'kitsune':
      return as === 'master' ? 50 : 0;
  }
}

/** What the card is worth kept in hand for winning later; the Kitsune keeps its value in either mode. */
const cost = (o: Option) => (o.card.kind === 'kitsune' ? 50 : power(o));

/** How risky the card is to hold when dodging; smoke bombs are worth keeping. */
const danger = (o: Option) => (power(o) === 0 ? -1 : power(o));

const isBomb = (o: Option) => power(o) === 0;

function best(options: Option[], score: (o: Option) => number): Option {
  let pick = options[0];
  for (const o of options) if (score(o) > score(pick)) pick = o;
  return pick;
}

const lowest = (options: Option[], score: (o: Option) => number) => best(options, (o) => -score(o));

function winsSoFar(plays: readonly Play[], player: number, o: Option): boolean {
  return resolveTrick([...plays, { player, card: o.card, as: o.as }]).winner === player;
}

function leadWhileDodging(options: Option[]): Option {
  const standard = options.filter((o) => o.card.kind === 'number' && o.card.suit !== TRUMP);
  const low = standard.length ? lowest(standard, power) : null;
  if (low && power(low) <= 4) return low;
  // A real smoke bomb before the Kitsune, which is worth more kept.
  const bombs = options.filter(isBomb);
  if (bombs.length) return lowest(bombs, cost);
  return low ?? lowest(options, power);
}

/**
 * Rule-of-thumb play. `need` is how many more tricks the player still wants:
 * above zero they try to take the trick cheaply, otherwise they try to lose it
 * while shedding their most dangerous cards.
 */
export function heuristicPlay(
  hand: readonly Card[],
  plays: readonly Play[],
  player: number,
  playerCount: number,
  need: number,
): Option {
  const options = optionsFor(hand, plays);
  if (options.length === 1) return options[0];
  const isLast = plays.length === playerCount - 1;
  const winning = options.filter((o) => winsSoFar(plays, player, o));

  if (need > 0) {
    if (winning.length === 0) return lowest(options, cost);
    return isLast ? lowest(winning, cost) : best(winning, power);
  }

  if (plays.length === 0) return leadWhileDodging(options);
  const losing = options.filter((o) => !winning.includes(o));
  if (losing.length) return best(losing, danger);
  // Forced to be ahead: when last, shed the biggest card; otherwise stay as beatable as possible.
  return isLast ? best(options, power) : lowest(options, power);
}
