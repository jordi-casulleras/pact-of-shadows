import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { captchaToken } from './captcha';
import {
  PUSH_EVENT,
  topicFor,
  type ApiErrorCode,
  type ApiRequest,
  type ApiResponse,
  type RoomPush,
  type RoomView,
} from './protocol.js';

const BASE = import.meta.env.VITE_SUPABASE_URL as string | undefined;
/** Safe to ship: it grants nothing by itself, the rooms table is closed to it. */
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export class ApiError extends Error {
  constructor(readonly code: ApiErrorCode | 'network') {
    super(code);
    this.name = 'ApiError';
  }
}

let client: SupabaseClient | null = null;
/** The session is kept in this browser's storage: it is what lets a reload return to the same seat. */
const supabase = () => (client ??= createClient(BASE!, KEY!, { auth: { detectSessionInUrl: false } }));

let signingIn: Promise<Session> | null = null;

/**
 * This browser's session, signing in as a new anonymous user the first time. Nobody registers:
 * the user only exists so the server knows which seat is whose, and so that only browsers
 * that passed the captcha can reach it at all.
 */
async function session(): Promise<Session> {
  if (!BASE || !KEY) throw new ApiError('storage');
  const { data } = await supabase().auth.getSession();
  if (data.session) return data.session;
  signingIn ??= (async () => {
    try {
      const token = await captchaToken();
      const { data, error } = await supabase().auth.signInAnonymously(token ? { options: { captchaToken: token } } : undefined);
      if (error || !data.session) throw error ?? new Error('no session');
      return data.session;
    } catch (e) {
      console.warn('Could not sign in', e);
      throw new ApiError('auth');
    } finally {
      signingIn = null;
    }
  })();
  return signingIn;
}

type Without<T, K extends string> = T extends unknown ? Omit<T, K> : never;

/** Sends one request to the room function. Resolves with the room (null once left); rejects with an ApiError. */
export async function api(request: Without<ApiRequest, 'token'>): Promise<RoomView | null> {
  const { access_token } = await session();
  let status: number;
  let body: ApiResponse;
  try {
    const res = await fetch(`${BASE}/functions/v1/room`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: KEY!, Authorization: `Bearer ${access_token}` },
      body: JSON.stringify(request),
    });
    status = res.status;
    body = (await res.json()) as ApiResponse;
  } catch {
    throw new ApiError('network');
  }
  if (status === 401) {
    // The session is no longer good (its user was removed, say): forget it, the next try signs in afresh.
    await supabase().auth.signOut({ scope: 'local' });
    throw new ApiError('auth');
  }
  if (!body.ok) throw new ApiError(typeof body.error === 'string' ? body.error : 'storage');
  return body.room;
}

/**
 * Listens for the views the server pushes to this browser for one room. `onJoined` fires every
 * time the connection is (re)established: pushes sent before that moment were missed.
 * Returns the function that stops listening.
 */
export function subscribe(code: string, onPush: (push: RoomPush) => void, onJoined: () => void): () => void {
  let stopped = false;
  let leave = () => {};
  void (async () => {
    const { user } = await session();
    // The channel is private: Realtime needs the session to check this user may listen to it.
    await supabase().realtime.setAuth();
    if (stopped) return;
    const channel = supabase()
      .channel(topicFor(code, user.id), { config: { private: true } })
      .on('broadcast', { event: PUSH_EVENT }, ({ payload }) => onPush(payload as RoomPush))
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') onJoined();
      });
    leave = () => void supabase().removeChannel(channel);
  })().catch(() => {
    // Without pushes the room still catches up on every heartbeat.
  });
  return () => {
    stopped = true;
    leave();
  };
}
