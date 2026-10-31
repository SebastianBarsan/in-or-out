-- Head-to-head referee. Clients can't touch the table: it sits in a schema the API doesn't
-- expose, and every read and write goes through the functions below. That is what keeps a
-- locked prediction off the answerer's device, so game_view must never include it early.

create schema if not exists h2h_private;
revoke all on schema h2h_private from public;

create table h2h_private.games (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  host_token uuid not null default gen_random_uuid(),
  guest_token uuid,
  host_name text not null,
  guest_name text,
  status text not null default 'lobby' check (status in ('lobby', 'choosing', 'answering', 'finished')),
  first_setter text not null default 'host' check (first_setter in ('host', 'guest')),
  setter text not null default 'host' check (setter in ('host', 'guest')),
  turn int not null default 0,
  pool text[] not null,
  choices text[] not null default '{}',
  question_id text,
  prediction text,
  -- Null until the answerer opens the question, so the 10 seconds can't run out unseen.
  deadline timestamptz,
  -- The first setter caught their opponent and the reply turn is still to come.
  pending_catch boolean not null default false,
  sudden_death boolean not null default false,
  winner text check (winner in ('host', 'guest')),
  history jsonb not null default '[]',
  rematch_id uuid references h2h_private.games (id)
);

alter table h2h_private.games enable row level security;
revoke all on h2h_private.games from public;

-- 10 s on the client's clock, plus some slack for the network on the way back.
create function h2h_private.answer_seconds() returns int language sql immutable as 'select 10';
create function h2h_private.grace_seconds() returns numeric language sql immutable as 'select 1.5';

create function h2h_private.clean_name(p_name text) returns text
language plpgsql immutable as $$
declare
  cleaned text := btrim(coalesce(p_name, ''));
begin
  if char_length(cleaned) not between 1 and 20 then
    raise exception 'Name must be 1 to 20 characters';
  end if;
  return cleaned;
end;
$$;

create function h2h_private.role_of(g h2h_private.games, p_token uuid) returns text
language sql immutable as $$
  select case
    when p_token is null then null
    when p_token = g.host_token then 'host'
    when p_token = g.guest_token then 'guest'
  end
$$;

create function h2h_private.other(p_role text) returns text
language sql immutable as $$
  select case p_role when 'host' then 'guest' else 'host' end
$$;

-- Up to 3 random questions from what's left in the pool.
create function h2h_private.draw_choices(p_pool text[]) returns text[]
language sql volatile as $$
  select coalesce(array_agg(q), '{}')
  from (select q from unnest(p_pool) as q order by random() limit 3) picked
$$;

-- What one player may see. The prediction appears only for its setter until the turn is in
-- history, and the question reaches the answerer only once their timer has started.
create function h2h_private.game_view(g h2h_private.games, p_token uuid) returns jsonb
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
    'poolSize', cardinality(g.pool),
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

-- Plays the fairness rule from the design doc: a catch by the first setter earns the opponent
-- a reply turn, a catch back means sudden death, and in sudden death the next catch wins.
create function h2h_private.resolve_turn(g h2h_private.games, p_answer text) returns h2h_private.games
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

  -- An empty pool ends the game. A catch with no question left to reply on still stands.
  if g.winner is null and cardinality(g.pool) = 0 then
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
    g.choices := h2h_private.draw_choices(g.pool);
  end if;
  return g;
end;
$$;

create function h2h_private.save(g h2h_private.games) returns void
language sql volatile as $$
  update h2h_private.games set
    guest_token = g.guest_token,
    guest_name = g.guest_name,
    status = g.status,
    setter = g.setter,
    turn = g.turn,
    pool = g.pool,
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

-- Locks the row and settles a clock that has run out, whoever happens to ask first. That way
-- closing the tab mid-question still counts as a timeout.
create function h2h_private.load(p_game uuid) returns h2h_private.games
language plpgsql volatile as $$
declare
  g h2h_private.games;
begin
  select * into g from h2h_private.games where id = p_game for update;
  if not found then
    raise exception 'Game not found';
  end if;
  if g.status = 'answering' and g.deadline is not null and g.deadline < now() then
    g := h2h_private.resolve_turn(g, null);
    perform h2h_private.save(g);
  end if;
  return g;
end;
$$;

-- Public API. `set search_path = ''` keeps the definer functions from resolving anything a
-- caller could plant, which is why every name above is schema-qualified.

