-- Prevent a move validated by Node from moving a different item after a concurrent change.
begin;

create or replace function public.move_character_inventory_item_checked(
  p_character_id uuid,
  p_from_container text,
  p_from_slot integer,
  p_to_container text,
  p_to_slot integer,
  p_expected_source_id uuid,
  p_expected_target_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  source_id uuid;
  target_id uuid;
begin
  -- Same character lock used by claim_character_reward.
  perform pg_advisory_xact_lock(hashtext(p_character_id::text));

  select id into source_id from public.character_inventory
  where character_id = p_character_id and container = p_from_container and slot = p_from_slot
  for update;
  select id into target_id from public.character_inventory
  where character_id = p_character_id and container = p_to_container and slot = p_to_slot
  for update;

  if source_id is null or source_id is distinct from p_expected_source_id
     or target_id is distinct from p_expected_target_id then
    raise exception 'inventory changed; reload before moving';
  end if;

  return public.move_character_inventory_item(
    p_character_id, p_from_container, p_from_slot, p_to_container, p_to_slot
  );
end;
$$;

revoke all on function public.move_character_inventory_item_checked(uuid,text,integer,text,integer,uuid,uuid)
from public, anon, authenticated;
grant execute on function public.move_character_inventory_item_checked(uuid,text,integer,text,integer,uuid,uuid)
to service_role;

commit;
