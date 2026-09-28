-- Teachers' Day Voting System - FINAL STABILITY MIGRATION
-- Run once in Supabase SQL Editor as a project owner.
-- This migration is designed to be rerunnable and does not close/open elections.

begin;

-- ================================================================
-- 1. Student account status
-- ================================================================
alter table public.students
  add column if not exists account_status text not null default 'approved';

alter table public.students
  drop constraint if exists students_account_status_check;
alter table public.students
  add constraint students_account_status_check
  check (account_status in ('pending', 'approved', 'suspended'));

-- ================================================================
-- 2. Student-safe election access
-- Admin login state is NOT used to determine whether an election exists.
-- ================================================================
alter table public.elections enable row level security;
alter table public.election_school_schedules enable row level security;
alter table public.students enable row level security;

drop policy if exists "authenticated users can read elections" on public.elections;
create policy "authenticated users can read elections"
on public.elections for select
to authenticated
using (true);

drop policy if exists "authenticated users can read school schedules" on public.election_school_schedules;
create policy "authenticated users can read school schedules"
on public.election_school_schedules for select
to authenticated
using (true);

drop policy if exists "students can read own profile" on public.students;
create policy "students can read own profile"
on public.students for select
to authenticated
using (auth_user_id = auth.uid());

drop policy if exists "admins can read all students" on public.students;
create policy "admins can read all students"
on public.students for select
to authenticated
using (public.is_admin());

drop policy if exists "students can insert own profile" on public.students;
create policy "students can insert own profile"
on public.students for insert
to authenticated
with check (auth_user_id = auth.uid());

-- ================================================================
-- 3. Security-definer student read APIs
-- These make student election/schedule reads independent of admin RLS.
-- They only READ data and never change election status.
-- ================================================================
drop function if exists public.get_student_elections();
create function public.get_student_elections()
returns table (
  id bigint,
  title text,
  start_date timestamptz,
  end_date timestamptz,
  status text
)
language sql
security definer
set search_path = public
as $$
  select e.id, e.title, e.start_date, e.end_date, e.status
  from public.elections e
  where auth.uid() is not null
  order by e.start_date asc;
$$;

