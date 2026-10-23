-- Curva acumulada compartilhada com server/src/progression.js.
-- Mantém o nível de personagens existentes; não altera XP nem inventário.
begin;

create or replace function public.lumnia_update_level_from_xp()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.level := least(99, greatest(
    1,
    coalesce(new.level, 1),
    case when tg_op = 'UPDATE' then coalesce(old.level, 1) else 1 end,
    floor(sqrt(greatest(0, coalesce(new.xp, 0))::numeric / 100))::integer + 1
  ));
  return new;
end;
$$;

revoke all on function public.lumnia_update_level_from_xp() from public, anon, authenticated;

drop trigger if exists lumnia_level_from_xp on public.characters;
create trigger lumnia_level_from_xp
before insert or update of xp, level on public.characters
for each row execute function public.lumnia_update_level_from_xp();

-- Backfill seguro e repetível.
update public.characters set level = greatest(1, coalesce(level, 1));

create or replace function public.abandon_character_battles(p_character_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  changed integer;
begin
  update public.character_battle_sessions
  set status = 'abort', result = 'abort', finished_at = now(), updated_at = now()
  where character_id = p_character_id and status = 'started';
  get diagnostics changed = row_count;
  return changed;
end;
$$;
revoke all on function public.abandon_character_battles(uuid) from public, anon, authenticated;
grant execute on function public.abandon_character_battles(uuid) to service_role;

commit;
