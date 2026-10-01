-- Admin: which students have voted in an election.
--
-- One row per student who belongs to a school. Only votes in categories
-- that are currently active count, so a student who voted before a
-- category was deactivated still shows as complete.

create or replace function public.admin_student_vote_status(p_election_id bigint)
returns table(student_id bigint, voted_categories integer, active_categories integer, last_voted_at timestamptz)
language sql
stable
security definer
set search_path = public
as $function$
  select s.id,
         coalesce(v.voted, 0)::integer,
         coalesce(a.active, 0)::integer,
         v.last_voted_at
  from public.students s
  join public.programs p on p.id = s.program_id
  left join (
    select c.school_id, count(*) as active
    from public.election_award_categories c
    where c.election_id = p_election_id
      and c.is_active = true
    group by c.school_id
  ) a on a.school_id = p.school_id
  left join (
    select cv.student_id, count(*) as voted, max(cv.created_at) as last_voted_at
    from public.category_votes cv
    join public.election_award_categories c
      on c.id = cv.category_id
     and c.is_active = true
    where cv.election_id = p_election_id
    group by cv.student_id
  ) v on v.student_id = s.id
  where public.is_admin();
$function$;

revoke all on function public.admin_student_vote_status(bigint) from public, anon;
grant execute on function public.admin_student_vote_status(bigint) to authenticated;
