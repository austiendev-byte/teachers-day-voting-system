-- Teachers' Day Voting System - stability/auth/user-management migration
-- Run this in Supabase SQL Editor as a project owner.

begin;

-- 1) New registrations are pending. Existing students remain approved.
alter table public.students
  add column if not exists account_status text not null default 'approved';

alter table public.students
  drop constraint if exists students_account_status_check;

alter table public.students
  add constraint students_account_status_check
  check (account_status in ('pending', 'approved', 'suspended'));

-- 2) Student-facing election/schedule data must not depend on an admin session.
alter table public.elections enable row level security;
alter table public.election_school_schedules enable row level security;

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

-- 3) Students can read their own profile; administrators can manage students.
alter table public.students enable row level security;

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

-- 4) Correct vote lookup: only the currently authenticated student's vote counts.
-- The function detects the common voter column names used by the project.
create or replace function public.has_student_voted(p_election_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id bigint;
  v_auth_user_id uuid := auth.uid();
  v_exists boolean := false;
  v_sql text;
begin
  select id into v_student_id
  from public.students
  where auth_user_id = v_auth_user_id
  limit 1;

  if v_student_id is null then
    return false;
  end if;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='votes' and column_name='student_id') then
    v_sql := 'select exists(select 1 from public.votes where election_id=$1 and student_id=$2)';
    execute v_sql into v_exists using p_election_id, v_student_id;
  elsif exists (select 1 from information_schema.columns where table_schema='public' and table_name='votes' and column_name='auth_user_id') then
    v_sql := 'select exists(select 1 from public.votes where election_id=$1 and auth_user_id=$2)';
    execute v_sql into v_exists using p_election_id, v_auth_user_id;
  elsif exists (select 1 from information_schema.columns where table_schema='public' and table_name='votes' and column_name='voter_id') then
    v_sql := 'select exists(select 1 from public.votes where election_id=$1 and voter_id=$2)';
    execute v_sql into v_exists using p_election_id, v_student_id;
  else
    return false;
  end if;

  return coalesce(v_exists, false);
end;
$$;

revoke all on function public.has_student_voted(bigint) from public;
grant execute on function public.has_student_voted(bigint) to authenticated;

-- 5) Admin user management RPCs.
create or replace function public.admin_list_students()
returns table (
  id bigint,
  student_id text,
  name text,
  account_status text,
  program_id bigint,
  program_code text,
  program_name text,
  school_id bigint,
  school_code text,
  school_name text,
  auth_user_id uuid
)
language sql
security definer
set search_path = public
as $$
  select
    s.id,
    s.student_id,
    s.name,
    s.account_status,
    s.program_id,
    p.program_code,
    p.program_name,
    sc.id,
    sc.school_code,
    sc.school_name,
    s.auth_user_id
  from public.students s
  left join public.programs p on p.id = s.program_id
  left join public.schools sc on sc.id = p.school_id
  where public.is_admin()
  order by sc.school_code nulls last, s.name;
$$;

create or replace function public.admin_set_student_status(p_student_id bigint, p_status text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access required';
  end if;
  if p_status not in ('pending','approved','suspended') then
    raise exception 'Invalid account status';
  end if;
  update public.students set account_status=p_status where id=p_student_id;
  return found;
end;
$$;

create or replace function public.admin_delete_student(p_student_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_user_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required';
  end if;

  select auth_user_id into v_auth_user_id from public.students where id=p_student_id;
  if v_auth_user_id is null then
    return false;
  end if;

  -- Remove vote rows first when the votes table uses student_id.
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='votes' and column_name='student_id') then
    execute 'delete from public.votes where student_id=$1' using p_student_id;
  end if;

  delete from public.students where id=p_student_id;
  delete from auth.users where id=v_auth_user_id;
  return true;
end;
$$;

revoke all on function public.admin_list_students() from public;
revoke all on function public.admin_set_student_status(bigint,text) from public;
revoke all on function public.admin_delete_student(bigint) from public;
grant execute on function public.admin_list_students() to authenticated;
grant execute on function public.admin_set_student_status(bigint,text) to authenticated;
grant execute on function public.admin_delete_student(bigint) to authenticated;

commit;

-- 6) Support reports: create the report API used by the student/admin pages.
-- Safe to run repeatedly.
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

alter table public.reports
  add column if not exists student_id bigint,
  add column if not exists auth_user_id uuid,
  add column if not exists reference_number text,
  add column if not exists category text,
  add column if not exists subject text,
  add column if not exists description text,
  add column if not exists attachment_path text,
  add column if not exists status text default 'new',
  add column if not exists admin_response text,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

