-- ================================================================
-- OPEN STUDENT REGISTRATION (REMOVE STUDENT ID WHITELIST)
--
-- Why:
--   The official BiPSU student ID list is not available to us, so
--   registration can no longer require the ID to be on
--   public.eligible_student_ids.
--
-- What changes:
--   - handle_student_registration() no longer checks the whitelist.
--   - check_student_id_registration() keeps its signature so older
--     deployed frontends keep working, but always reports eligible.
--
-- What stays (one account = one vote):
--   - idx_students_student_id_unique   : one account per Student ID
--   - idx_students_auth_user_id_unique : one student profile per login
--   - category_votes_one_per_student_per_category : one vote per
--     category per election, enforced by submit_full_ballot().
--
-- The eligible_student_ids table and its admin RPCs are left in place
-- (unused) so re-enabling the whitelist later is a one-function change.
-- ================================================================

begin;

create or replace function public.check_student_id_registration(
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
    btrim(coalesce(p_student_id, '')) <> '' as eligible,
    exists (
      select 1
      from public.students s
      where s.student_id = btrim(p_student_id)
    ) as already_registered;
$function$;

create or replace function public.handle_student_registration()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_student_id text;
  v_name text;
  v_program_id bigint;
  v_major_id bigint;
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

  begin
    v_major_id := nullif(new.raw_user_meta_data->>'major_id', '')::bigint;
  exception
    when invalid_text_representation then
      v_major_id := null;
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

  if not exists (
    select 1
    from public.programs p
    where p.id = v_program_id
  ) then
    raise exception 'Selected program does not exist.';
  end if;

  if v_major_id is not null and not exists (
    select 1
    from public.majors m
    where m.id = v_major_id
      and m.program_id = v_program_id
  ) then
    raise exception 'Selected major does not belong to the selected program.';
  end if;

  -- One Student ID = one student profile.
  -- The unique index also protects against simultaneous registrations.
  begin
    insert into public.students (
      student_id,
      name,
      account_status,
      program_id,
      major_id,
      auth_user_id
    )
    values (
      v_student_id,
      v_name,
      'approved',
      v_program_id,
      v_major_id,
      new.id
    );
  exception
    when unique_violation then
      raise exception 'This Student ID already has an account.';
  end;

  return new;
end;
$function$;

commit;

-- Applied 2026-09-29 to production (as written above) and load-test.
-- Load-test's students table has no major_id column, so there the
-- major lines were left out; everything else is identical.
--
-- Rollback: put back the eligible_student_ids check in both functions
-- (see 2026-09-27-student-id-whitelist-registration.sql).
