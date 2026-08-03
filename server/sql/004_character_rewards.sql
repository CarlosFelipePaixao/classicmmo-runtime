begin;

create table if not exists
  public.character_reward_claims (
    id uuid primary key
      default gen_random_uuid(),

    character_id uuid not null
      references public.characters(id)
      on delete cascade,

    reward_key text not null,

    claimed_at timestamptz not null
      default now(),

    unique (
      character_id,
      reward_key
    )
  );

create index if not exists
  character_reward_claims_character_idx
on public.character_reward_claims (
  character_id
);

alter table public.character_reward_claims
  enable row level security;

revoke all
on table public.character_reward_claims
from anon, authenticated;

grant
  select,
  insert,
  update,
  delete
on table public.character_reward_claims
to service_role;

create or replace function
  public.claim_character_reward(
    p_character_id uuid,
    p_reward_key text,
    p_once_per_character boolean,
    p_items jsonb
  )
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item_data jsonb;
  stack_row
    public.character_inventory%rowtype;
  item_key_value text;
  container_value text;
  quantity_value integer;
  maximum_stack_value integer;
  remaining integer;
  addition integer;
  free_slot integer;
  maximum_slot integer;
  claim_id uuid;
begin
  if p_character_id is null then
    raise exception
      'character is required';
  end if;

  if
    p_reward_key is null
    or
    p_reward_key !~
      '^[a-z0-9][a-z0-9._:-]{0,79}$'
  then
    raise exception
      'invalid reward key';
  end if;

  if
    p_items is null
    or
    jsonb_typeof(p_items) <> 'array'
    or
    jsonb_array_length(p_items) = 0
  then
    raise exception
      'reward items are required';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_character_id::text)
  );

  if p_once_per_character then
    insert into
      public.character_reward_claims (
        character_id,
        reward_key
      )
    values (
      p_character_id,
      p_reward_key
    )
    on conflict (
      character_id,
      reward_key
    )
    do nothing
    returning id
    into claim_id;

    if claim_id is null then
      raise exception
        'reward already claimed';
    end if;
  end if;

  for item_data in
    select value
    from jsonb_array_elements(
      p_items
    )
  loop
    item_key_value =
      item_data ->> 'itemKey';

    container_value =
      coalesce(
        item_data ->> 'container',
        'inventory'
      );

    quantity_value =
      coalesce(
        (item_data ->> 'quantity')::integer,
        1
      );

    maximum_stack_value =
      coalesce(
        (item_data ->> 'maximumStack')::integer,
        1
      );

    if
      item_key_value is null
      or
      item_key_value = ''
      or
      quantity_value < 1
      or
      quantity_value > 999
      or
      maximum_stack_value < 1
      or
      maximum_stack_value > 999
      or
      container_value not in (
        'inventory',
        'potions'
      )
    then
      raise exception
        'invalid reward item';
    end if;

    maximum_slot =
      case
        when container_value = 'potions'
          then 6
        else 12
      end;

    remaining = quantity_value;

    while remaining > 0 loop
      select *
      into stack_row
      from public.character_inventory
      where
        character_id = p_character_id
        and
        container = container_value
        and
        item_key = item_key_value
        and
        quantity < maximum_stack_value
        and
        slot between 1 and maximum_slot
      order by slot
      limit 1
      for update;

      if found then
        addition = least(
          remaining,
          maximum_stack_value -
            stack_row.quantity
        );

        update public.character_inventory
        set
          quantity =
            quantity + addition,
          updated_at = now()
        where id = stack_row.id;

        remaining =
          remaining - addition;

        continue;
      end if;

      select candidate.slot
      into free_slot
      from generate_series(
        1,
        maximum_slot
      ) as candidate(slot)
      where not exists (
        select 1
        from public.character_inventory
        where
          character_id = p_character_id
          and
          container = container_value
          and
          slot = candidate.slot
      )
      order by candidate.slot
      limit 1;

      if free_slot is null then
        raise exception
          'inventory is full';
      end if;

      addition = least(
        remaining,
        maximum_stack_value
      );

      insert into
        public.character_inventory (
          character_id,
          container,
          slot,
          item_key,
          quantity
        )
      values (
        p_character_id,
        container_value,
        free_slot,
        item_key_value,
        addition
      );

      remaining =
        remaining - addition;
    end loop;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'rewardKey', p_reward_key
  );
end;
$$;

revoke all
on function
  public.claim_character_reward(
    uuid,
    text,
    boolean,
    jsonb
  )
from public, anon, authenticated;

grant execute
on function
  public.claim_character_reward(
    uuid,
    text,
    boolean,
    jsonb
  )
to service_role;

commit;
