-- ================================================================
-- CHUNK 7 — STUDENT SCHEDULE ISOLATION + SECURE BALLOT SUBMISSION
-- Run after award-category chunks 1–6 have succeeded.
-- ================================================================

-- ------------------------------------------------
-- 1. AUTH-DERIVED SCHOOL SCHEDULE
-- The client supplies only the election id.
-- The database derives the school from auth.uid().
-- ------------------------------------------------

drop function if exists public.get_my_school_election_schedule(bigint);

create function public.get_my_school_election_schedule(
  p_election_id bigint
)
returns table (
  id bigint,
  election_id bigint,
  school_id bigint,
  start_date timestamptz,
  end_date timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    ess.id,
    ess.election_id,
    ess.school_id,
    ess.start_date,
    ess.end_date
  from public.election_school_schedules as ess
  join public.students as st
    on st.auth_user_id = (select auth.uid())
  join public.programs as pr
    on pr.id = st.program_id
   and pr.school_id = ess.school_id
  where ess.election_id = p_election_id
  limit 1;
$$;

revoke all on function public.get_my_school_election_schedule(bigint)
from public;

revoke all on function public.get_my_school_election_schedule(bigint)
from anon;

grant execute on function public.get_my_school_election_schedule(bigint)
to authenticated;

-- ------------------------------------------------
-- 2. HARDEN EXISTING SINGLE-CATEGORY RPC
-- Keep this for compatibility with any older client code.
-- ------------------------------------------------

drop function if exists public.submit_category_vote(bigint, bigint, bigint);

create function public.submit_category_vote(
  p_election_id bigint,
  p_category_id bigint,
  p_faculty_id bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_uid uuid;
  v_student_id bigint;
  v_student_school_id bigint;
  v_account_status text;

  v_election_status text;
  v_election_start timestamptz;
  v_election_end timestamptz;

  v_category_election_id bigint;
  v_category_school_id bigint;

  v_schedule_start timestamptz;
  v_schedule_end timestamptz;

  v_faculty_school_id bigint;
begin
  v_uid := (select auth.uid());

  if v_uid is null then
    raise exception 'Authentication is required.';
  end if;

  select
    st.id,
    pr.school_id,
    st.account_status
  into
    v_student_id,
    v_student_school_id,
    v_account_status
  from public.students as st
  join public.programs as pr
    on pr.id = st.program_id
  where st.auth_user_id = v_uid
  limit 1;

  if v_student_id is null then
    raise exception 'Student profile not found.';
  end if;

  if coalesce(v_account_status, 'approved') <> 'approved' then
    raise exception 'Your student account is not approved for voting.';
  end if;

  select
    e.status,
    e.start_date,
    e.end_date
  into
    v_election_status,
    v_election_start,
    v_election_end
  from public.elections as e
  where e.id = p_election_id;

  if v_election_status is null then
    raise exception 'Election not found.';
  end if;

  if v_election_status <> 'open' then
    raise exception 'This election is not open.';
  end if;

  if now() < v_election_start then
    raise exception 'The election has not started yet.';
  end if;

  if now() > v_election_end then
    raise exception 'The election has already ended.';
  end if;

  select
    c.election_id,
    c.school_id
  into
    v_category_election_id,
    v_category_school_id
  from public.election_award_categories as c
  where c.id = p_category_id
    and c.is_active = true;

  if v_category_election_id is null then
    raise exception 'Invalid award category.';
  end if;

  if v_category_election_id <> p_election_id then
    raise exception 'This award category does not belong to this election.';
  end if;

  if v_category_school_id <> v_student_school_id then
    raise exception 'This award category is not available for your school.';
  end if;

  select
    ess.start_date,
    ess.end_date
  into
    v_schedule_start,
    v_schedule_end
  from public.election_school_schedules as ess
  where ess.election_id = p_election_id
    and ess.school_id = v_student_school_id
  limit 1;

  if v_schedule_start is null or v_schedule_end is null then
    raise exception 'Voting for your school is not configured.';
  end if;

  if now() < v_schedule_start then
    raise exception 'Voting for your school has not started yet.';
  end if;

  if now() > v_schedule_end then
    raise exception 'Voting for your school has already ended.';
  end if;

  select f.school_id
  into v_faculty_school_id
  from public.faculty as f
  where f.id = p_faculty_id;

  if v_faculty_school_id is null then
    raise exception 'Faculty member not found.';
  end if;

  if v_faculty_school_id <> v_student_school_id then
    raise exception 'You can only vote for faculty from your school.';
  end if;

  begin
    insert into public.category_votes (
      election_id,
      category_id,
      student_id,
      faculty_id
    )
    values (
      p_election_id,
      p_category_id,
      v_student_id,
      p_faculty_id
    );
  exception
    when unique_violation then
      raise exception 'You have already voted in this award category.';
  end;
end;
$function$;

revoke all on function public.submit_category_vote(bigint, bigint, bigint)
from public;

revoke all on function public.submit_category_vote(bigint, bigint, bigint)
from anon;

grant execute on function public.submit_category_vote(bigint, bigint, bigint)
to authenticated;

-- ------------------------------------------------
-- 3. ONE FINAL BALLOT RPC
-- p_votes format:
-- [
--   {"category_id": 101, "faculty_id": 20},
--   {"category_id": 102, "faculty_id": 31},
--   ...
-- ]
--
-- The function accepts all remaining categories in one transaction.
-- The frontend must provide one selection for every category not yet voted.
-- ------------------------------------------------

drop function if exists public.submit_full_ballot(bigint, jsonb);

create function public.submit_full_ballot(
  p_election_id bigint,
  p_votes jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_uid uuid;
  v_student_id bigint;
  v_student_school_id bigint;
  v_account_status text;

  v_election_status text;
  v_election_start timestamptz;
  v_election_end timestamptz;

  v_schedule_start timestamptz;
  v_schedule_end timestamptz;

  v_active_categories integer;
  v_existing_votes integer;
  v_submitted_votes integer;
  v_duplicate_categories integer;
  v_invalid_categories integer;
  v_invalid_faculty integer;
  v_inserted integer;
begin
  v_uid := (select auth.uid());

  if v_uid is null then
    raise exception 'Authentication is required.';
  end if;

  if p_votes is null or jsonb_typeof(p_votes) <> 'array' then
    raise exception 'Ballot selections must be a JSON array.';
  end if;

  select
    st.id,
    pr.school_id,
    st.account_status
  into
    v_student_id,
    v_student_school_id,
    v_account_status
  from public.students as st
  join public.programs as pr
    on pr.id = st.program_id
  where st.auth_user_id = v_uid
  limit 1;

  if v_student_id is null then
    raise exception 'Student profile not found.';
  end if;

  if coalesce(v_account_status, 'approved') <> 'approved' then
    raise exception 'Your student account is not approved for voting.';
  end if;

  select
    e.status,
    e.start_date,
    e.end_date
  into
    v_election_status,
    v_election_start,
    v_election_end
  from public.elections as e
  where e.id = p_election_id;

  if v_election_status is null then
    raise exception 'Election not found.';
  end if;

  if v_election_status <> 'open' then
    raise exception 'This election is not open.';
  end if;

  if now() < v_election_start then
    raise exception 'The election has not started yet.';
  end if;

  if now() > v_election_end then
    raise exception 'The election has already ended.';
  end if;

  select
    ess.start_date,
    ess.end_date
  into
    v_schedule_start,
    v_schedule_end
  from public.election_school_schedules as ess
  where ess.election_id = p_election_id
    and ess.school_id = v_student_school_id
  limit 1;

  if v_schedule_start is null or v_schedule_end is null then
    raise exception 'Voting for your school is not configured.';
  end if;

  if now() < v_schedule_start then
    raise exception 'Voting for your school has not started yet.';
  end if;

  if now() > v_schedule_end then
    raise exception 'Voting for your school has already ended.';
  end if;

  select count(*)::integer
  into v_active_categories
  from public.election_award_categories as c
  where c.election_id = p_election_id
    and c.school_id = v_student_school_id
    and c.is_active = true;

  if v_active_categories <> 9 then
    raise exception 'The official ballot is not fully configured for your school.';
  end if;

  select count(*)::integer
  into v_existing_votes
  from public.category_votes as cv
  where cv.election_id = p_election_id
    and cv.student_id = v_student_id;

  select count(*)::integer
  into v_submitted_votes
  from jsonb_to_recordset(p_votes)
    as submitted(category_id bigint, faculty_id bigint);

  if v_submitted_votes <> (v_active_categories - v_existing_votes) then
    raise exception 'Please select one faculty member for every remaining award category.';
  end if;

  select count(*)::integer
  into v_duplicate_categories
  from (
    select category_id
    from jsonb_to_recordset(p_votes)
      as submitted(category_id bigint, faculty_id bigint)
    group by category_id
    having count(*) > 1
  ) as duplicates;

  if v_duplicate_categories > 0 then
    raise exception 'Each award category can appear only once in a ballot.';
  end if;

  select count(*)::integer
  into v_invalid_categories
  from jsonb_to_recordset(p_votes)
    as submitted(category_id bigint, faculty_id bigint)
  left join public.election_award_categories as c
    on c.id = submitted.category_id
   and c.election_id = p_election_id
   and c.school_id = v_student_school_id
   and c.is_active = true
  where c.id is null;

  if v_invalid_categories > 0 then
    raise exception 'One or more ballot categories are invalid for your school.';
  end if;

  select count(*)::integer
  into v_invalid_faculty
  from jsonb_to_recordset(p_votes)
    as submitted(category_id bigint, faculty_id bigint)
  left join public.faculty as f
    on f.id = submitted.faculty_id
   and f.school_id = v_student_school_id
  where f.id is null;

  if v_invalid_faculty > 0 then
    raise exception 'One or more selected faculty members are not from your school.';
  end if;

  -- Reject any category that this student has already submitted.
  if exists (
    select 1
    from jsonb_to_recordset(p_votes)
      as submitted(category_id bigint, faculty_id bigint)
    join public.category_votes as cv
      on cv.election_id = p_election_id
     and cv.category_id = submitted.category_id
     and cv.student_id = v_student_id
  ) then
    raise exception 'One or more ballot categories have already been submitted.';
  end if;

  insert into public.category_votes (
    election_id,
    category_id,
    student_id,
    faculty_id
  )
  select
    p_election_id,
    submitted.category_id,
    v_student_id,
    submitted.faculty_id
  from jsonb_to_recordset(p_votes)
    as submitted(category_id bigint, faculty_id bigint);

  get diagnostics v_inserted = row_count;

  return v_inserted;

exception
  when unique_violation then
    raise exception 'One or more ballot categories were already submitted. Please refresh and review your ballot.';
end;
$function$;

revoke all on function public.submit_full_ballot(bigint, jsonb)
from public;

revoke all on function public.submit_full_ballot(bigint, jsonb)
from anon;

grant execute on function public.submit_full_ballot(bigint, jsonb)
to authenticated;

select 'CHUNK 7 SUCCESS' as result;
