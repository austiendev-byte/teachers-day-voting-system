-- ================================================================
-- PHASE 1 — SECURITY + CORRECTNESS HARDENING
--
-- Safe to re-run. Apply to the load-test project first.
--
-- 1. Close the student whitelist bypass:
--    authenticated users could INSERT their own public.students row
--    with any student_id/program_id, and account_status defaults to
--    'approved'. Profiles are created only by the SECURITY DEFINER
--    registration trigger (handle_student_registration) and managed by
--    SECURITY DEFINER admin RPCs, neither of which needs these grants.
-- 2. Revoke client access to legacy RPCs the frontend no longer calls.
--    Functions are kept; re-grant EXECUTE to restore.
-- 3. Make the school schedule model configurable per election
--    (concurrent school windows allowed by default).
--
-- Rollback notes are at the end of this file.
-- ================================================================

begin;

-- ------------------------------------------------
-- 1. STUDENT PROFILE WRITES — DATABASE-ONLY
-- ------------------------------------------------

drop policy if exists "students can insert own profile" on public.students;

revoke insert, update, delete, truncate on public.students from anon, authenticated;

-- Vote, role and whitelist tables are written only through
-- SECURITY DEFINER functions. RLS already blocks client writes; this
-- removes the underlying privilege as well.
revoke insert, update, delete, truncate on public.category_votes from anon, authenticated;
revoke insert, update, delete, truncate on public.votes from anon, authenticated;
revoke insert, update, delete, truncate on public.user_roles from anon, authenticated;
revoke all on public.eligible_student_ids from anon, authenticated;

-- ------------------------------------------------
-- 2. LEGACY RPCS — NO CLIENT ACCESS
-- The only client voting path is submit_full_ballot().
-- submit_vote() calls submit_category_vote() internally; both are
-- revoked together.
-- ------------------------------------------------

revoke execute on function public.submit_vote(bigint, bigint) from public, anon, authenticated;
revoke execute on function public.submit_category_vote(bigint, bigint, bigint) from public, anon, authenticated;
revoke execute on function public.has_student_voted(bigint) from public, anon, authenticated;
revoke execute on function public.get_student_school_schedule(bigint, bigint) from public, anon, authenticated;
revoke execute on function public.get_election_results(bigint) from public, anon, authenticated;
revoke execute on function public.submit_report(text, text, text, text) from public, anon, authenticated;
revoke execute on function public.update_report_status(bigint, text, text) from public, anon, authenticated;

-- ------------------------------------------------
-- 3. CONFIGURABLE SCHEDULE MODE
-- true  = school voting windows may overlap (all schools at once)
-- false = school voting windows must not overlap (sequential)
-- ------------------------------------------------

alter table public.elections
  add column if not exists allow_concurrent_schedules boolean not null default true;

-- PRODUCTION NOTE (applied 2026-09-28 as migration `phase1_security_hardening`):
-- production also ran the line below, so elections that existed before
-- this migration keep the sequential (no-overlap) rule they were created
-- under. New elections still default to concurrent. Not run on load-test.
-- update public.elections set allow_concurrent_schedules = false;

create or replace function public.save_election_school_schedule(
  p_election_id bigint,
  p_school_id bigint,
  p_start_date timestamptz,
  p_end_date timestamptz
)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    v_schedule_id bigint;
    v_election_start timestamptz;
    v_election_end timestamptz;
    v_allow_concurrent boolean;
begin
    if not public.is_admin() then
        raise exception 'Administrator access required.';
    end if;

    select start_date, end_date, allow_concurrent_schedules
    into v_election_start, v_election_end, v_allow_concurrent
    from public.elections
    where id = p_election_id;

    if v_election_start is null then
        raise exception 'Election not found.';
    end if;

    if not exists (select 1 from public.schools where id = p_school_id) then
        raise exception 'School not found.';
    end if;

    if p_end_date <= p_start_date then
        raise exception 'Schedule end must be later than start.';
    end if;

    if p_start_date < v_election_start or p_end_date > v_election_end then
        raise exception 'School schedule must be inside the overall election period.';
    end if;

    -- Sequential elections: no two school voting windows may overlap.
    if not v_allow_concurrent and exists (
        select 1
        from public.election_school_schedules ess
        where ess.election_id = p_election_id
          and ess.school_id <> p_school_id
          and p_start_date < ess.end_date
          and p_end_date > ess.start_date
    ) then
        raise exception 'This voting period overlaps another school schedule. Enable concurrent school schedules for this election to allow overlaps.';
    end if;

    insert into public.election_school_schedules (
        election_id,
        school_id,
        start_date,
        end_date
    )
    values (
        p_election_id,
        p_school_id,
        p_start_date,
        p_end_date
    )
    on conflict (election_id, school_id)
    do update set
        start_date = excluded.start_date,
        end_date = excluded.end_date
    returning id into v_schedule_id;

    return v_schedule_id;
end;
$function$;

revoke all on function public.save_election_school_schedule(bigint, bigint, timestamptz, timestamptz) from public, anon;
grant execute on function public.save_election_school_schedule(bigint, bigint, timestamptz, timestamptz) to authenticated;

create or replace function public.set_election_schedule_mode(
  p_election_id bigint,
  p_allow_concurrent boolean
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
    if not public.is_admin() then
        raise exception 'Administrator access required.';
    end if;

    if p_allow_concurrent is null then
        raise exception 'Schedule mode is required.';
    end if;

    if not exists (select 1 from public.elections where id = p_election_id) then
        raise exception 'Election not found.';
    end if;

    -- Switching to sequential is refused while saved schedules overlap,
    -- so the stored schedules always satisfy the election's own rule.
    if not p_allow_concurrent and exists (
        select 1
        from public.election_school_schedules a
        join public.election_school_schedules b
          on b.election_id = a.election_id
         and b.school_id > a.school_id
         and a.start_date < b.end_date
         and a.end_date > b.start_date
        where a.election_id = p_election_id
    ) then
        raise exception 'Some school schedules overlap. Adjust them before switching this election to sequential schedules.';
    end if;

    update public.elections
    set allow_concurrent_schedules = p_allow_concurrent
    where id = p_election_id;
end;
$function$;

revoke all on function public.set_election_schedule_mode(bigint, boolean) from public, anon;
grant execute on function public.set_election_schedule_mode(bigint, boolean) to authenticated;

commit;

select 'PHASE 1 SUCCESS' as result;

-- ================================================================
-- ROLLBACK (run only if Phase 1 must be undone)
-- ================================================================
-- create policy "students can insert own profile" on public.students
--   for insert to authenticated with check (auth_user_id = (select auth.uid()));
-- grant insert, update, delete on public.students to authenticated;
-- grant execute on function public.submit_vote(bigint, bigint) to authenticated;
-- grant execute on function public.submit_category_vote(bigint, bigint, bigint) to authenticated;
-- grant execute on function public.has_student_voted(bigint) to authenticated;
-- grant execute on function public.get_student_school_schedule(bigint, bigint) to authenticated;
-- grant execute on function public.get_election_results(bigint) to authenticated;
-- grant execute on function public.submit_report(text, text, text, text) to authenticated;
-- grant execute on function public.update_report_status(bigint, text, text) to authenticated;
-- update public.elections set allow_concurrent_schedules = false;  -- restores the old no-overlap rule
