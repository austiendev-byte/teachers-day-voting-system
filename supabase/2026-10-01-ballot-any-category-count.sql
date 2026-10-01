-- Ballot no longer assumes exactly nine award categories.
--
-- Teacher of the Year was deactivated mid-election, leaving eight active
-- categories per school. submit_full_ballot now accepts any non-zero
-- number of active categories, and only votes in active categories count
-- toward the student's remaining ballot.
--
-- This mirrors the definition already live in production; it supersedes
-- the "<> 9" versions in 2026-09-27-...-CHUNK-7.sql and
-- 2026-09-29-faculty-assignments-and-bsba-majors.sql.

create or replace function public.submit_full_ballot(p_election_id bigint, p_votes jsonb)
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

  select st.id, pr.school_id, st.account_status
  into v_student_id, v_student_school_id, v_account_status
  from public.students as st
  join public.programs as pr on pr.id = st.program_id
  where st.auth_user_id = v_uid
  limit 1;

  if v_student_id is null then
    raise exception 'Student profile not found.';
  end if;

  if coalesce(v_account_status, 'approved') <> 'approved' then
    raise exception 'Your student account is not approved for voting.';
  end if;

  select e.status, e.start_date, e.end_date
  into v_election_status, v_election_start, v_election_end
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

  select ess.start_date, ess.end_date
  into v_schedule_start, v_schedule_end
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

  if v_active_categories = 0 then
    raise exception 'The official ballot is not fully configured for your school.';
  end if;

  select count(*)::integer
  into v_existing_votes
  from public.category_votes as cv
  join public.election_award_categories as c
    on c.id = cv.category_id
   and c.is_active = true
  where cv.election_id = p_election_id
    and cv.student_id = v_student_id;

  select count(*)::integer
  into v_submitted_votes
  from jsonb_to_recordset(p_votes) as submitted(category_id bigint, faculty_id bigint);

  if v_submitted_votes <> (v_active_categories - v_existing_votes) then
    raise exception 'Please select one faculty member for every remaining award category.';
  end if;

  select count(*)::integer
  into v_duplicate_categories
  from (
    select category_id
    from jsonb_to_recordset(p_votes) as submitted(category_id bigint, faculty_id bigint)
    group by category_id
    having count(*) > 1
  ) as duplicates;

  if v_duplicate_categories > 0 then
    raise exception 'Each award category can appear only once in a ballot.';
  end if;

  select count(*)::integer
  into v_invalid_categories
  from jsonb_to_recordset(p_votes) as submitted(category_id bigint, faculty_id bigint)
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
  from jsonb_to_recordset(p_votes) as submitted(category_id bigint, faculty_id bigint)
  left join public.faculty_schools as fs
    on fs.faculty_id = submitted.faculty_id
   and fs.school_id = v_student_school_id
  where fs.faculty_id is null;

  if v_invalid_faculty > 0 then
    raise exception 'One or more selected faculty members are not from your school.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_votes) as submitted(category_id bigint, faculty_id bigint)
    join public.category_votes as cv
      on cv.election_id = p_election_id
     and cv.category_id = submitted.category_id
     and cv.student_id = v_student_id
  ) then
    raise exception 'One or more ballot categories have already been submitted.';
  end if;

  insert into public.category_votes (election_id, category_id, student_id, faculty_id)
  select p_election_id, submitted.category_id, v_student_id, submitted.faculty_id
  from jsonb_to_recordset(p_votes) as submitted(category_id bigint, faculty_id bigint);

  get diagnostics v_inserted = row_count;
  return v_inserted;

exception
  when unique_violation then
    raise exception 'One or more ballot categories were already submitted. Please refresh and review your ballot.';
end;
$function$;
