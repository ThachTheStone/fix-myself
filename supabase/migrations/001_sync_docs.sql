-- Fix Myself: one synced plan document per account (SYS-02, SYS-06).
-- Paste into the Supabase SQL Editor once per project. Safe to run again.
-- See docs/SUPABASE.md.

create table if not exists public.sync_docs (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  payload    jsonb not null,               -- the fix-myself-sync payload
  rev        bigint not null default 1,    -- bumped on every write
  updated_at timestamptz not null default now(),
  constraint sync_docs_payload_size check (octet_length(payload::text) <= 5 * 1024 * 1024)
);

alter table public.sync_docs enable row level security;

drop policy if exists sync_docs_own_select on public.sync_docs;
create policy sync_docs_own_select on public.sync_docs
  for select using (user_id = auth.uid());

drop policy if exists sync_docs_own_delete on public.sync_docs;
create policy sync_docs_own_delete on public.sync_docs
  for delete using (user_id = auth.uid());

-- Writes go only through push_sync_doc, so every write is a compare-and-swap
-- on rev: a device that read an older rev must merge again instead of
-- overwriting another device's changes.
revoke insert, update on public.sync_docs from anon, authenticated;

create or replace function public.push_sync_doc(expected_rev bigint, new_payload jsonb)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  next_rev bigint;
begin
  if me is null then
    raise exception 'not signed in';
  end if;
  if expected_rev = 0 then
    insert into public.sync_docs (user_id, payload, rev)
    values (me, new_payload, 1)
    on conflict (user_id) do nothing
    returning rev into next_rev;
  else
    update public.sync_docs
       set payload = new_payload, rev = rev + 1, updated_at = now()
     where user_id = me and rev = expected_rev
    returning rev into next_rev;
  end if;
  return next_rev; -- null means another device wrote first: read, merge, retry
end;
$$;

revoke all on function public.push_sync_doc(bigint, jsonb) from public, anon;
grant execute on function public.push_sync_doc(bigint, jsonb) to authenticated;

-- Other devices learn about a write through Realtime.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sync_docs'
  ) then
    alter publication supabase_realtime add table public.sync_docs;
  end if;
end;
$$;
