import { describe, expect, it } from 'vitest';
import { num, special, trickOf } from './testing.js';
import { leadSuit, legalCards, resolveTrick } from './trick.js';

const kitsune = special('kitsune');

describe('leadSuit', () => {
  it('is the clan of the numbered card that opens', () => {
    expect(leadSuit(trickOf(num('fire', 3), num('water', 9)))).toBe('fire');
  });

  it('is unset on an empty trick', () => {
    expect(leadSuit([])).toBeNull();
  });

  it.each(['master', 'geisha', 'shogun'] as const)('stays unset all trick when a %s opens', (kind) => {
    expect(leadSuit(trickOf(special(kind), num('fire', 3)))).toBeNull();
  });

  it('stays unset when the Kitsune opens as a master', () => {
    expect(leadSuit(trickOf([kitsune, 'master'], num('fire', 3)))).toBeNull();
  });

  it('is set by the first numbered card after an opening smoke bomb', () => {
    expect(leadSuit(trickOf(special('smokeBomb')))).toBeNull();
    expect(leadSuit(trickOf(special('smokeBomb'), num('water', 2), num('fire', 9)))).toBe('water');
    expect(leadSuit(trickOf([kitsune, 'smokeBomb'], num('forest', 2)))).toBe('forest');
  });

  it('skips a character played after an opening smoke bomb', () => {
    expect(leadSuit(trickOf(special('smokeBomb'), special('master')))).toBeNull();
    expect(leadSuit(trickOf(special('smokeBomb'), special('master'), num('fire', 4)))).toBe('fire');
  });
});

describe('legalCards', () => {
  const hand = [num('fire', 2), num('water', 8), num('shadow', 5), special('smokeBomb'), special('master')];

  it('allows anything when leading', () => {
    expect(legalCards(hand, [])).toEqual(hand);
  });

  it('forces the led clan but always allows specials', () => {
    const legal = legalCards(hand, trickOf(num('fire', 9)));
    expect(legal.map((c) => c.id)).toEqual(['fire-2', 'smokeBomb-1', 'master-1']);
  });

  it('does not allow trumping while able to follow', () => {
    const legal = legalCards(hand, trickOf(num('water', 1)));
    expect(legal.map((c) => c.id)).not.toContain('shadow-5');
  });

  it('allows anything, trump included, when void in the led clan', () => {
    expect(legalCards(hand, trickOf(num('forest', 9)))).toEqual(hand);
  });

  it('allows anything when a character opened', () => {
    expect(legalCards(hand, trickOf(special('shogun'), num('fire', 9)))).toEqual(hand);
  });

  it('allows anything after a lone smoke bomb, then follows the clan it gets', () => {
    expect(legalCards(hand, trickOf(special('smokeBomb')))).toEqual(hand);
    const legal = legalCards(hand, trickOf(special('smokeBomb'), num('water', 3)));
    expect(legal.map((c) => c.id)).toEqual(['water-8', 'smokeBomb-1', 'master-1']);
  });
});

describe('resolveTrick: numbered cards', () => {
  it('highest of the led clan wins', () => {
    const r = resolveTrick(trickOf(num('fire', 3), num('fire', 11), num('fire', 7)));
    expect(r).toMatchObject({ winner: 1, reason: 'highestLeadSuit', bonus: 0 });
  });

  it('an off-clan card never wins, whatever its rank', () => {
    const r = resolveTrick(trickOf(num('fire', 2), num('water', 13), num('forest', 12)));
    expect(r).toMatchObject({ winner: 0, reason: 'highestLeadSuit' });
  });

  it('any shadow beats the led clan; highest shadow wins', () => {
    const r = resolveTrick(trickOf(num('fire', 13), num('shadow', 1), num('shadow', 4)));
    expect(r).toMatchObject({ winner: 2, reason: 'highestShadow' });
  });

  it('highest shadow wins when shadow is led', () => {
    const r = resolveTrick(trickOf(num('shadow', 6), num('fire', 13), num('shadow', 9)));
    expect(r).toMatchObject({ winner: 2, reason: 'highestShadow' });
  });

  it('the clan after an opening smoke bomb is the one that counts', () => {
    const r = resolveTrick(trickOf(special('smokeBomb'), num('water', 2), num('fire', 13)));
    expect(r).toMatchObject({ winner: 1, reason: 'highestLeadSuit' });
  });
});

