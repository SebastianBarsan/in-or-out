-- A turn nobody opens no longer stalls the game. The 10-second clocks only start once a player
-- opens their turn, so a player who walks away used to leave the other one waiting forever.
-- Now, if a turn sits unopened for 2 minutes, the server plays it as a timeout: an idle setter
-- gets a random question and prediction, and an idle answerer is caught.
--
-- `saved_at` marks when the game last changed. While no clock is running, that is when the
-- current turn arrived.

alter table h2h_private.games add column saved_at timestamptz not null default now();

create function h2h_private.idle_seconds() returns int language sql immutable as 'select 120';

create or replace function h2h_private.save(g h2h_private.games) returns void
language sql volatile as $$
  update h2h_private.games set
    guest_token = g.guest_token,
    guest_name = g.guest_name,
    status = g.status,
    setter = g.setter,
    turn = g.turn,
    pool = g.pool,
    turns_left = g.turns_left,
    choices = g.choices,
    question_id = g.question_id,
    prediction = g.prediction,
    deadline = g.deadline,
    pending_catch = g.pending_catch,
    sudden_death = g.sudden_death,
    winner = g.winner,
    history = g.history,
    rematch_id = g.rematch_id,
    saved_at = now()
  where id = g.id
$$;

create or replace function h2h_private.load(p_game uuid) returns h2h_private.games
language plpgsql volatile as $$
declare
  g h2h_private.games;
  idle boolean;
begin
  select * into g from h2h_private.games where id = p_game for update;
  if not found then
    raise exception 'Game not found';
  end if;
  idle := g.deadline is null and g.saved_at < now() - make_interval(secs => h2h_private.idle_seconds());
  if (g.deadline is not null and g.deadline < now()) or idle then
    if g.status = 'answering' then
      g := h2h_private.resolve_turn(g, null);
      perform h2h_private.save(g);
    elsif g.status = 'choosing' then
      g := h2h_private.auto_lock(g);
      perform h2h_private.save(g);
    end if;
  end if;
  return g;
end;
$$;

revoke all on function h2h_private.idle_seconds() from public;
