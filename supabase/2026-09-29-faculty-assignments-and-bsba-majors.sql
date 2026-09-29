-- =====================================================================
-- Faculty assignments + BSBA majors
-- =====================================================================
-- 1. SBM's BSBA-FM / BSBA-MM programs become one program, BSBA, with
--    majors Financial Management (FM) and Marketing Management (MM).
-- 2. A faculty member can now teach any number of (program, major)
--    pairs across any schools, through public.faculty_assignments.
--    A null major means "all majors" (or the program has none).
--    The faculty member appears on the ballot of every school where
--    they hold an assignment. faculty.school_id / faculty.program_id
--    remain as the faculty member's home school and program.
-- 3. Every vote/results function that compared faculty.school_id now
--    goes through the faculty_schools view.
-- 4. admin_import_faculty() imports an Excel file in one transaction.
--
-- Safe to run more than once.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. BSBA restructure
-- ---------------------------------------------------------------------

do $$
declare
  v_sbm_id bigint;
  v_bsba_id bigint;
  v_fm_id bigint;
  v_mm_id bigint;
  v_old_fm bigint;
  v_old_mm bigint;
  v_has_major_col boolean;
begin
  select id into v_sbm_id from public.schools where school_code = 'SBM';

  if v_sbm_id is null then
    raise notice 'SBM school not found; skipping BSBA restructure.';
    return;
  end if;

  select id into v_bsba_id from public.programs where program_code = 'BSBA';

  if v_bsba_id is null then
    insert into public.programs (program_code, program_name, school_id)
    values ('BSBA', 'Bachelor of Science in Business Administration', v_sbm_id)
    returning id into v_bsba_id;
  end if;

  select id into v_fm_id from public.majors where major_code = 'BSBA-FM';
  if v_fm_id is null then
    insert into public.majors (major_code, major_name, program_id)
    values ('BSBA-FM', 'Financial Management', v_bsba_id)
    returning id into v_fm_id;
  end if;

  select id into v_mm_id from public.majors where major_code = 'BSBA-MM';
  if v_mm_id is null then
    insert into public.majors (major_code, major_name, program_id)
    values ('BSBA-MM', 'Marketing Management', v_bsba_id)
    returning id into v_mm_id;
  end if;

  select id into v_old_fm from public.programs where program_code = 'BSBA-FM';
  select id into v_old_mm from public.programs where program_code = 'BSBA-MM';

  -- Load-test's students table has no major_id column.
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'students' and column_name = 'major_id'
  ) into v_has_major_col;

  if v_old_fm is not null then
    if v_has_major_col then
      execute 'update public.students set program_id = $1, major_id = $2 where program_id = $3'
        using v_bsba_id, v_fm_id, v_old_fm;
    else
      update public.students set program_id = v_bsba_id where program_id = v_old_fm;
    end if;
    update public.faculty set program_id = v_bsba_id where program_id = v_old_fm;
    delete from public.programs where id = v_old_fm;
  end if;

  if v_old_mm is not null then
    if v_has_major_col then
      execute 'update public.students set program_id = $1, major_id = $2 where program_id = $3'
        using v_bsba_id, v_mm_id, v_old_mm;
    else
      update public.students set program_id = v_bsba_id where program_id = v_old_mm;
    end if;
    update public.faculty set program_id = v_bsba_id where program_id = v_old_mm;
    delete from public.programs where id = v_old_mm;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. faculty_assignments
-- ---------------------------------------------------------------------

create table if not exists public.faculty_assignments (
  id bigint generated always as identity primary key,
  faculty_id bigint not null references public.faculty(id) on delete cascade,
  program_id bigint not null references public.programs(id) on delete cascade,
  major_id bigint references public.majors(id) on delete cascade,
  created_at timestamptz not null default now()
);

create unique index if not exists faculty_assignments_unique
  on public.faculty_assignments (faculty_id, program_id, coalesce(major_id, 0));

create index if not exists idx_faculty_assignments_program_id
  on public.faculty_assignments (program_id);

create or replace function public.check_faculty_assignment_major()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.major_id is not null and not exists (
    select 1 from public.majors m
    where m.id = new.major_id and m.program_id = new.program_id
  ) then
    raise exception 'Major % does not belong to program %.', new.major_id, new.program_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_check_faculty_assignment_major on public.faculty_assignments;
create trigger trg_check_faculty_assignment_major
  before insert or update on public.faculty_assignments
  for each row execute function public.check_faculty_assignment_major();

alter table public.faculty_assignments enable row level security;

drop policy if exists "Authenticated users can view faculty assignments" on public.faculty_assignments;
create policy "Authenticated users can view faculty assignments"
  on public.faculty_assignments for select to authenticated using (true);

