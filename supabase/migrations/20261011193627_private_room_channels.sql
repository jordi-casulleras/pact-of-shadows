-- Each player's views are pushed on the private Realtime topic room:<code>:<user id>.
-- A signed-in user may listen to the topics that end in their own id, and to nothing else.
-- There is no insert policy: only the server (secret key) can send.
create policy "players listen to their own room topic"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and split_part((select realtime.topic()), ':', 1) = 'room'
    and split_part((select realtime.topic()), ':', 3) = (select auth.uid())::text
  );
