-- The pool now holds every question, sorted by answer count. Each turn draws from its own slice
-- of that order, biggest questions first, so the choices in a turn are about the same size and
-- get smaller as the game goes on. The pool no longer sets the game's length, so turns are
-- counted apart.

alter table h2h_private.games add column turns_left int;
update h2h_private.games set turns_left = cardinality(pool);
alter table h2h_private.games alter column turns_left set not null;

create function h2h_private.game_turns() returns int language sql immutable as 'select 10';

drop function h2h_private.draw_choices(text[]);

-- Up to 3 random questions from this turn's slice of the pool. Slices don't overlap, so
-- passed-over questions don't come straight back, and a pool too small to slice still offers 3.
create function h2h_private.draw_choices(p_pool text[], p_turns_left int, p_turn int) returns text[]
language plpgsql volatile as $$
declare
  size int := cardinality(p_pool);
  total int := p_turns_left + p_turn - 1;
  high int := greatest(size * p_turns_left / total, least(3, size));
  low int := greatest(1, least(size * (p_turns_left - 1) / total + 1, high - 2));
begin
  return (
    select coalesce(array_agg(q), '{}')
    from (select q from unnest(p_pool[low:high]) as q order by random() limit 3) picked
  );
end;
$$;

revoke all on function h2h_private.game_turns() from public;
revoke all on function h2h_private.draw_choices(text[], int, int) from public;

create or replace function h2h_private.game_view(g h2h_private.games, p_token uuid) returns jsonb
language plpgsql stable as $$
declare
  me text := h2h_private.role_of(g, p_token);
  is_setter boolean := me is not null and me = g.setter and g.status in ('choosing', 'answering');
  is_answerer boolean := me is not null and me <> g.setter and g.status = 'answering';
begin
  if me is null then
    return jsonb_build_object(
      'id', g.id,
      'status', g.status,
      'you', null,
      'hostName', g.host_name
    );
  end if;
  return jsonb_build_object(
    'id', g.id,
    'status', g.status,
    'you', me,
    'hostName', g.host_name,
    'guestName', g.guest_name,
    'setter', g.setter,
    'turn', g.turn,
    'poolSize', g.turns_left,
    'suddenDeath', g.sudden_death,
    'winner', g.winner,
    'history', g.history,
    'rematchId', g.rematch_id,
    'choices', case when is_setter and g.status = 'choosing' then to_jsonb(g.choices) else '[]'::jsonb end,
    'questionId', case
      when is_setter and g.status = 'answering' then to_jsonb(g.question_id)
      when is_answerer and g.deadline is not null then to_jsonb(g.question_id)
      else 'null'::jsonb
    end,
    'prediction', case when is_setter and g.status = 'answering' then to_jsonb(g.prediction) else 'null'::jsonb end,
    -- True while the answerer has the question open. The clock itself goes only to them.
    'answering', g.status = 'answering' and g.deadline is not null,
    'msLeft', case
      when is_answerer and g.deadline is not null then to_jsonb(greatest(
        0,
        floor(extract(epoch from g.deadline - now()) * 1000 - h2h_private.grace_seconds() * 1000)
      ))
      else 'null'::jsonb
    end
  );
end;
$$;

create or replace function h2h_private.resolve_turn(g h2h_private.games, p_answer text) returns h2h_private.games
language plpgsql volatile as $$
declare
  caught boolean := p_answer is null or p_answer = g.prediction;
  is_reply_slot boolean := g.turn % 2 = 0;
  outcome text := 'continue';