alter table public.reports enable row level security;

drop policy if exists "students can read own reports" on public.reports;
create policy "students can read own reports"
on public.reports for select to authenticated
using (auth_user_id = auth.uid());

drop policy if exists "admins can read reports" on public.reports;
create policy "admins can read reports"
on public.reports for select to authenticated
using (public.is_admin());

create or replace function public.create_support_report(
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
  v_user uuid := auth.uid();
  v_student_id bigint;
  v_report public.reports;
  v_ref text;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select id into v_student_id from public.students where auth_user_id = v_user limit 1;
  if v_student_id is null then raise exception 'Student profile not found'; end if;

  v_ref := 'RPT-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.reports (
    student_id, auth_user_id, reference_number, category, subject, description, attachment_path
  ) values (
    v_student_id, v_user, v_ref, left(trim(p_category), 100), left(trim(p_subject), 160), trim(p_description), p_attachment_path
  ) returning * into v_report;

  return v_report;
end;
$$;

create or replace function public.get_support_reports()
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

create or replace function public.update_support_report(
  p_report_id bigint, p_status text, p_admin_response text default null
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
         admin_response = nullif(trim(p_admin_response), ''),
         updated_at = now()
   where id = p_report_id;
  return found;
end;
$$;

grant execute on function public.create_support_report(text,text,text,text) to authenticated;
grant execute on function public.get_support_reports() to authenticated;
grant execute on function public.update_support_report(bigint,text,text) to authenticated;

-- 7) Replace vote lookup with a type-safe, authenticated-user-first lookup.
create or replace function public.has_student_voted(p_election_id bigint)
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
  v_type text;
begin
  if v_uid is null then return false; end if;
  select id into v_student_id from public.students where auth_user_id = v_uid limit 1;
  if v_student_id is null then return false; end if;

  -- Prefer an auth-user column because it cannot be confused with a student PK.
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='votes' and column_name='auth_user_id') then
    v_sql := 'select exists(select 1 from public.votes where election_id=$1 and auth_user_id::text=$2::text)';
    execute v_sql into v_exists using p_election_id, v_uid::text;
    return coalesce(v_exists,false);
  end if;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='votes' and column_name='user_id') then
    v_sql := 'select exists(select 1 from public.votes where election_id=$1 and user_id::text=$2::text)';
    execute v_sql into v_exists using p_election_id, v_uid::text;
    return coalesce(v_exists,false);
  end if;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='votes' and column_name='student_id') then
    v_sql := 'select exists(select 1 from public.votes where election_id=$1 and student_id::text=$2::text)';
    execute v_sql into v_exists using p_election_id, v_student_id::text;
    return coalesce(v_exists,false);
  end if;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='votes' and column_name='voter_id') then
    select data_type into v_type from information_schema.columns where table_schema='public' and table_name='votes' and column_name='voter_id';
    -- voter_id is only accepted when it matches the student's id representation.
    v_sql := 'select exists(select 1 from public.votes where election_id=$1 and voter_id::text=$2::text)';
    execute v_sql into v_exists using p_election_id, v_student_id::text;
    return coalesce(v_exists,false);
  end if;

  return false;
end;
$$;

grant execute on function public.has_student_voted(bigint) to authenticated;

-- 8) Screenshot storage used by Report a Problem.
insert into storage.buckets (id, name, public)
values ('report-attachments', 'report-attachments', false)
on conflict (id) do nothing;

drop policy if exists "students upload report attachments" on storage.objects;
create policy "students upload report attachments"
on storage.objects for insert to authenticated
with check (bucket_id = 'report-attachments' and (storage.foldername(name))[1] = 'reports' and (storage.foldername(name))[2] = auth.uid()::text);

drop policy if exists "users read own report attachments" on storage.objects;
create policy "users read own report attachments"
on storage.objects for select to authenticated
using (bucket_id = 'report-attachments' and ((storage.foldername(name))[1] = 'reports' and (storage.foldername(name))[2] = auth.uid()::text or public.is_admin()));

drop policy if exists "users delete own report attachments" on storage.objects;
create policy "users delete own report attachments"
on storage.objects for delete to authenticated
using (bucket_id = 'report-attachments' and ((storage.foldername(name))[1] = 'reports' and (storage.foldername(name))[2] = auth.uid()::text or public.is_admin()));
