-- Answers and predictions must now be one of the question's real answer IDs. Before this, a
-- tampered client could send an answer that matches nothing and never be caught.

-- Games from before the setter-clock migration have no stored answers, so anything goes there.
create function h2h_private.is_answer(g h2h_private.games, p_question text, p_answer text) returns boolean
language sql immutable as $$
  select g.answers -> p_question is null or (g.answers -> p_question) ? p_answer
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
    if not h2h_private.is_answer(g, p_question, p_prediction) then
      raise exception 'Not a valid answer';
    end if;
    g := h2h_private.commit_prediction(g, p_question, p_prediction);
    perform h2h_private.save(g);
  end if;
  return h2h_private.game_view(g, p_token);
end;
$$;

create or replace function public.h2h_submit_answer(p_game uuid, p_token uuid, p_turn int, p_answer text) returns jsonb
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
    if nullif(p_answer, '') is not null and not h2h_private.is_answer(g, g.question_id, p_answer) then
      raise exception 'Not a valid answer';
    end if;
    g := h2h_private.resolve_turn(g, nullif(p_answer, ''));
    perform h2h_private.save(g);
  end if;
  return h2h_private.game_view(g, p_token);
end;
$$;

revoke all on function h2h_private.is_answer(h2h_private.games, text, text) from public;
