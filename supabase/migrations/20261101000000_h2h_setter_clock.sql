-- The setter now has 10 seconds to pick a question, then 10 more to type a prediction. Whatever
-- is missing when a clock runs out gets filled in at random. The server does that itself, so a
-- closed tab can't stall the game, which means it now needs each question's answer IDs.
--
-- `deadline` now covers the setter's clocks too. While choosing, it is null until the setter opens
-- the turn, and `question_id` being set marks the move from the first clock to the second.

alter table h2h_private.games add column answers jsonb not null default '{}';

-- Games from before this migration have no answer IDs, so a timeout there can't pick a real
-- answer. This fallback is shown as is on the reveal and never matches an answer.
create function h2h_private.random_answer(g h2h_private.games, p_question text) returns text
language sql volatile as $$
  select coalesce(
    (select a from jsonb_array_elements_text(coalesce(g.answers -> p_question, '[]')) as a order by random() limit 1),
    'no prediction'
  )
$$;

create function h2h_private.commit_prediction(g h2h_private.games, p_question text, p_prediction text)
returns h2h_private.games
language plpgsql volatile as $$
begin
  g.question_id := p_question;
  g.prediction := p_prediction;
  g.pool := array_remove(g.pool, p_question);
  g.turns_left := g.turns_left - 1;
  g.choices := '{}';
  g.deadline := null;
  g.status := 'answering';
  return g;
end;
$$;

-- Keeps a question the setter already picked, and picks one if they didn't.
create function h2h_private.auto_lock(g h2h_private.games) returns h2h_private.games
language plpgsql volatile as $$
declare
  question text := coalesce(g.question_id, (select q from unnest(g.choices) as q order by random() limit 1));
begin
  return h2h_private.commit_prediction(g, question, h2h_private.random_answer(g, question));
end;
$$;

create function h2h_private.check_setup(p_pool text[], p_answers jsonb) returns void
language plpgsql immutable as $$
begin
  if cardinality(p_pool) is null or cardinality(p_pool) not between 1 and 200 then
    raise exception 'Invalid question pool';
  end if;
  if octet_length(p_answers::text) > 262144 or exists (
    select 1 from unnest(p_pool) as q
    where jsonb_typeof(p_answers -> q) is distinct from 'array' or p_answers -> q = '[]'::jsonb
  ) then
    raise exception 'Invalid answers';
  end if;
end;
$$;

create or replace function h2h_private.load(p_game uuid) returns h2h_private.games
language plpgsql volatile as $$
declare
  g h2h_private.games;
begin
  select * into g from h2h_private.games where id = p_game for update;
  if not found then
    raise exception 'Game not found';
  end if;
  if g.deadline is not null and g.deadline < now() then
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
      when is_setter then to_jsonb(g.question_id)
      when is_answerer and g.deadline is not null then to_jsonb(g.question_id)
      else 'null'::jsonb
    end,
    'prediction', case when is_setter and g.status = 'answering' then to_jsonb(g.prediction) else 'null'::jsonb end,
    -- True while the answerer has the question open.
    'answering', g.status = 'answering' and g.deadline is not null,
    -- Each clock goes only to the player racing it.
    'msLeft', case
      when (is_answerer or (is_setter and g.status = 'choosing')) and g.deadline is not null then to_jsonb(greatest(
        0,
        floor(extract(epoch from g.deadline - now()) * 1000 - h2h_private.grace_seconds() * 1000)
      ))
      else 'null'::jsonb
    end
  );
end;
$$;

drop function public.h2h_create_game(text, text[]);

