begin;

alter table
  public.character_battle_sessions
add column if not exists
  loot_awarded jsonb not null
  default '[]'::jsonb;

alter table
  public.character_battle_sessions
drop constraint if exists
  character_battle_sessions_loot_awarded_check;

alter table
  public.character_battle_sessions
add constraint
  character_battle_sessions_loot_awarded_check
check (
  jsonb_typeof(loot_awarded) = 'array'
);

create or replace function
  public.finish_character_battle_with_loot(
    p_character_id uuid,
    p_session_id uuid,
    p_result text,
    p_defeated_enemies jsonb,
    p_experience bigint,
    p_gold bigint,
    p_loot jsonb
  )
returns table (
  session_id uuid,
  experience_awarded bigint,
  gold_awarded bigint,
  loot_awarded jsonb,
  total_xp bigint,
  total_gold bigint,
  was_repeated boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session
    public.character_battle_sessions%rowtype;

  v_experience bigint :=
    greatest(
      0,
      least(
        coalesce(
          p_experience,
          0
        ),
        1000000
      )
    );

  v_gold bigint :=
    greatest(
      0,
      least(
        coalesce(
          p_gold,
          0
        ),
        1000000
      )
    );

  v_loot jsonb :=
    coalesce(
      p_loot,
      '[]'::jsonb
    );

  v_total_xp bigint;
  v_total_gold bigint;
begin
  if p_result not in (
    'victory',
    'escape',
    'defeat',
    'abort'
  ) then
    raise exception
      'invalid battle result';
  end if;

  if
    jsonb_typeof(v_loot) <>
      'array'
  then
    raise exception
      'invalid battle loot';
  end if;

  select *
  into v_session
  from public.character_battle_sessions
  where
    id = p_session_id
    and character_id = p_character_id
  for update;

  if not found then
    raise exception
      'battle session not found';
  end if;

  if v_session.status <> 'started' then
    select
      c.xp,
      c.gold
    into
      v_total_xp,
      v_total_gold
    from public.characters c
    where c.id = p_character_id;

    return query
    select
      v_session.id,
      v_session.experience_awarded,
      v_session.gold_awarded,
      coalesce(
        v_session.loot_awarded,
        '[]'::jsonb
      ),
      coalesce(v_total_xp, 0),
      coalesce(v_total_gold, 0),
      true;

    return;
  end if;

  if v_session.started_at <
    now() - interval '30 minutes'
  then
    update public.character_battle_sessions
    set
      status = 'expired',
      result = 'abort',
      finished_at = now(),
      updated_at = now()
    where id = p_session_id;

    raise exception
      'battle session expired';
  end if;

  if p_result <> 'victory' then
    v_experience := 0;
    v_gold := 0;
    v_loot := '[]'::jsonb;
  end if;

  update public.characters
  set
    xp =
      coalesce(xp, 0) +
      v_experience,
    gold =
      coalesce(gold, 0) +
      v_gold,
    updated_at = now()
  where id = p_character_id
  returning
    xp,
    gold
  into
    v_total_xp,
    v_total_gold;

  if not found then
    raise exception
      'character not found';
  end if;

  update public.character_battle_sessions
  set
    status = p_result,
    result = p_result,
    defeated_enemies =
      coalesce(
        p_defeated_enemies,
        '[]'::jsonb
      ),
    experience_awarded =
      v_experience,
    gold_awarded =
      v_gold,
    loot_awarded =
      v_loot,
    finished_at = now(),
    updated_at = now()
  where id = p_session_id;

  return query
  select
    p_session_id,
    v_experience,
    v_gold,
    v_loot,
    v_total_xp,
    v_total_gold,
    false;
end;
$$;

revoke all
on function
  public.finish_character_battle_with_loot(
    uuid,
    uuid,
    text,
    jsonb,
    bigint,
    bigint,
    jsonb
  )
from public, anon, authenticated;

grant execute
on function
  public.finish_character_battle_with_loot(
    uuid,
    uuid,
    text,
    jsonb,
    bigint,
    bigint,
    jsonb
  )
to service_role;

commit;
