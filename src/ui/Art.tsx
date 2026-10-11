import type { Card } from '../engine';

/** Every illustration in src/assets/cards, by file name. `npm run art` makes them from the originals in art/. */
const IMAGES = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('../assets/cards/*.webp', { eager: true, query: '?url', import: 'default' }),
  ).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1, -'.webp'.length), url]),
);

/**
 * The illustration for a card. Numbered cards share their clan's. A special looks for its own
 * (`master-3`), then for one shared by its kind (`master`), then deals out whichever numbered
 * ones exist, so a kind may have one picture, one per card, or anything in between.
 */
function imageFor(card: Card | 'back'): string | undefined {
  if (card === 'back') return IMAGES.back;
  if (card.kind === 'number') return IMAGES[card.suit];
  const numbered = Object.keys(IMAGES)
    .filter((name) => name.startsWith(`${card.kind}-`))
    .sort();
  const copy = Number(card.id.split('-')[1] ?? 1) - 1;
  return IMAGES[card.id] ?? IMAGES[card.kind] ?? IMAGES[numbered[copy % numbered.length]];
}

export function Art({ card }: { card: Card | 'back' }) {
  const src = imageFor(card);
  // Without a picture the card still shows its clan colour, emblem and name.
  return src ? <img className="art" src={src} alt="" draggable={false} decoding="async" /> : null;
}
