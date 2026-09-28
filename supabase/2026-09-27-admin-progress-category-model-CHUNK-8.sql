-- ================================================================
-- CHUNK 8 — CATEGORY-AWARE ADMIN PROGRESS

-- ------------------------------------------------
-- 0. Allow only admins to read category_votes directly.
-- This also allows the admin Postgres Changes channel to receive
-- category vote INSERT events when Realtime is enabled.
-- ------------------------------------------------

alter table public.category_votes enable row level security;
grant select on public.category_votes to authenticated;

drop policy if exists
  "admins can read category votes"
on public.category_votes;

create policy
  "admins can read category votes"
on public.category_votes
for select
to authenticated
using (public.is_admin());

-- Add category_votes to the Supabase Realtime publication if it is not already there.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'category_votes'
     ) then
    execute 'alter publication supabase_realtime add table public.category_votes';
  end if;
end
$$;

-- Replaces the old school-progress logic that counted public.votes.
-- ================================================================

drop function if exists public.get_admin_school_progress(bigint);

create function public.get_admin_school_progress(
  p_election_id bigint
)
returns table (
  school_id bigint,
  school_code text,
  school_name text,
  logo_url text,
  schedule_start timestamptz,
  schedule_end timestamptz,
  eligible_voters bigint,
  votes_cast bigint,
  ballots_started bigint,
  completed_ballots bigint,
  category_votes bigint,
  participation numeric,
  faculty_results jsonb
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_is_admin boolean;
begin
  select public.is_admin()
  into v_is_admin;

  if not coalesce(v_is_admin, false) then
    raise exception 'Administrator privileges are required.';
  end if;

  return query
  with eligible as (
    select
      pr.school_id,
      count(*)::bigint as eligible_voters
    from public.students as st
    join public.programs as pr
      on pr.id = st.program_id
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
    join public.students as st
      on st.id = cv.student_id
    join public.programs as pr
      on pr.id = st.program_id
    join public.election_award_categories as c
      on c.id = cv.category_id
     and c.election_id = cv.election_id
     and c.school_id = pr.school_id
    where cv.election_id = p_election_id
      and st.account_status = 'approved'
    group by
      pr.school_id,
      cv.student_id
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
  faculty_counts as (
    select
      f.school_id,
      f.id as faculty_id,
      f.faculty_code,
      f.name as faculty_name,
      coalesce(p.program_code, '') as program_code,
      coalesce(p.program_name, 'Program not listed') as program_name,
      count(cv.id)::bigint as vote_count
    from public.faculty as f
    left join public.programs as p
      on p.id = f.program_id
    left join public.category_votes as cv
      on cv.faculty_id = f.id
     and cv.election_id = p_election_id
    group by
      f.school_id,
      f.id,
      f.faculty_code,
      f.name,
      p.program_code,
      p.program_name
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
      else round(
        coalesce(a.completed_ballots, 0)::numeric
        * 100
        / e.eligible_voters::numeric,
        2
      )
    end as participation,
    coalesce(fj.faculty_results, '[]'::jsonb) as faculty_results
  from public.schools as s
  left join eligible as e
    on e.school_id = s.id
  left join activity as a
    on a.school_id = s.id
  left join public.election_school_schedules as ess
    on ess.election_id = p_election_id
   and ess.school_id = s.id
  left join faculty_json as fj
    on fj.school_id = s.id
  order by s.school_code;
end;
$function$;

revoke all on function public.get_admin_school_progress(bigint)
from public;

revoke all on function public.get_admin_school_progress(bigint)
from anon;

grant execute on function public.get_admin_school_progress(bigint)
to authenticated;

select 'CHUNK 8 SUCCESS' as result;
