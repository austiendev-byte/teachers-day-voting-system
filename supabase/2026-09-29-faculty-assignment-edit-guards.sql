-- =====================================================================
-- Guards for editing faculty assignments from the admin panel
-- =====================================================================
-- Removing an assignment is refused when:
--   * it is the faculty member's last one (they would vanish from
--     every ballot), or
--   * it is their last assignment in a school where they already have
--     votes (those votes would disappear from that school's results).
-- Deleting the faculty member itself still cascades normally: the
-- faculty row is already gone when the cascade reaches this trigger.
--
-- Assignments are only inserted or deleted, never updated, so the
-- update policy is dropped (an update could move votes between schools).
-- Safe to run more than once.
-- =====================================================================

begin;

create or replace function public.guard_faculty_assignment_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school_id bigint;
begin
  if not exists (select 1 from public.faculty where id = old.faculty_id) then
    return old;
  end if;

  if not exists (
    select 1 from public.faculty_assignments
    where faculty_id = old.faculty_id and id <> old.id
  ) then
    raise exception 'A faculty member needs at least one assignment. Add another assignment before removing this one.';
  end if;

  select school_id into v_school_id from public.programs where id = old.program_id;

  if not exists (
    select 1
    from public.faculty_assignments fa
    join public.programs p on p.id = fa.program_id
    where fa.faculty_id = old.faculty_id
      and fa.id <> old.id
      and p.school_id = v_school_id
  ) and exists (
    select 1
    from public.category_votes cv
    join public.election_award_categories c on c.id = cv.category_id
    where cv.faculty_id = old.faculty_id
      and c.school_id = v_school_id
  ) then
    raise exception 'This faculty member already has votes in this school, so their last assignment there cannot be removed.';
  end if;

  return old;
end;
$$;

drop trigger if exists trg_guard_faculty_assignment_delete on public.faculty_assignments;
create trigger trg_guard_faculty_assignment_delete
  before delete on public.faculty_assignments
  for each row execute function public.guard_faculty_assignment_delete();

drop policy if exists "Admins can update faculty assignments" on public.faculty_assignments;

commit;