create function public.h2h_create_game(p_name text, p_pool text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g h2h_private.games;
begin
  if cardinality(p_pool) is null or cardinality(p_pool) not between 1 and 200 then
    raise exception 'Invalid question pool';
  end if;
  insert into h2h_private.games (host_name, pool)
  values (h2h_private.clean_name(p_name), p_pool)
  returning * into g;
  return jsonb_build_object('id', g.id, 'token', g.host_token);
end;
$$;

create function public.h2h_join_game(p_game uuid, p_name text) returns jsonb
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
  g.choices := h2h_private.draw_choices(g.pool);
  perform h2h_private.save(g);
  return jsonb_build_object('id', g.id, 'token', g.guest_token);
end;
$$;

create function public.h2h_get_game(p_game uuid, p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  return h2h_private.game_view(h2h_private.load(p_game), p_token);
end;
$$;

-- `p_turn` makes retries harmless: anything aimed at an earlier turn just returns the game.
create function public.h2h_lock_prediction(
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
    g.choices := '{}';
    g.status := 'answering';
    perform h2h_private.save(g);
  end if;
  return h2h_private.game_view(g, p_token);
end;
$$;

-- Starts the answerer's clock the first time and only the first time, so refreshing the page
-- doesn't buy more seconds.
create function public.h2h_start_answer(p_game uuid, p_token uuid, p_turn int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g h2h_private.games := h2h_private.load(p_game);
begin
  if h2h_private.role_of(g, p_token) is null then
    raise exception 'Not a player in this game';
  end if;
  if g.status = 'answering' and g.turn = p_turn and g.deadline is null
    and h2h_private.role_of(g, p_token) <> g.setter then
    g.deadline := now() + make_interval(secs => h2h_private.answer_seconds() + h2h_private.grace_seconds());
    perform h2h_private.save(g);
  end if;
  return h2h_private.game_view(g, p_token);
end;
$$;

-- A null answer is the answerer's own client reporting that the clock ran out.
create function public.h2h_submit_answer(p_game uuid, p_token uuid, p_turn int, p_answer text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g h2h_private.games := h2h_private.load(p_game);
begin
  if h2h_private.role_of(g, p_token) is null then
    raise exception 'Not a player in this game';
  end if;
  if g.status = 'answering' and g.turn = p_turn then
    if h2h_private.role_of(g, p_token) = g.setter then
      raise exception 'The setter does not answer';
    end if;
    if g.deadline is null then
      raise exception 'The question has not been opened';
    end if;
    g := h2h_private.resolve_turn(g, nullif(p_answer, ''));
    perform h2h_private.save(g);
  end if;
  return h2h_private.game_view(g, p_token);
end;
$$;

-- Both players keep their tokens. The other player sets first this time, and whichever device
-- asks second is sent to the game the first one made.
create function public.h2h_rematch(p_game uuid, p_token uuid, p_pool text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g h2h_private.games := h2h_private.load(p_game);
  next_first text;
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
    insert into h2h_private.games (
      host_token, guest_token, host_name, guest_name, status, first_setter, setter, turn, pool, choices
    ) values (
      g.host_token, g.guest_token, g.host_name, g.guest_name, 'choosing', next_first, next_first, 1, p_pool,
      h2h_private.draw_choices(p_pool)
    ) returning id into fresh;
    g.rematch_id := fresh;
    perform h2h_private.save(g);
  end if;
  return jsonb_build_object('id', g.rematch_id);
end;
$$;

-- Lock the API down to exactly the functions above, for signed-out visitors included.
revoke all on all functions in schema h2h_private from public;
revoke execute on function
  public.h2h_create_game(text, text[]),
  public.h2h_join_game(uuid, text),
  public.h2h_get_game(uuid, uuid),
  public.h2h_lock_prediction(uuid, uuid, int, text, text),
  public.h2h_start_answer(uuid, uuid, int),
  public.h2h_submit_answer(uuid, uuid, int, text),
  public.h2h_rematch(uuid, uuid, text[])
from public;
grant execute on function
  public.h2h_create_game(text, text[]),
  public.h2h_join_game(uuid, text),
  public.h2h_get_game(uuid, uuid),
  public.h2h_lock_prediction(uuid, uuid, int, text, text),
  public.h2h_start_answer(uuid, uuid, int),
  public.h2h_submit_answer(uuid, uuid, int, text),
  public.h2h_rematch(uuid, uuid, text[])
to anon, authenticated;
