begin;

alter table public.character_inventory
  drop constraint if exists
    character_inventory_container_check;

alter table public.character_inventory
  drop constraint if exists
    character_inventory_slot_check;

alter table public.character_inventory
  add constraint
    character_inventory_container_check
  check (
    container in (
      'inventory',
      'potions',
      'equipment'
    )
  );

alter table public.character_inventory
  add constraint
    character_inventory_slot_check
  check (
    (
      container = 'inventory'
      and
      slot between 0 and 12
    )
    or
    (
      container = 'potions'
      and
      slot between 0 and 6
    )
    or
    (
      container = 'equipment'
      and
      slot between 0 and 7
    )
  );

create table if not exists
  public.character_stats (
    character_id uuid primary key
      references public.characters(id)
      on delete cascade,

    level integer not null
      default 1
      check (level >= 1),

    base_attack integer not null
      default 0
      check (base_attack >= 0),

    base_defense integer not null
      default 0
      check (base_defense >= 0),

    base_max_hp integer not null
      default 1
      check (base_max_hp >= 1),

    base_max_mp integer not null
      default 0
      check (base_max_mp >= 0),

    equipment_attack integer not null
      default 0
      check (equipment_attack >= 0),

    equipment_defense integer not null
      default 0
      check (equipment_defense >= 0),

    equipment_max_hp integer not null
      default 0
      check (equipment_max_hp >= 0),

    equipment_max_mp integer not null
      default 0
      check (equipment_max_mp >= 0),

    attack_power integer not null
      default 0
      check (attack_power >= 0),

    defense_power integer not null
      default 0
      check (defense_power >= 0),

    max_hp integer not null
      default 1
      check (max_hp >= 1),

    max_mp integer not null
      default 0
      check (max_mp >= 0),

    combat_power integer not null
      default 0
      check (combat_power >= 0),

    updated_at timestamptz not null
      default now()
  );

alter table public.character_stats
  enable row level security;

revoke all
on table public.character_stats
from anon, authenticated;

grant
  select,
  insert,
  update,
  delete
on table public.character_stats
to service_role;

create or replace function
  public.move_character_inventory_item(
    p_character_id uuid,
    p_from_container text,
    p_from_slot integer,
    p_to_container text,
    p_to_slot integer
  )
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  source_row
    public.character_inventory%rowtype;

  target_row
    public.character_inventory%rowtype;
begin
  if
    p_from_container not in (
      'inventory',
      'potions',
      'equipment'
    )
    or
    p_to_container not in (
      'inventory',
      'potions',
      'equipment'
    )
  then
    raise exception
      'invalid inventory container';
  end if;

  if
    (
      p_from_container = 'inventory'
      and
      p_from_slot not between 1 and 12
    )
    or
    (
      p_from_container = 'potions'
      and
      p_from_slot not between 1 and 6
    )
    or
    (
      p_from_container = 'equipment'
      and
      p_from_slot not between 1 and 7
    )
    or
    (
      p_to_container = 'inventory'
      and
      p_to_slot not between 1 and 12
    )
    or
    (
      p_to_container = 'potions'
      and
      p_to_slot not between 1 and 6
    )
    or
    (
      p_to_container = 'equipment'
      and
      p_to_slot not between 1 and 7
    )
  then
    raise exception
      'invalid inventory slot';
  end if;

  if
    p_from_container = p_to_container
    and
    p_from_slot = p_to_slot
  then
    return true;
  end if;

  perform 1
  from public.character_inventory
  where character_id = p_character_id
  for update;

  select *
  into source_row
  from public.character_inventory
  where
    character_id = p_character_id
    and
    container = p_from_container
    and
    slot = p_from_slot;

  if not found then
    raise exception
      'source item not found';
  end if;

  select *
  into target_row
  from public.character_inventory
  where
    character_id = p_character_id
    and
    container = p_to_container
    and
    slot = p_to_slot;

  update public.character_inventory
  set
    slot = 0,
    updated_at = now()
  where id = source_row.id;

  if target_row.id is not null then
    update public.character_inventory
    set
      container = p_from_container,
      slot = p_from_slot,
      updated_at = now()
    where id = target_row.id;
  end if;

  update public.character_inventory
  set
    container = p_to_container,
    slot = p_to_slot,
    updated_at = now()
  where id = source_row.id;

  return true;
end;
$$;

revoke all
on function
  public.move_character_inventory_item(
    uuid,
    text,
    integer,
    text,
    integer
  )
from public, anon, authenticated;

grant execute
on function
  public.move_character_inventory_item(
    uuid,
    text,
    integer,
    text,
    integer
  )
to service_role;

commit;