drop function if exists public.get_student_school_schedule(bigint, bigint);
create function public.get_student_school_schedule(
  p_election_id bigint,
  p_school_id bigint
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
  select s.id, s.election_id, s.school_id, s.start_date, s.end_date
  from public.election_school_schedules s
  where auth.uid() is not null
    and s.election_id = p_election_id
    and s.school_id = p_school_id
  limit 1;
$$;

grant execute on function public.get_student_elections() to authenticated;
grant execute on function public.get_student_school_schedule(bigint,bigint) to authenticated;

-- ================================================================
-- 4. Correct per-user vote check
-- ================================================================
drop function if exists public.has_student_voted(bigint);
create function public.has_student_voted(p_election_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_student_id bigint;
  v_exists boolean := false;
  v_sql text;
begin
  if v_uid is null then return false; end if;

  select s.id into v_student_id
  from public.students s
  where s.auth_user_id = v_uid
  limit 1;

  if v_student_id is null then return false; end if;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='votes' and column_name='auth_user_id') then
    v_sql := 'select exists(select 1 from public.votes where election_id=$1 and auth_user_id::text=$2::text)';
    execute v_sql into v_exists using p_election_id, v_uid::text;
  elsif exists (select 1 from information_schema.columns where table_schema='public' and table_name='votes' and column_name='user_id') then
    v_sql := 'select exists(select 1 from public.votes where election_id=$1 and user_id::text=$2::text)';
    execute v_sql into v_exists using p_election_id, v_uid::text;
  elsif exists (select 1 from information_schema.columns where table_schema='public' and table_name='votes' and column_name='student_id') then
    v_sql := 'select exists(select 1 from public.votes where election_id=$1 and student_id::text=$2::text)';
    execute v_sql into v_exists using p_election_id, v_student_id::text;
  elsif exists (select 1 from information_schema.columns where table_schema='public' and table_name='votes' and column_name='voter_id') then
    v_sql := 'select exists(select 1 from public.votes where election_id=$1 and voter_id::text=$2::text)';
    execute v_sql into v_exists using p_election_id, v_student_id::text;
  else
    return false;
  end if;

  return coalesce(v_exists, false);
end;
$$;

grant execute on function public.has_student_voted(bigint) to authenticated;

-- ================================================================
-- 5. Report API - drop old signatures first so return types can change.
-- ================================================================
drop function if exists public.create_support_report(text,text,text,text);
drop function if exists public.get_support_reports();
drop function if exists public.update_support_report(bigint,text,text);

create table if not exists public.reports (
  id bigint generated by default as identity primary key,
  student_id bigint references public.students(id) on delete cascade,
  auth_user_id uuid not null default auth.uid(),
  reference_number text not null unique,
  category text not null,
  subject text not null,
  description text not null,
  attachment_path text,
  status text not null default 'new' check (status in ('new','in_review','resolved','closed')),
  admin_response text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.reports enable row level security;

drop policy if exists "students can read own reports" on public.reports;
create policy "students can read own reports"
on public.reports for select to authenticated
using (auth_user_id = auth.uid());

drop policy if exists "admins can read reports" on public.reports;
create policy "admins can read reports"
on public.reports for select to authenticated
using (public.is_admin());

create function public.create_support_report(
  p_category text,
  p_subject text,
  p_description text,
  p_attachment_path text default null
)
returns public.reports
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_student_id bigint;
  v_report public.reports;
  v_ref text;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;

  select id into v_student_id from public.students where auth_user_id = v_uid limit 1;
  if v_student_id is null then raise exception 'Student profile not found'; end if;

  v_ref := 'RPT-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.reports (
    student_id, auth_user_id, reference_number, category, subject, description, attachment_path
  ) values (
    v_student_id, v_uid, v_ref, left(trim(p_category),100), left(trim(p_subject),160), trim(p_description), p_attachment_path
  ) returning * into v_report;

  return v_report;
end;
$$;

create function public.get_support_reports()
returns table (
  id bigint, reference_number text, student_name text, student_number text,
  category text, subject text, description text, attachment_path text,
  status text, admin_response text, created_at timestamptz, updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select r.id, r.reference_number, s.name, s.student_id, r.category, r.subject,
         r.description, r.attachment_path, r.status, r.admin_response, r.created_at, r.updated_at
  from public.reports r
  left join public.students s on s.id = r.student_id
  where public.is_admin()
  order by r.created_at desc;
$$;

create function public.update_support_report(
  p_report_id bigint,
  p_status text,
  p_admin_response text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_status not in ('new','in_review','resolved','closed') then raise exception 'Invalid report status'; end if;

  update public.reports
     set status = p_status,
         admin_response = case when p_admin_response is null then admin_response else nullif(trim(p_admin_response), '') end,
         updated_at = now()
   where id = p_report_id;

  return found;
end;
$$;

grant execute on function public.create_support_report(text,text,text,text) to authenticated;
grant execute on function public.get_support_reports() to authenticated;
grant execute on function public.update_support_report(bigint,text,text) to authenticated;

-- ================================================================
-- 6. Report attachment storage
-- ================================================================
insert into storage.buckets (id, name, public)
values ('report-attachments', 'report-attachments', false)
on conflict (id) do nothing;

drop policy if exists "students upload report attachments" on storage.objects;
create policy "students upload report attachments"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'report-attachments'
  and (storage.foldername(name))[1] = 'reports'
  and (storage.foldername(name))[2] = auth.uid()::text
);

drop policy if exists "users read own report attachments" on storage.objects;
create policy "users read own report attachments"
on storage.objects for select to authenticated
using (
  bucket_id = 'report-attachments'
  and (
    ((storage.foldername(name))[1] = 'reports' and (storage.foldername(name))[2] = auth.uid()::text)
    or public.is_admin()
  )
);

drop policy if exists "users delete own report attachments" on storage.objects;
create policy "users delete own report attachments"
on storage.objects for delete to authenticated
using (
  bucket_id = 'report-attachments'
  and (
    ((storage.foldername(name))[1] = 'reports' and (storage.foldername(name))[2] = auth.uid()::text)
    or public.is_admin()
  )
);

-- ================================================================
-- 7. Admin user-management APIs
-- ================================================================
drop function if exists public.admin_list_students();
drop function if exists public.admin_set_student_status(bigint,text);
drop function if exists public.admin_delete_student(bigint);

create function public.admin_list_students()
returns table (
  id bigint, student_id text, name text, account_status text,
  program_id bigint, program_code text, program_name text,
  school_id bigint, school_code text, school_name text, auth_user_id uuid
)
language sql
security definer
set search_path = public
as $$
  select s.id, s.student_id, s.name, s.account_status,
         s.program_id, p.program_code, p.program_name,
         sc.id, sc.school_code, sc.school_name, s.auth_user_id
  from public.students s
  left join public.programs p on p.id = s.program_id
  left join public.schools sc on sc.id = p.school_id
  where public.is_admin()
  order by sc.school_code nulls last, s.name;
$$;

create function public.admin_set_student_status(p_student_id bigint, p_status text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_status not in ('pending','approved','suspended') then raise exception 'Invalid account status'; end if;
  update public.students set account_status=p_status where id=p_student_id;
  return found;
end;
$$;

create function public.admin_delete_student(p_student_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_user_id uuid;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  select auth_user_id into v_auth_user_id from public.students where id=p_student_id;
  if v_auth_user_id is null then return false; end if;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='votes' and column_name='student_id') then
    execute 'delete from public.votes where student_id=$1' using p_student_id;
  end if;

  delete from public.students where id=p_student_id;
  delete from auth.users where id=v_auth_user_id;
  return true;
end;
$$;

grant execute on function public.admin_list_students() to authenticated;
grant execute on function public.admin_set_student_status(bigint,text) to authenticated;
grant execute on function public.admin_delete_student(bigint) to authenticated;

commit;

-- IMPORTANT:
-- This migration never calls open_election or close_election and contains no
-- logout trigger. Logging out an administrator therefore cannot close an election.
