-- Private play stats. Every finished Solo round adds one row. Browsers can add rows through
-- stats_log_round but can't read anything back: the table sits in a schema the API doesn't expose.
-- To look at it, open the Table Editor in the Supabase dashboard and pick the stats_private schema.

create schema if not exists stats_private;
revoke all on schema stats_private from public;

create table stats_private.rounds (
  id bigint generated always as identity primary key,
  played_at timestamptz not null default now(),
  -- Random per browser, so the same person is one player until they clear their data.
  player_id uuid not null,
  -- The name they last typed for head-to-head, if any.
  nickname text,
  mode text not null check (mode in ('solo')),
  outcome text not null check (outcome in ('in', 'out')),
  -- Refreshed or closed mid-round, which counts as an OUT.
  abandoned boolean not null default false,
  streak int not null,
  best_streak int not null,
  questions_answered int not null,
  timed_out boolean not null,
  duration_ms int,
  turns jsonb not null,
  -- From the browser.
  language text,
  timezone text,
  local_hour int,
  screen text,
  viewport text,
  touch boolean,
  dark_mode boolean,
  referrer text,
  ref text,
  -- From the request itself. Country only: the IP address is never stored.
  user_agent text,
  country text
);

alter table stats_private.rounds enable row level security;
revoke all on stats_private.rounds from public;

create index rounds_player_idx on stats_private.rounds (player_id);
create index rounds_played_at_idx on stats_private.rounds (played_at desc);

-- One row per player, for a quick look at who's doing best. Also visible in the Table Editor.
create view stats_private.players as
select
  r.player_id,
  (array_agg(r.nickname order by r.played_at desc) filter (where r.nickname is not null))[1] as nickname,
  count(*) as rounds,
  count(*) filter (where r.outcome = 'in') as wins,
  max(r.best_streak) as best_streak,
  -- How obscure their answers are on average: 0 = most common, 1 = most obscure.
  (
    select round(avg((t ->> 'rank')::numeric), 3)
    from stats_private.rounds r2, jsonb_array_elements(r2.turns) as t
    where r2.player_id = r.player_id and jsonb_typeof(t -> 'rank') = 'number'
  ) as avg_niche,
  min(r.played_at) as first_played,
  max(r.played_at) as last_played,
  (array_agg(r.country order by r.played_at desc) filter (where r.country is not null))[1] as country
from stats_private.rounds r
group by r.player_id;

revoke all on stats_private.players from public;

-- Shortens text a caller sends, so nobody can fill the table with huge strings.
create function stats_private.clip(p_value text, p_max int) returns text
language sql immutable as $$
  select nullif(left(btrim(p_value), p_max), '')
$$;

create function stats_private.header(p_name text) returns text
language sql stable as $$
  select (nullif(current_setting('request.headers', true), '')::jsonb) ->> p_name
$$;

create function public.stats_log_round(p_round jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  turns jsonb := p_round -> 'turns';
begin
  if octet_length(p_round::text) > 20000 then
    raise exception 'Round too large';
  end if;
  if jsonb_typeof(turns) <> 'array' or jsonb_array_length(turns) > 50 then
    raise exception 'Invalid turns';
  end if;

  insert into stats_private.rounds (
    player_id, nickname, mode, outcome, abandoned, streak, best_streak, questions_answered,
    timed_out, duration_ms, turns, language, timezone, local_hour, screen, viewport, touch,
    dark_mode, referrer, ref, user_agent, country
  ) values (
    (p_round ->> 'playerId')::uuid,
    stats_private.clip(p_round ->> 'nickname', 20),
    p_round ->> 'mode',
    p_round ->> 'outcome',
    coalesce((p_round ->> 'abandoned')::boolean, false),
    least(greatest((p_round ->> 'streak')::int, 0), 100000),
    least(greatest((p_round ->> 'bestStreak')::int, 0), 100000),
    jsonb_array_length(turns),
    exists (select 1 from jsonb_array_elements(turns) t where t -> 'answer' = 'null'::jsonb),
    least(greatest((p_round ->> 'durationMs')::int, 0), 86400000),
    turns,
    stats_private.clip(p_round ->> 'language', 35),
    stats_private.clip(p_round ->> 'timezone', 64),
    case when (p_round ->> 'localHour')::int between 0 and 23 then (p_round ->> 'localHour')::int end,
    stats_private.clip(p_round ->> 'screen', 20),
    stats_private.clip(p_round ->> 'viewport', 20),
    (p_round ->> 'touch')::boolean,
    (p_round ->> 'darkMode')::boolean,
    stats_private.clip(p_round ->> 'referrer', 300),
    stats_private.clip(p_round ->> 'ref', 100),
    stats_private.clip(stats_private.header('user-agent'), 400),
    stats_private.clip(stats_private.header('cf-ipcountry'), 2)
  );
end;
$$;

revoke all on function public.stats_log_round(jsonb) from public;
grant execute on function public.stats_log_round(jsonb) to anon, authenticated;