drop policy if exists "Admins can insert faculty assignments" on public.faculty_assignments;
create policy "Admins can insert faculty assignments"
  on public.faculty_assignments for insert to authenticated with check (public.is_admin());

drop policy if exists "Admins can update faculty assignments" on public.faculty_assignments;
create policy "Admins can update faculty assignments"
  on public.faculty_assignments for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins can delete faculty assignments" on public.faculty_assignments;
create policy "Admins can delete faculty assignments"
  on public.faculty_assignments for delete to authenticated using (public.is_admin());

-- Backfill: every existing faculty member teaches their home program.
insert into public.faculty_assignments (faculty_id, program_id)
select f.id, f.program_id
from public.faculty f
where not exists (
  select 1 from public.faculty_assignments fa where fa.faculty_id = f.id
);

create or replace view public.faculty_schools
with (security_invoker = true) as
select distinct fa.faculty_id, p.school_id
from public.faculty_assignments fa
join public.programs p on p.id = fa.program_id;

grant select on public.faculty_schools to authenticated;

-- "BSBA (FM, MM) · BSIT": what a faculty member teaches in one school.
-- A null-major assignment covers the whole program, so it wins over
-- any specific majors of the same program.
create or replace function public.faculty_teaches_label(p_faculty_id bigint, p_school_id bigint)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select string_agg(label, ' · ' order by program_code)
  from (
    select
      p.program_code,
      case
        when bool_or(fa.major_id is null) then p.program_code
        else p.program_code || ' (' || string_agg(
          regexp_replace(m.major_code, '^' || p.program_code || '-', ''),
          ', ' order by m.major_code
        ) || ')'
      end as label
    from public.faculty_assignments fa
    join public.programs p on p.id = fa.program_id
    left join public.majors m on m.id = fa.major_id
    where fa.faculty_id = p_faculty_id
      and p.school_id = p_school_id
    group by p.program_code
  ) per_program;
$$;

revoke all on function public.faculty_teaches_label(bigint, bigint) from public, anon;
grant execute on function public.faculty_teaches_label(bigint, bigint) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Vote + results functions: school membership via faculty_schools
-- ---------------------------------------------------------------------

create or replace function public.submit_category_vote(p_election_id bigint, p_category_id bigint, p_faculty_id bigint)
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
begin
  v_uid := (select auth.uid());

  if v_uid is null then
    raise exception 'Authentication is required.';
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

  select c.election_id, c.school_id
  into v_category_election_id, v_category_school_id
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

  if not exists (select 1 from public.faculty where id = p_faculty_id) then
    raise exception 'Faculty member not found.';
  end if;

  if not exists (
    select 1 from public.faculty_schools fs
    where fs.faculty_id = p_faculty_id
      and fs.school_id = v_student_school_id
  ) then
    raise exception 'You can only vote for faculty from your school.';
  end if;

  begin
    insert into public.category_votes (election_id, category_id, student_id, faculty_id)
    values (p_election_id, p_category_id, v_student_id, p_faculty_id);
  exception
    when unique_violation then
      raise exception 'You have already voted in this award category.';
  end;
end;
$function$;