create function public.h2h_create_game(p_name text, p_pool text[], p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g h2h_private.games;
begin
  perform h2h_private.check_setup(p_pool, p_answers);
  insert into h2h_private.games (host_name, pool, answers, turns_left)
  values (h2h_private.clean_name(p_name), p_pool, p_answers, least(cardinality(p_pool), h2h_private.game_turns()))
  returning * into g;
  return jsonb_build_object('id', g.id, 'token', g.host_token);
end;
$$;

-- Starts the setter's first clock. The app calls this once the setter moves on from the reveal,
-- and only the first call counts, so refreshing the page doesn't buy more seconds.
create function public.h2h_start_choosing(p_game uuid, p_token uuid, p_turn int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g h2h_private.games := h2h_private.load(p_game);
begin
  if h2h_private.role_of(g, p_token) is null then
    raise exception 'Not a player in this game';
  end if;
  if g.status = 'choosing' and g.turn = p_turn and g.deadline is null
    and h2h_private.role_of(g, p_token) = g.setter then
    g.deadline := now() + make_interval(secs => h2h_private.answer_seconds() + h2h_private.grace_seconds());
    perform h2h_private.save(g);
  end if;
  return h2h_private.game_view(g, p_token);
end;
$$;

-- Fixes the question and starts the setter's second clock. A pick is final: only the first one
-- counts, so picking again can't restart the clock.
create function public.h2h_pick_question(p_game uuid, p_token uuid, p_turn int, p_question text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g h2h_private.games := h2h_private.load(p_game);
begin
  if h2h_private.role_of(g, p_token) is null then
    raise exception 'Not a player in this game';
  end if;
  if g.status = 'choosing' and g.turn = p_turn and g.question_id is null then
    if h2h_private.role_of(g, p_token) <> g.setter then
      raise exception 'Not your turn to set';
    end if;
    if not p_question = any(g.choices) then
      raise exception 'That question is not one of your choices';
    end if;
    g.question_id := p_question;
    g.deadline := now() + make_interval(secs => h2h_private.answer_seconds() + h2h_private.grace_seconds());
    perform h2h_private.save(g);
  end if;
  return h2h_private.game_view(g, p_token);
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
    if p_question is distinct from coalesce(g.question_id, p_question) then
      raise exception 'A different question is already picked';
    end if;
    if p_prediction is null or p_prediction = '' then
      raise exception 'A prediction is required';
    end if;
    g := h2h_private.commit_prediction(g, p_question, p_prediction);
    perform h2h_private.save(g);
  end if;
  return h2h_private.game_view(g, p_token);
end;
$$;

-- The setter's own client reporting that a clock ran out. It only saves waiting out the grace
-- period: if this call never arrives, `load` does the same thing once the deadline passes.
create function public.h2h_setter_timeout(p_game uuid, p_token uuid, p_turn int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g h2h_private.games := h2h_private.load(p_game);
begin
  if h2h_private.role_of(g, p_token) is null then
    raise exception 'Not a player in this game';
  end if;
  if g.status = 'choosing' and g.turn = p_turn and g.deadline is not null
    and h2h_private.role_of(g, p_token) = g.setter then
    g := h2h_private.auto_lock(g);
    perform h2h_private.save(g);
  end if;
  return h2h_private.game_view(g, p_token);
end;
$$;

drop function public.h2h_rematch(uuid, uuid, text[]);

create function public.h2h_rematch(p_game uuid, p_token uuid, p_pool text[], p_answers jsonb) returns jsonb
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
      host_token, guest_token, host_name, guest_name, status, first_setter, setter, turn, pool, answers, turns_left, choices
    ) values (
      g.host_token, g.guest_token, g.host_name, g.guest_name, 'choosing', next_first, next_first, 1, p_pool, p_answers, turns,
      h2h_private.draw_choices(p_pool, turns, 1)
    ) returning id into fresh;
    g.rematch_id := fresh;
    perform h2h_private.save(g);
  end if;
  return jsonb_build_object('id', g.rematch_id);
end;
$$;

revoke all on all functions in schema h2h_private from public;
revoke execute on function
  public.h2h_create_game(text, text[], jsonb),
  public.h2h_start_choosing(uuid, uuid, int),
  public.h2h_pick_question(uuid, uuid, int, text),
  public.h2h_setter_timeout(uuid, uuid, int),
  public.h2h_rematch(uuid, uuid, text[], jsonb)
from public;
grant execute on function
  public.h2h_create_game(text, text[], jsonb),
  public.h2h_start_choosing(uuid, uuid, int),
  public.h2h_pick_question(uuid, uuid, int, text),
  public.h2h_setter_timeout(uuid, uuid, int),
  public.h2h_rematch(uuid, uuid, text[], jsonb)
to anon, authenticated;
