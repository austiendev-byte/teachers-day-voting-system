-- ================================================================
-- STUDENT REGISTRATION — BI PSU STUDENT ID WHITELIST
--
-- Purpose:
--   Allow automatic student approval without a manual admin queue.
--
-- Model:
--   1. Admin/system preloads eligible Student IDs into
--      public.eligible_student_ids.
--   2. Student registers with that Student ID plus their own details.
--   3. A lightweight RPC checks eligibility before Auth signup.
--   4. A SECURITY DEFINER trigger validates the Student ID again
--      and creates the public.students profile as APPROVED.
--   5. UNIQUE constraints/indexes enforce one account per Student ID.
--
-- Important:
--   - Only the Student ID is preloaded; name/program/school are supplied
--     by the student during registration.
--   - The database does NOT trust the pre-check alone. The Auth trigger
--     verifies the whitelist again to prevent race-condition bypasses.
--   - School/program remain the values entered during registration.
--     Voting later derives the student's school from students -> programs.
-- ================================================================

begin;

-- ------------------------------------------------
-- 1) ELIGIBLE STUDENT ID WHITELIST
-- ------------------------------------------------

create table if not exists public.eligible_student_ids (
  student_id text primary key,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.eligible_student_ids enable row level security;

-- No direct table access for anonymous/authenticated clients.
-- The registration-check function below is the only public-facing lookup.
revoke all on table public.eligible_student_ids from public;
revoke all on table public.eligible_student_ids from anon;
revoke all on table public.eligible_student_ids from authenticated;

-- ------------------------------------------------
-- 2) MAKE STUDENT ID / AUTH USER ONE-TO-ONE
-- ------------------------------------------------

-- Stop with a clear message if the existing table already contains
-- duplicate Student IDs. Those must be cleaned manually before the
-- one-account-per-Student-ID rule can be enabled.
do $check_student_duplicates$
declare
  v_duplicate text;
begin
  select student_id
    into v_duplicate
  from public.students
  where student_id is not null
  group by student_id
  having count(*) > 1
  limit 1;

  if v_duplicate is not null then
    raise exception
      'Cannot enable one-account-per-Student-ID yet. Duplicate existing Student ID found: %',
      v_duplicate;
  end if;
end
$check_student_duplicates$;

create unique index if not exists idx_students_student_id_unique
  on public.students (student_id);

create unique index if not exists idx_students_auth_user_id_unique
  on public.students (auth_user_id)
  where auth_user_id is not null;

-- ------------------------------------------------
-- 3) SAFE REGISTRATION CHECK
-- ------------------------------------------------

-- Returns only two booleans. It never exposes the contents of the
-- eligible-student-ID table.
drop function if exists public.check_student_id_registration(text);

create function public.check_student_id_registration(
  p_student_id text
)
returns table (
  eligible boolean,
  already_registered boolean
)
language sql
security definer
set search_path = public
as $function$
  select
    exists (
      select 1
      from public.eligible_student_ids e
      where e.student_id = btrim(p_student_id)
        and e.is_active = true
    ) as eligible,
    exists (
      select 1
      from public.students s
      where s.student_id = btrim(p_student_id)
    ) as already_registered;
$function$;

revoke all
on function public.check_student_id_registration(text)
from public;

revoke all
on function public.check_student_id_registration(text)
from authenticated;

revoke all
on function public.check_student_id_registration(text)
from anon;

grant execute
on function public.check_student_id_registration(text)
to anon;

grant execute
on function public.check_student_id_registration(text)
to authenticated;

-- ------------------------------------------------
-- 4) AUTH TRIGGER — AUTOMATICALLY CREATE APPROVED PROFILE
-- ------------------------------------------------

-- IMPORTANT:
-- Only self-registration requests carrying
-- registration_type = 'student' are handled here.
-- Admin/service-created auth users are left untouched.

drop trigger if exists trg_create_student_profile_from_auth_user
on auth.users;

drop function if exists public.handle_student_registration();

create function public.handle_student_registration()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_student_id text;
  v_name text;
  v_program_id bigint;
  v_eligible boolean;
begin
  if coalesce(new.raw_user_meta_data->>'registration_type', '') <> 'student' then
    return new;
  end if;

  v_student_id := btrim(coalesce(new.raw_user_meta_data->>'student_id', ''));
  v_name := btrim(coalesce(new.raw_user_meta_data->>'name', ''));

  begin
    v_program_id := nullif(new.raw_user_meta_data->>'program_id', '')::bigint;
  exception
    when invalid_text_representation then
      raise exception 'Invalid program selection.';
  end;

  if v_student_id = '' then
    raise exception 'Student ID is required.';
  end if;

  if v_name = '' then
    raise exception 'Full name is required.';
  end if;

  if v_program_id is null then
    raise exception 'Program selection is required.';
  end if;

  select exists (
    select 1
    from public.eligible_student_ids e
    where e.student_id = v_student_id
      and e.is_active = true
  )
  into v_eligible;

  if not v_eligible then
    raise exception 'Student ID is not on the eligible BiPSU student list.';
  end if;

  if not exists (
    select 1
    from public.programs p
    where p.id = v_program_id
  ) then
    raise exception 'Selected program does not exist.';
  end if;

  -- One Student ID = one student profile.
  -- The unique index also protects against simultaneous registrations.
  begin
    insert into public.students (
      student_id,
      name,
      account_status,
      program_id,
      auth_user_id
    )
    values (
      v_student_id,
      v_name,
      'approved',
      v_program_id,
      new.id
    );
  exception
    when unique_violation then
      raise exception 'This Student ID already has an account.';
  end;

  return new;
end;
$function$;

revoke all
on function public.handle_student_registration()
from public;

revoke all
on function public.handle_student_registration()
from anon;

grant execute
on function public.handle_student_registration()
to authenticated;

create trigger trg_create_student_profile_from_auth_user
after insert on auth.users
for each row
execute function public.handle_student_registration();

commit;

-- ================================================================
-- AFTER THE MIGRATION SUCCEEDS
-- ================================================================
-- Load your authorized BiPSU Student IDs into:
--   public.eligible_student_ids
--
-- Example CSV structure:
--   student_id
--   2026-0001
--   2026-0002
--   2026-0003
--
-- Verify counts:
--
-- select count(*) from public.eligible_student_ids
-- where is_active = true;
--
-- Test one ID without exposing the list:
--
-- select * from public.check_student_id_registration('2026-0001');
