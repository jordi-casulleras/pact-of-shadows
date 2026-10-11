import { handle, userOf, type Push } from './handler.js';
import { PUSH_EVENT } from './protocol.js';
import { secretHeaders, SupabaseStore } from './store.js';

// The Supabase Edge Function that is the game server: `npm run build:fn` bundles this file into
// supabase/functions/room/index.ts. It runs on Deno, which this project's tsconfig does not know.
declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { ...CORS, 'Cache-Control': 'no-store' } });

/** The project's secret key: the newer named keys if the project has them, else the legacy service_role key. */
function secretKey(): string | undefined {
  try {
    const named = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, unknown>;
    if (typeof named.default === 'string') return named.default;
  } catch {
    // Not set, or not JSON: fall through to the legacy key.
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
}

const url = Deno.env.get('SUPABASE_URL');
const key = secretKey();
const store = url && key ? new SupabaseStore(url, key) : null;

/** Realtime Broadcast over REST: one request carries every player's view. */
const push: Push = async (messages) => {
  const res = await fetch(`${url}/realtime/v1/api/broadcast`, {
    method: 'POST',
    headers: { ...secretHeaders(key!), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: messages.map((m) => ({ topic: m.topic, event: PUSH_EVENT, payload: m.payload, private: true })),
    }),
  });
  if (!res.ok) throw new Error(`Realtime ${res.status}: ${await res.text()}`);
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return json({ ok: false, error: 'badRequest' }, 405);
  if (!store) {
    console.error('SUPABASE_URL or the secret key is missing from the function environment.');
    return json({ ok: false, error: 'storage' }, 503);
  }
  // Players are who their session says they are, never who the request body claims.
  const user = userOf(request.headers.get('Authorization'));
  if (!user) return json({ ok: false, error: 'auth' }, 401);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'badRequest' }, 400);
  }
  if (!body || typeof body !== 'object') return json({ ok: false, error: 'badRequest' }, 400);
  return json(await handle({ ...body, token: user }, store, Date.now(), push));
});
