import type { Card, KitsuneMode, SpecialKind, Suit } from '../engine';
import { useI18n, type Key } from '../i18n';
import { Art } from './Art';

/** Each clan and special has its own emblem so nothing is told apart by colour alone. */
const SUIT_GLYPH: Record<Suit, string> = { fire: '火', water: '水', forest: '木', shadow: '影' };
const SPECIAL_GLYPH: Record<SpecialKind, string> = {
  smokeBomb: '煙',
  master: '忍',
  geisha: '芸',
  shogun: '将',
  kitsune: '狐',
};

export function cardName(card: Card, t: (key: Key) => string): string {
  if (card.kind === 'number') return `${card.rank} · ${t(`suit.${card.suit}`)}`;
  return t(`card.${card.kind}`);
}

interface Props {
  card: Card;
  /** The Kitsune's declared mode, written in place of its name once it is on the table. */
  as?: KitsuneMode;
}

export function CardView({ card, as }: Props) {
  const { t } = useI18n();
  if (card.kind === 'number') {
    return (
      <div className={`card card--number card--${card.suit}`} data-card-id={card.id} aria-label={cardName(card, t)}>
        <span className="card__corner">
          <b>{card.rank}</b>
          <i>{SUIT_GLYPH[card.suit]}</i>
        </span>
        <Art kind={card.suit} />
        <span className="card__name">{t(`suit.${card.suit}`)}</span>
      </div>
    );
  }
  return (
    <div className={`card card--special card--${card.kind}`} data-card-id={card.id} aria-label={cardName(card, t)}>
      <span className="card__corner">
        <i>{SPECIAL_GLYPH[card.kind]}</i>
      </span>
      <Art kind={card.kind} />
      {as ? (
        <span className="card__name card__name--mode" data-testid="card-mode">
          <i>{SPECIAL_GLYPH[as]}</i> {t(`card.${as}`)}
        </span>
      ) : (
        <span className="card__name">{t(`card.${card.kind}`)}</span>
      )}
    </div>
  );
}

export function CardBack() {
  return (
    <div className="card card--back" aria-hidden="true">
      <Art kind="back" />
    </div>
  );
}
