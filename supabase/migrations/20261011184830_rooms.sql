-- Multiplayer rooms. Each row is the whole server-side room, including every hand and
-- every player's token, so nothing but the Edge Function (secret key) may touch it.
create table public.rooms (
  code text primary key,
  version integer not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create index rooms_updated_at_idx on public.rooms (updated_at);

-- Row level security with no policies: the publishable key can neither read nor write.
alter table public.rooms enable row level security;
revoke all on public.rooms from anon, authenticated;
