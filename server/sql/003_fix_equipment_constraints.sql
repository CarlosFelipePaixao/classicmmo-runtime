begin;

do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select
      constraint_data.conname
    from pg_constraint
      as constraint_data
    join pg_class
      as table_data
      on table_data.oid =
        constraint_data.conrelid
    join pg_namespace
      as schema_data
      on schema_data.oid =
        table_data.relnamespace
    where
      schema_data.nspname =
        'public'
      and
      table_data.relname =
        'character_inventory'
      and
      constraint_data.contype =
        'c'
      and
      (
        pg_get_constraintdef(
          constraint_data.oid
        ) ilike '%container%'
        or
        pg_get_constraintdef(
          constraint_data.oid
        ) ilike '%slot%'
      )
  loop
    execute format(
      'alter table public.character_inventory drop constraint if exists %I',
      constraint_row.conname
    );
  end loop;
end;
$$;

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

commit;