describe('resolveTrick: specials', () => {
  it('a smoke bomb loses to any numbered card', () => {
    const r = resolveTrick(trickOf(special('smokeBomb'), num('fire', 1)));
    expect(r).toMatchObject({ winner: 1, reason: 'highestLeadSuit' });
  });

  it('first card wins when everything is a smoke bomb', () => {
    const r = resolveTrick(trickOf(special('smokeBomb', 1), [kitsune, 'smokeBomb'], special('smokeBomb', 2)));
    expect(r).toMatchObject({ winner: 0, reason: 'allSmokeBombs', bonus: 0 });
  });

  it('a master beats every numbered card, shadow included', () => {
    const r = resolveTrick(trickOf(num('shadow', 13), special('master'), num('shadow', 12)));
    expect(r).toMatchObject({ winner: 1, reason: 'master', bonus: 0 });
  });

  it('first master wins among masters', () => {
    const r = resolveTrick(trickOf(num('fire', 3), special('master', 2), special('master', 1)));
    expect(r).toMatchObject({ winner: 1, reason: 'master' });
  });

  it('a geisha beats numbered cards; first geisha wins among geishas', () => {
    const r = resolveTrick(trickOf(num('shadow', 13), special('geisha', 2), special('geisha', 1)));
    expect(r).toMatchObject({ winner: 1, reason: 'geisha', bonus: 0 });
  });

  it('a master beats a geisha and earns +20 per geisha', () => {
    expect(resolveTrick(trickOf(special('geisha'), special('master')))).toMatchObject({
      winner: 1,
      reason: 'master',
      bonus: 20,
    });
    const two = resolveTrick(trickOf(special('geisha', 1), special('master'), special('geisha', 2)));
    expect(two).toMatchObject({ winner: 1, bonus: 40 });
  });

  it('the shogun beats masters and earns +30 per master', () => {
    const r = resolveTrick(trickOf(special('master', 1), special('shogun'), special('master', 2)));
    expect(r).toMatchObject({ winner: 1, reason: 'shogun', bonus: 60 });
  });

  it('the shogun beats numbered cards with no bonus', () => {
    const r = resolveTrick(trickOf(num('shadow', 13), special('shogun')));
    expect(r).toMatchObject({ winner: 1, reason: 'shogun', bonus: 0 });
  });

  it('a geisha kills the shogun for +40, whichever came first', () => {
    expect(resolveTrick(trickOf(special('shogun'), special('geisha')))).toMatchObject({
      winner: 1,
      reason: 'geishaKillsShogun',
      bonus: 40,
    });
    expect(resolveTrick(trickOf(special('geisha'), special('shogun')))).toMatchObject({ winner: 0, bonus: 40 });
  });

  it('geisha, master and shogun together: geisha wins and only her +40 is paid', () => {
    const r = resolveTrick(trickOf(special('master'), special('shogun'), special('geisha'), num('fire', 5)));
    expect(r).toMatchObject({ winner: 2, reason: 'geishaKillsShogun', bonus: 40 });
  });

  it('first geisha takes the shogun when both geishas are played', () => {
    const r = resolveTrick(trickOf(special('geisha', 2), special('shogun'), special('geisha', 1)));
    expect(r).toMatchObject({ winner: 0, bonus: 40 });
  });
});

describe('resolveTrick: Kitsune', () => {
  it('as a master it wins like one and collects the geisha bonus', () => {
    const r = resolveTrick(trickOf(special('geisha'), [kitsune, 'master'], num('shadow', 13)));
    expect(r).toMatchObject({ winner: 1, reason: 'master', bonus: 20 });
  });

  it('as a master it yields to an earlier master', () => {
    const r = resolveTrick(trickOf(special('master'), [kitsune, 'master']));
    expect(r).toMatchObject({ winner: 0 });
  });

  it('as a master it gives the shogun +30', () => {
    const r = resolveTrick(trickOf([kitsune, 'master'], special('shogun')));
    expect(r).toMatchObject({ winner: 1, reason: 'shogun', bonus: 30 });
  });

  it('as a smoke bomb it loses and gives the shogun nothing', () => {
    const r = resolveTrick(trickOf([kitsune, 'smokeBomb'], special('shogun')));
    expect(r).toMatchObject({ winner: 1, reason: 'shogun', bonus: 0 });
    expect(resolveTrick(trickOf(num('fire', 1), [kitsune, 'smokeBomb']))).toMatchObject({ winner: 0 });
  });

  it('cannot be resolved without a declared mode', () => {
    expect(() => resolveTrick([{ player: 0, card: kitsune }])).toThrow();
  });
});

describe('resolveTrick: 14 bonuses', () => {
  it('+10 per standard 14 and +20 for the shadow 14, own cards included', () => {
    const r = resolveTrick(trickOf(num('fire', 14), num('water', 14), num('shadow', 14)));
    expect(r).toMatchObject({ winner: 2, bonus: 40 });
    expect(resolveTrick(trickOf(num('fire', 14), num('fire', 2)))).toMatchObject({ winner: 0, bonus: 10 });
  });

  it('14s captured by a special still count, on top of the capture bonus', () => {
    const r = resolveTrick(trickOf(num('shadow', 14), special('master'), special('shogun')));
    expect(r).toMatchObject({ winner: 2, bonus: 50 });
  });
});
