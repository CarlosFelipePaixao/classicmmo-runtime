begin;

create extension if not exists pgcrypto;

create table if not exists public.character_inventory (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null
    references public.characters(id)
    on delete cascade,
  container text not null
    check (
      container in (
        'inventory',
        'potions'
      )
    ),
  slot integer not null
    check (
      (
        container = 'inventory' and
        slot between 0 and 12
      )
      or
      (
        container = 'potions' and
        slot between 0 and 6
      )
    ),
  item_key text not null,
  quantity integer not null default 1
    check (
      quantity between 1 and 999
    ),
  created_at timestamptz not null
    default now(),
  updated_at timestamptz not null
    default now(),
  unique (
    character_id,
    container,
    slot
  )
);

create index if not exists
  character_inventory_character_id_idx
on public.character_inventory (
  character_id
);

alter table public.character_inventory
  enable row level security;

revoke all
on table public.character_inventory
from anon, authenticated;

grant
  select,
  insert,
  update,
  delete
on table public.character_inventory
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
      'potions'
    )
    or
    p_to_container not in (
      'inventory',
      'potions'
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

  select *
  into source_row
  from public.character_inventory
  where
    character_id = p_character_id
    and
    container = p_from_container
    and
    slot = p_from_slot
  for update;

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
    slot = p_to_slot
  for update;

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
