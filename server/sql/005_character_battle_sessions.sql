-- LUMNIA FASE 3B.1
-- Sessões autoritativas de batalha, EXP e ouro persistentes.

create table if not exists public.character_battle_sessions (
  id uuid primary key default gen_random_uuid(),

  character_id uuid not null
    references public.characters(id)
    on delete cascade,

  source text not null default 'unknown'
    check (
      source in (
        'random',
        'event',
        'unknown'
      )
    ),

  map_id text not null,
  troop_id integer not null
    check (troop_id >= 0),

  enemy_roster jsonb not null
    default '[]'::jsonb
    check (
      jsonb_typeof(enemy_roster) = 'array'
    ),

  status text not null default 'started'
    check (
      status in (
        'started',
        'victory',
        'escape',
        'defeat',
        'abort',
        'expired'
      )
    ),

  result text
    check (
      result is null or
      result in (
        'victory',
        'escape',
        'defeat',
        'abort'
      )
    ),

  defeated_enemies jsonb not null
    default '[]'::jsonb
    check (
      jsonb_typeof(defeated_enemies) = 'array'
    ),

  experience_awarded bigint not null
    default 0
    check (experience_awarded >= 0),

  gold_awarded bigint not null
    default 0
    check (gold_awarded >= 0),

  started_at timestamptz not null
    default now(),

  finished_at timestamptz,

  created_at timestamptz not null
    default now(),

  updated_at timestamptz not null
    default now()
);

create index if not exists
  character_battle_sessions_character_idx
on public.character_battle_sessions (
  character_id,
  started_at desc
);

create unique index if not exists
  character_battle_sessions_one_active_idx
on public.character_battle_sessions (
  character_id
)
where status = 'started';

alter table public.character_battle_sessions
  enable row level security;

revoke all
on table public.character_battle_sessions
from anon, authenticated;

create or replace function public.start_character_battle(
  p_character_id uuid,
  p_source text,
  p_map_id text,
  p_troop_id integer,
  p_enemy_roster jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
begin
  if not exists (
    select 1
    from public.characters
    where id = p_character_id
  ) then
    raise exception
      'character not found';
  end if;

  update public.character_battle_sessions
  set
    status = 'expired',
    result = 'abort',
    finished_at = now(),
    updated_at = now()
  where
    character_id = p_character_id
    and status = 'started'
    and started_at <
      now() - interval '30 minutes';

  if exists (
    select 1
    from public.character_battle_sessions
    where
      character_id = p_character_id
      and status = 'started'
  ) then
    raise exception
      'battle already active';
  end if;

  insert into public.character_battle_sessions (
    character_id,
    source,
    map_id,
    troop_id,
    enemy_roster
  )
  values (
    p_character_id,
    case
      when p_source in (
        'random',
        'event',
        'unknown'
      )
        then p_source
      else 'unknown'
    end,
    p_map_id,
    p_troop_id,
    coalesce(
      p_enemy_roster,
      '[]'::jsonb
    )
  )
  returning id
  into v_session_id;

  return v_session_id;
end;
$$;

create or replace function public.finish_character_battle(
  p_character_id uuid,
  p_session_id uuid,
  p_result text,
  p_defeated_enemies jsonb,
  p_experience bigint,
  p_gold bigint
)
returns table (
  session_id uuid,
  experience_awarded bigint,
  gold_awarded bigint,
  total_xp bigint,
  total_gold bigint
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
      coalesce(v_total_xp, 0),
      coalesce(v_total_gold, 0);

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
    finished_at = now(),
    updated_at = now()
  where id = p_session_id;

  return query
  select
    p_session_id,
    v_experience,
    v_gold,
    v_total_xp,
    v_total_gold;
end;
$$;

revoke all
on function public.start_character_battle(
  uuid,
  text,
  text,
  integer,
  jsonb
)
from public, anon, authenticated;

revoke all
on function public.finish_character_battle(
  uuid,
  uuid,
  text,
  jsonb,
  bigint,
  bigint
)
from public, anon, authenticated;

grant execute
on function public.start_character_battle(
  uuid,
  text,
  text,
  integer,
  jsonb
)
to service_role;

grant execute
on function public.finish_character_battle(
  uuid,
  uuid,
  text,
  jsonb,
  bigint,
  bigint
)
to service_role;