begin
  if g.sudden_death then
    if caught then
      g.winner := g.setter;
      outcome := 'win';
    end if;
  elsif caught and not is_reply_slot then
    g.pending_catch := true;
    outcome := 'reply';
  elsif caught and g.pending_catch then
    g.pending_catch := false;
    g.sudden_death := true;
    outcome := 'sudden-death';
  elsif caught then
    g.winner := g.setter;
    outcome := 'win';
  elsif is_reply_slot and g.pending_catch then
    g.pending_catch := false;
    g.winner := g.first_setter;
    outcome := 'win';
  end if;

  -- Running out of turns ends the game. A catch with no turn left to reply on still stands.
  if g.winner is null and g.turns_left = 0 then
    if g.pending_catch then
      g.winner := g.first_setter;
      outcome := 'win';
    else
      outcome := 'draw';
    end if;
    g.status := 'finished';
  end if;

  g.history := g.history || jsonb_build_object(
    'turn', g.turn,
    'setter', g.setter,
    'questionId', g.question_id,
    'prediction', g.prediction,
    'answer', p_answer,
    'caught', caught,
    'outcome', outcome
  );
  g.question_id := null;
  g.prediction := null;
  g.deadline := null;
  g.choices := '{}';

  if g.winner is not null then
    g.status := 'finished';
  elsif g.status <> 'finished' then
    g.status := 'choosing';
    g.turn := g.turn + 1;
    g.setter := h2h_private.other(g.setter);
    g.choices := h2h_private.draw_choices(g.pool, g.turns_left, g.turn);
  end if;
  return g;
end;
$$;

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
    rematch_id = g.rematch_id
  where id = g.id
$$;

create or replace function public.h2h_create_game(p_name text, p_pool text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g h2h_private.games;
begin
  if cardinality(p_pool) is null or cardinality(p_pool) not between 1 and 200 then
    raise exception 'Invalid question pool';
  end if;
  insert into h2h_private.games (host_name, pool, turns_left)
  values (h2h_private.clean_name(p_name), p_pool, least(cardinality(p_pool), h2h_private.game_turns()))
  returning * into g;
  return jsonb_build_object('id', g.id, 'token', g.host_token);
end;
$$;

create or replace function public.h2h_join_game(p_game uuid, p_name text) returns jsonb
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
  return jsonb_build_object('id', g.id, 'token', g.guest_token);
end;
$$;

create or replace function public.h2h_lock_prediction(
  p_game uuid, p_token uuid, p_turn int, p_question text, p_prediction text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g h2h_private.games := h2h_private.load(p_game);
begin
  if h2h_private.role_of(g, p_token) is null then
    raise exception 'Not a player in this game';
  end if;
  if g.status = 'choosing' and g.turn = p_turn then
    if h2h_private.role_of(g, p_token) <> g.setter then
      raise exception 'Not your turn to set';
    end if;
    if not p_question = any(g.choices) then
      raise exception 'That question is not one of your choices';
    end if;
    if p_prediction is null or p_prediction = '' then
      raise exception 'A prediction is required';
    end if;
    g.question_id := p_question;
    g.prediction := p_prediction;
    g.pool := array_remove(g.pool, p_question);
    g.turns_left := g.turns_left - 1;
    g.choices := '{}';
    g.status := 'answering';
    perform h2h_private.save(g);
  end if;
  return h2h_private.game_view(g, p_token);
end;
$$;

create or replace function public.h2h_rematch(p_game uuid, p_token uuid, p_pool text[]) returns jsonb
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
    if cardinality(p_pool) is null or cardinality(p_pool) not between 1 and 200 then
      raise exception 'Invalid question pool';
    end if;
    next_first := h2h_private.other(g.first_setter);
    turns := least(cardinality(p_pool), h2h_private.game_turns());
    insert into h2h_private.games (
      host_token, guest_token, host_name, guest_name, status, first_setter, setter, turn, pool, turns_left, choices
    ) values (
      g.host_token, g.guest_token, g.host_name, g.guest_name, 'choosing', next_first, next_first, 1, p_pool, turns,
      h2h_private.draw_choices(p_pool, turns, 1)
    ) returning id into fresh;
    g.rematch_id := fresh;
    perform h2h_private.save(g);
  end if;
  return jsonb_build_object('id', g.rematch_id);
end;
$$;
