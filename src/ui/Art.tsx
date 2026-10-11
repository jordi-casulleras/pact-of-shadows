import type { SpecialKind, Suit } from '../engine';

export type ArtKind = Suit | SpecialKind | 'back';

/**
 * Card illustrations, drawn as inline SVG. Each is a 100x100 drawing that takes
 * its main colour from `currentColor`; `.art-accent`, `.art-dark` and
 * `.art-light` are styled in CSS. Replace a case here to swap in new art.
 */
export function Art({ kind }: { kind: ArtKind }) {
  return (
    <svg className={`art art--${kind}`} viewBox="0 0 100 100" aria-hidden="true">
      {draw(kind)}
    </svg>
  );
}

function draw(kind: ArtKind) {
  switch (kind) {
    case 'fire':
      return (
        <>
          <path d="M50 6C58 26 80 38 76 64C73 82 61 94 50 94C37 94 24 82 24 64C24 50 34 44 37 28C44 36 46 42 48 48C51 36 46 22 50 6Z" />
          <path
            className="art-accent"
            d="M50 50C56 60 64 68 61 79C59 87 54 91 50 91C44 91 39 85 39 78C39 68 47 63 50 50Z"
          />
        </>
      );
    case 'water':
      return (
        <>
          <path d="M50 6C60 22 70 32 70 44A20 20 0 0 1 30 44C30 32 40 22 50 6Z" />
          <path className="art-accent" d="M42 44A8 8 0 0 0 50 54" fill="none" strokeWidth="4" strokeLinecap="round" />
          <g fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round">
            <path d="M8 74Q22 60 36 74T64 74T92 74" />
            <path d="M8 90Q22 76 36 90T64 90T92 90" opacity="0.6" />
          </g>
        </>
      );
    case 'forest':
      return (
        <>
          <rect className="art-dark" x="45" y="80" width="10" height="14" rx="2" />
          <path d="M50 6L70 34H60L78 58H66L88 84H12L34 58H22L40 34H30Z" />
          <path className="art-accent" d="M50 14L60 30H40ZM50 40L64 56H36ZM50 64L72 80H28Z" opacity="0.55" />
        </>
      );
    case 'shadow':
      return (
        <>
          <path d="M60 8A42 42 0 1 0 92 62A32 32 0 1 1 60 8Z" />
          <path className="art-accent" d="M72 24L76 36L88 40L76 44L72 56L68 44L56 40L68 36Z" />
        </>
      );
    case 'smokeBomb':
      return (
        <>
          <g className="art-light" opacity="0.75">
            <circle cx="30" cy="34" r="16" />
            <circle cx="52" cy="24" r="19" />
            <circle cx="72" cy="38" r="15" />
            <circle cx="46" cy="44" r="14" />
          </g>
          <circle className="art-dark" cx="50" cy="72" r="20" />
          <path className="art-dark" d="M46 50h8v8h-8z" />
          <path d="M50 50Q54 40 62 44" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          <circle className="art-accent" cx="63" cy="44" r="4" />
          <path className="art-light" d="M40 66A12 12 0 0 1 50 58" fill="none" strokeWidth="3" strokeLinecap="round" opacity="0.5" />
        </>
      );
    case 'master':
      return (
        <>
          <path className="art-accent" d="M78 40L96 30L92 42L98 52L80 50Z" />
          <path className="art-dark" d="M50 10C74 10 84 30 84 52C84 76 68 92 50 92C32 92 16 76 16 52C16 30 26 10 50 10Z" />
          <path className="art-light" d="M20 44Q50 30 80 44L80 58Q50 48 20 58Z" />
          <path className="art-dark" d="M30 50Q37 44 45 51Q37 54 30 50ZM70 50Q63 44 55 51Q63 54 70 50Z" />
          <path d="M18 36Q50 22 82 36L82 42Q50 28 18 42Z" />
        </>
      );
    case 'geisha':
      return (
        <>
          <path d="M50 90L4 52A60 60 0 0 1 96 52Z" />
          <g className="art-dark" fill="none" strokeWidth="2.5" opacity="0.55">
            <path d="M50 90L18 38M50 90L34 30M50 90L50 28M50 90L66 30M50 90L82 38" />
          </g>
          <path className="art-accent" d="M50 90L32 75A24 24 0 0 1 68 75Z" />
          <g className="art-light">
            <circle cx="50" cy="46" r="5" />
            <circle cx="42" cy="52" r="4" />
            <circle cx="58" cy="52" r="4" />
            <circle cx="45" cy="60" r="4" />
            <circle cx="55" cy="60" r="4" />
          </g>
          <circle className="art-dark" cx="50" cy="90" r="4" />
        </>
      );
    case 'shogun':
      return (
        <>
          <path className="art-accent" d="M42 30Q30 4 8 8Q24 16 30 38ZM58 30Q70 4 92 8Q76 16 70 38Z" />
          <path className="art-dark" d="M20 64Q20 26 50 22Q80 26 80 64Z" />
          <path d="M50 22V64M35 26Q32 44 32 64M65 26Q68 44 68 64" fill="none" stroke="currentColor" strokeWidth="2.5" opacity="0.7" />
          <path d="M12 62H88L96 82H4Z" />
          <path className="art-dark" d="M12 70H88M9 76H91" fill="none" strokeWidth="2" opacity="0.5" />
          <circle className="art-accent" cx="50" cy="26" r="8" />
          <path className="art-light" d="M30 82H70L62 94H38Z" opacity="0.85" />
        </>
      );
    case 'kitsune':
      return (
        <>
          <path className="art-light" d="M50 94L20 62L12 10L38 32Q50 26 62 32L88 10L80 62Z" />
          <path d="M16 16L32 32L20 40ZM84 16L68 32L80 40Z" />
          <path className="art-dark" d="M28 54Q38 46 46 56Q36 60 28 54ZM72 54Q62 46 54 56Q64 60 72 54Z" />
          <path className="art-dark" d="M45 82H55L50 90Z" />
          <path d="M50 36L54 46L50 52L46 46Z" />
          <path d="M24 66L36 70M76 66L64 70M26 74L37 75M74 74L63 75" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </>
      );
    case 'back':
      return (
        <>
          <circle cx="50" cy="50" r="34" fill="none" stroke="currentColor" strokeWidth="3" />
          <path d="M58 24A28 28 0 1 0 78 60A21 21 0 1 1 58 24Z" />
          <path d="M50 4L54 12L50 20L46 12ZM50 80L54 88L50 96L46 88ZM4 50L12 46L20 50L12 54ZM80 50L88 46L96 50L88 54Z" />
        </>
      );
  }
}
