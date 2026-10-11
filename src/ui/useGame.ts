import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { chooseBid, choosePlay, type Level } from '../ai/bots';
import { sfx } from '../app/audio';
import { scaled } from '../app/speed';
import { clearSavedGame, saveGame } from '../app/storage';
import type { Pause } from './Table';
import {
  applyAction,
  createGame,
  createRng,
  legalPlays,
  randomFirstPlayer,
  playerView,
  type GameState,
  type KitsuneMode,
} from '../engine';

export const HUMAN = 0;

export interface Settings {
  bots: number;
  level: Level;
  seed: number;
}

const BOT_DELAY = 750;
const REVEAL_PAUSE = 1500;
const TRICK_PAUSE = 2000;

interface Options {
  /** A saved game to resume instead of dealing a new one. */
  initial?: GameState;
  /** While true the table freezes: bots wait and pauses do not run out. */
  held?: boolean;
}

export function useGame(settings: Settings, { initial, held = false }: Options = {}) {
  const [game, setGame] = useState<GameState>(
    () =>
      initial ??
      createGame({
        playerCount: settings.bots + 1,
        seed: settings.seed,
        firstPlayer: randomFirstPlayer(settings.seed, settings.bots + 1),
      }).state,
  );
  const [pause, setPause] = useState<Pause | null>(null);
  // Resumed games get a fresh stream so bots do not replay the same choices.
  const rng = useRef(createRng(settings.seed ^ 0x0b075 ^ (initial ? Date.now() : 0))).current;

  useEffect(() => {
    if (game.phase === 'gameOver') clearSavedGame();
    else saveGame({ settings, game });
  }, [game, settings]);

  const play = useCallback((state: GameState, player: number, cardId: string, as?: KitsuneMode) => {
    const { state: next, events } = applyAction(state, { type: 'play', player, cardId, as });
    setGame(next);
    sfx('card');
    for (const event of events) {
      if (event.type === 'trickWon') setPause({ kind: 'trick', trick: event.trick, result: event.result });
    }
  }, []);

  // The result is announced once the last card has landed.
  useEffect(() => {
    if (pause?.kind !== 'trick') return;
    const { winner, bonus } = pause.result;
    const id = setTimeout(() => sfx(bonus > 0 ? 'capture' : winner === HUMAN ? 'win' : 'trick'), scaled(350));
    return () => clearTimeout(id);
  }, [pause]);

  useEffect(() => {
    if (!pause || held) return;
    const id = setTimeout(() => setPause(null), scaled(pause.kind === 'trick' ? TRICK_PAUSE : REVEAL_PAUSE));
    return () => clearTimeout(id);
  }, [pause, held]);

  const myTurn = !pause && game.phase === 'playing' && game.currentPlayer === HUMAN;
  useEffect(() => {
    if (myTurn) sfx('turn');
  }, [myTurn]);

  useEffect(() => {
    const player = game.currentPlayer;
    if (held || pause || game.phase !== 'playing' || player === null || player === HUMAN) return;
    const id = setTimeout(() => {
      const { card, as } = choosePlay(playerView(game, player), settings.level, rng);
      play(game, player, card.id, as);
    }, scaled(BOT_DELAY));
    return () => clearTimeout(id);
  }, [game, held, pause, play, rng, settings.level]);

  const placeBid = useCallback(
    (bid: number) => {
      if (game.phase !== 'bidding' || game.bids[HUMAN] !== null) return;
      let state = game;
      for (let player = 1; player < game.config.playerCount; player++) {
        const botBid = chooseBid(playerView(game, player), settings.level, rng);
        state = applyAction(state, { type: 'bid', player, bid: botBid }).state;
      }
      state = applyAction(state, { type: 'bid', player: HUMAN, bid }).state;
      setGame(state);
      setPause({ kind: 'reveal' });
      sfx('reveal');
    },
    [game, rng, settings.level],
  );

  const playCard = useCallback(
    (cardId: string, as?: KitsuneMode) => {
      if (pause || game.phase !== 'playing' || game.currentPlayer !== HUMAN) return;
      play(game, HUMAN, cardId, as);
    },
    [game, pause, play],
  );

  const nextRound = useCallback(() => {
    if (game.phase === 'roundEnd') setGame(applyAction(game, { type: 'nextRound' }).state);
  }, [game]);

  const legalIds = useMemo(
    () => new Set(pause ? [] : legalPlays(game, HUMAN).map((c) => c.id)),
    [game, pause],
  );

  return { game, pause, legalIds, placeBid, playCard, nextRound };
}