-- Legacy single-vote entry point: routes to the Teacher of the Year
-- category (this is the version prod already runs).
create or replace function public.submit_vote(p_election_id bigint, p_faculty_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_student_school_id bigint;
  v_category_id bigint;
begin
  select p.school_id
    into v_student_school_id
  from public.students s
  join public.programs p on p.id = s.program_id
  where s.auth_user_id = v_uid
  limit 1;

  if v_student_school_id is null then
    raise exception 'Student profile not found.';
  end if;

  select c.id
    into v_category_id
  from public.election_award_categories c
  where c.election_id = p_election_id
    and c.school_id = v_student_school_id
    and c.category_key = 'teacher_of_the_year'
    and c.is_active = true
  limit 1;

  if v_category_id is null then
    raise exception 'Teacher of the Year category is not configured for your school.';
  end if;

  perform public.submit_category_vote(p_election_id, v_category_id, p_faculty_id);
end;
$function$;

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

-- Legacy (pre-category) results. A faculty member in several schools
-- gets one row per school; the legacy votes table has no school, so the
-- count is the same on each row.
create or replace function public.get_election_results(p_election_id bigint)
returns table(school_code text, school_name text, faculty_id bigint, faculty_code text, faculty_name text, program_code text, program_name text, vote_count bigint)
language plpgsql
security definer
set search_path = public
as $function$
begin
  if not public.is_admin() then
    raise exception 'Administrator access required.';
  end if;

  if not exists (select 1 from public.elections where id = p_election_id) then
    raise exception 'Election not found.';
  end if;

  return query
  select
    s.school_code,
    s.school_name,
    f.id as faculty_id,
    f.faculty_code,
    f.name as faculty_name,
    public.faculty_teaches_label(f.id, s.id) as program_code,
    public.faculty_teaches_label(f.id, s.id) as program_name,
    count(v.id)::bigint as vote_count
  from public.faculty f
  join public.faculty_schools fs on fs.faculty_id = f.id
  join public.schools s on s.id = fs.school_id
  left join public.votes v
    on v.faculty_id = f.id
   and v.election_id = p_election_id
  group by s.id, s.school_code, s.school_name, f.id, f.faculty_code, f.name
  order by s.school_code, vote_count desc, f.name;
end;
$function$;

create or replace function public.get_election_category_results(p_election_id bigint, p_category_id bigint)
returns table(school_code text, school_name text, logo_url text, faculty_id bigint, faculty_name text, program_name text, vote_count bigint)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_is_admin boolean;
  v_category_school_id bigint;
begin
  select public.is_admin() into v_is_admin;

  if not coalesce(v_is_admin, false) then
    raise exception 'Administrator privileges are required.';
  end if;

  select c.school_id
    into v_category_school_id
  from public.election_award_categories c
  where c.id = p_category_id
    and c.election_id = p_election_id
    and c.is_active = true;

  if v_category_school_id is null then
    raise exception 'Invalid award category for this election.';
  end if;

  return query
  select
    s.school_code,
    s.school_name,
    s.logo_url,
    f.id as faculty_id,
    f.name as faculty_name,
    coalesce(public.faculty_teaches_label(f.id, s.id), 'Program not listed') as program_name,
    count(cv.id)::bigint as vote_count
  from public.schools s
  join public.faculty_schools fs on fs.school_id = s.id
  join public.faculty f on f.id = fs.faculty_id
  left join public.category_votes cv
    on cv.election_id = p_election_id
   and cv.category_id = p_category_id
   and cv.faculty_id = f.id
  where s.id = v_category_school_id
  group by s.id, s.school_code, s.school_name, s.logo_url, f.id, f.name
  order by count(cv.id) desc, f.name;
end;
$function$;

create or replace function public.get_admin_school_progress(p_election_id bigint)
returns table(school_id bigint, school_code text, school_name text, logo_url text, schedule_start timestamp with time zone, schedule_end timestamp with time zone, eligible_voters bigint, votes_cast bigint, ballots_started bigint, completed_ballots bigint, category_votes bigint, participation numeric, faculty_results jsonb)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_is_admin boolean;
begin
  select public.is_admin() into v_is_admin;

  if not coalesce(v_is_admin, false) then
    raise exception 'Administrator privileges are required.';
  end if;

  return query
  with eligible as (
    select pr.school_id, count(*)::bigint as eligible_voters
    from public.students as st
    join public.programs as pr on pr.id = st.program_id
    where st.account_status = 'approved'
    group by pr.school_id
  ),
  per_student as (
    select
      pr.school_id,
      cv.student_id,
      count(distinct cv.category_id)::integer as category_count,
      count(*)::bigint as category_vote_count
    from public.category_votes as cv
    join public.students as st on st.id = cv.student_id
    join public.programs as pr on pr.id = st.program_id
    join public.election_award_categories as c
      on c.id = cv.category_id
     and c.election_id = cv.election_id
     and c.school_id = pr.school_id
    where cv.election_id = p_election_id
      and st.account_status = 'approved'
    group by pr.school_id, cv.student_id
  ),
  activity as (
    select
      ps.school_id,
      count(*)::bigint as ballots_started,
      count(*) filter (where ps.category_count = 9)::bigint as completed_ballots,
      coalesce(sum(ps.category_vote_count), 0)::bigint as category_votes
    from per_student as ps
    group by ps.school_id
  ),
  -- One row per (school, faculty). Only votes cast in that school's
  -- categories count toward that school's row.
  faculty_counts as (
    select
      fs.school_id,
      f.id as faculty_id,
      f.faculty_code,
      f.name as faculty_name,
      coalesce(public.faculty_teaches_label(f.id, fs.school_id), '') as program_code,
      coalesce(public.faculty_teaches_label(f.id, fs.school_id), 'Program not listed') as program_name,
      count(cv.id)::bigint as vote_count
    from public.faculty_schools as fs
    join public.faculty as f on f.id = fs.faculty_id
    left join public.election_award_categories as c
      on c.election_id = p_election_id
     and c.school_id = fs.school_id
    left join public.category_votes as cv
      on cv.faculty_id = f.id
     and cv.election_id = p_election_id
     and cv.category_id = c.id
    group by fs.school_id, f.id, f.faculty_code, f.name
  ),
  faculty_json as (
    select
      fc.school_id,
      jsonb_agg(
        jsonb_build_object(
          'faculty_id', fc.faculty_id,
          'faculty_code', fc.faculty_code,
          'faculty_name', fc.faculty_name,
          'program_code', fc.program_code,
          'program_name', fc.program_name,
          'vote_count', fc.vote_count
        )
        order by fc.vote_count desc, fc.faculty_name
      ) as faculty_results
    from faculty_counts as fc
    group by fc.school_id
  )
  select
    s.id as school_id,
    s.school_code,
    s.school_name,
    s.logo_url,
    ess.start_date as schedule_start,
    ess.end_date as schedule_end,
    coalesce(e.eligible_voters, 0)::bigint as eligible_voters,
    coalesce(a.completed_ballots, 0)::bigint as votes_cast,
    coalesce(a.ballots_started, 0)::bigint as ballots_started,
    coalesce(a.completed_ballots, 0)::bigint as completed_ballots,
    coalesce(a.category_votes, 0)::bigint as category_votes,
    case
      when coalesce(e.eligible_voters, 0) = 0 then 0::numeric
      else round(coalesce(a.completed_ballots, 0)::numeric * 100 / e.eligible_voters::numeric, 2)
    end as participation,
    coalesce(fj.faculty_results, '[]'::jsonb) as faculty_results
  from public.schools as s
  left join eligible as e on e.school_id = s.id
  left join activity as a on a.school_id = s.id
  left join public.election_school_schedules as ess
    on ess.election_id = p_election_id
   and ess.school_id = s.id
  left join faculty_json as fj on fj.school_id = s.id
  order by s.school_code;
end;
$function$;

-- ---------------------------------------------------------------------
-- 4. Admin Excel import
-- ---------------------------------------------------------------------
-- p_rows: [{ "faculty_code", "name", "program_id", "major_id" (nullable) }]
-- One element per assignment. New faculty codes are created with the
-- first row as their home program/school; existing codes only gain the
-- new assignments. Duplicate assignments are skipped.

create or replace function public.admin_import_faculty(p_rows jsonb)
returns table(new_faculty integer, new_assignments integer)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_new_faculty integer := 0;
  v_new_assignments integer := 0;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'Administrator privileges are required.';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'No faculty rows were provided.';
  end if;

  drop table if exists tmp_faculty_rows;

  create temporary table tmp_faculty_rows on commit drop as
  select
    e.row_no,
    btrim(e.item->>'faculty_code') as faculty_code,
    btrim(e.item->>'name') as name,
    nullif(e.item->>'program_id', '')::bigint as program_id,
    nullif(e.item->>'major_id', '')::bigint as major_id
  from jsonb_array_elements(p_rows) with ordinality as e(item, row_no);

  if exists (
    select 1 from tmp_faculty_rows
    where coalesce(faculty_code, '') = '' or coalesce(name, '') = '' or program_id is null
  ) then
    raise exception 'Every row needs a Faculty Code, Name and Program.';
  end if;

  if exists (
    select 1 from tmp_faculty_rows t
    left join public.programs p on p.id = t.program_id
    where p.id is null
  ) then
    raise exception 'One or more rows refer to a program that does not exist.';
  end if;

  if exists (
    select 1 from tmp_faculty_rows t
    where t.major_id is not null and not exists (
      select 1 from public.majors m where m.id = t.major_id and m.program_id = t.program_id
    )
  ) then
    raise exception 'One or more majors do not belong to their program.';
  end if;

  with firsts as (
    select distinct on (t.faculty_code) t.faculty_code, t.name, t.program_id, p.school_id
    from tmp_faculty_rows t
    join public.programs p on p.id = t.program_id
    where not exists (select 1 from public.faculty f where f.faculty_code = t.faculty_code)
    order by t.faculty_code, t.row_no
  )
  insert into public.faculty (faculty_code, name, program_id, school_id)
  select faculty_code, name, program_id, school_id from firsts;

  get diagnostics v_new_faculty = row_count;

  insert into public.faculty_assignments (faculty_id, program_id, major_id)
  select distinct f.id, t.program_id, t.major_id
  from tmp_faculty_rows t
  join public.faculty f on f.faculty_code = t.faculty_code
  on conflict do nothing;

  get diagnostics v_new_assignments = row_count;

  return query select v_new_faculty, v_new_assignments;
end;
$function$;

revoke all on function public.admin_import_faculty(jsonb) from public, anon;
grant execute on function public.admin_import_faculty(jsonb) to authenticated;

commit;
