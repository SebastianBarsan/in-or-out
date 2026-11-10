-- Private head-to-head stats. Every finished game adds one row to stats_private.h2h_games,
-- written by a trigger on the game table, so timeouts and walk-aways count too and no browser
-- can add, change or read a row. Each player's random browser ID is stored alongside, the same
-- one Solo rounds use, so both modes line up per player.

alter table h2h_private.games
  add column host_player_id uuid,
  add column guest_player_id uuid,
  add column host_country text,
  add column guest_country text,
  -- When the second player arrived, so the game's length leaves out the wait in the lobby.
  add column joined_at timestamptz;

create table stats_private.h2h_games (
  id bigint generated always as identity primary key,
  game_id uuid not null unique,
  -- The game this one is a rematch of, if any.
  rematch_of uuid,
  started_at timestamptz,
  finished_at timestamptz not null default now(),
  duration_ms int,
  host_player_id uuid,
  guest_player_id uuid,
  host_name text not null,
  guest_name text,
  first_setter text not null,
  result text not null check (result in ('host', 'guest', 'draw')),
  winner_name text,
  winner_player_id uuid,
  turns_played int not null,
  sudden_death boolean not null,
  catches int not null,
  -- Answers that never came: the clock ran out or the turn sat idle.
  timeouts int not null,
  history jsonb not null,
  host_country text,
  guest_country text
);

alter table stats_private.h2h_games enable row level security;
revoke all on stats_private.h2h_games from public;

create index h2h_games_finished_at_idx on stats_private.h2h_games (finished_at desc);
create index h2h_games_host_player_idx on stats_private.h2h_games (host_player_id);
create index h2h_games_guest_player_idx on stats_private.h2h_games (guest_player_id);

create function stats_private.log_h2h_game() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  started timestamptz := coalesce(new.joined_at, new.created_at);
begin
  insert into stats_private.h2h_games (
    game_id, rematch_of, started_at, duration_ms, host_player_id, guest_player_id, host_name,
    guest_name, first_setter, result, winner_name, winner_player_id, turns_played, sudden_death,
    catches, timeouts, history, host_country, guest_country
  ) values (
    new.id,
    (select g.id from h2h_private.games g where g.rematch_id = new.id limit 1),
    started,
    least(floor(extract(epoch from now() - started) * 1000), 2147483647)::int,
    new.host_player_id,
    new.guest_player_id,
    new.host_name,
    new.guest_name,
    new.first_setter,
    coalesce(new.winner, 'draw'),
    case new.winner when 'host' then new.host_name when 'guest' then new.guest_name end,
    case new.winner when 'host' then new.host_player_id when 'guest' then new.guest_player_id end,
    jsonb_array_length(new.history),
    new.sudden_death,
    (select count(*) from jsonb_array_elements(new.history) t where (t ->> 'caught')::boolean),
    (select count(*) from jsonb_array_elements(new.history) t where t -> 'answer' = 'null'::jsonb),
    new.history,
    new.host_country,
    new.guest_country
  )
  on conflict (game_id) do nothing;
  return null;
end;
$$;

create trigger log_finished_game
after update of status on h2h_private.games
for each row
when (old.status <> 'finished' and new.status = 'finished')
execute function stats_private.log_h2h_game();

revoke all on function stats_private.log_h2h_game() from public;

-- Create and join now take the browser's player ID. It's optional, so an older tab still works.

drop function public.h2h_create_game(text, text[], jsonb);

create function public.h2h_create_game(
  p_name text, p_pool text[], p_answers jsonb, p_player uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g h2h_private.games;
begin
  perform h2h_private.check_setup(p_pool, p_answers);
  insert into h2h_private.games (host_name, pool, answers, turns_left, host_player_id, host_country)
  values (
    h2h_private.clean_name(p_name), p_pool, p_answers, least(cardinality(p_pool), h2h_private.game_turns()),
    p_player, stats_private.clip(stats_private.header('cf-ipcountry'), 2)
  )
  returning * into g;
  return jsonb_build_object('id', g.id, 'token', g.host_token);
end;
$$;

drop function public.h2h_join_game(uuid, text);

create function public.h2h_join_game(p_game uuid, p_name text, p_player uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g h2h_private.games := h2h_private.load(p_game);
begin
  if g.status <> 'lobby' then
    raise exception 'This game already has two players';
  end if;
  g.guest_name := h2h_private.clean_name(p_name);
  g.guest_token := gen_random_uuid();
  g.status := 'choosing';
  g.turn := 1;
  g.choices := h2h_private.draw_choices(g.pool, g.turns_left, g.turn);
  perform h2h_private.save(g);
  -- save() writes only the gameplay columns, so the stats columns are set here.
  update h2h_private.games set
    guest_player_id = p_player,
    guest_country = stats_private.clip(stats_private.header('cf-ipcountry'), 2),
    joined_at = now()
  where id = g.id;
  return jsonb_build_object('id', g.id, 'token', g.guest_token);
end;
$$;

-- Same as before, but a rematch carries over both players' IDs and countries.
create or replace function public.h2h_rematch(p_game uuid, p_token uuid, p_pool text[], p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g h2h_private.games := h2h_private.load(p_game);
  next_first text;
  turns int;
  fresh uuid;
begin
  if h2h_private.role_of(g, p_token) is null then
    raise exception 'Not a player in this game';
  end if;
  if g.status <> 'finished' then
    raise exception 'This game is still going';
  end if;
  if g.rematch_id is null then
    perform h2h_private.check_setup(p_pool, p_answers);
    next_first := h2h_private.other(g.first_setter);
    turns := least(cardinality(p_pool), h2h_private.game_turns());
    insert into h2h_private.games (
      host_token, guest_token, host_name, guest_name, status, first_setter, setter, turn, pool, answers, turns_left, choices,
      host_player_id, guest_player_id, host_country, guest_country, joined_at
    ) values (
      g.host_token, g.guest_token, g.host_name, g.guest_name, 'choosing', next_first, next_first, 1, p_pool, p_answers, turns,
      h2h_private.draw_choices(p_pool, turns, 1),
      g.host_player_id, g.guest_player_id, g.host_country, g.guest_country, now()
    ) returning id into fresh;
    g.rematch_id := fresh;
    perform h2h_private.save(g);
  end if;
  return jsonb_build_object('id', g.rematch_id);
end;
$$;

revoke execute on function
  public.h2h_create_game(text, text[], jsonb, uuid),
  public.h2h_join_game(uuid, text, uuid)
from public;
grant execute on function
  public.h2h_create_game(text, text[], jsonb, uuid),
  public.h2h_join_game(uuid, text, uuid)
to anon, authenticated;
