-- ================================================================
-- ELIGIBLE STUDENT ID IMPORT (admin dashboard)
--
-- Safe to re-run. Additive only: adds two admin-only functions.
--
-- eligible_student_ids is not writable by clients (Phase 1 revoked
-- all privileges), so the admin Excel import goes through these
-- SECURITY DEFINER functions, each gated on is_admin().
--
-- Import semantics: add new IDs, re-activate IDs that were
-- deactivated, leave everything else alone. Never deletes and never
-- touches existing student accounts.
-- ================================================================

begin;

create or replace function public.admin_import_eligible_student_ids(
  p_student_ids text[]
)
returns table (
  inserted integer,
  reactivated integer,
  already_active integer,
  skipped_blank integer
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    v_ids text[];
    v_inserted integer := 0;
    v_reactivated integer := 0;
    v_already integer := 0;
    v_blank integer := 0;
begin
    if not public.is_admin() then
        raise exception 'Administrator access required.';
    end if;

    if p_student_ids is null or cardinality(p_student_ids) = 0 then
        return query select 0, 0, 0, 0;
        return;
    end if;

    if cardinality(p_student_ids) > 5000 then
        raise exception 'Send at most 5000 IDs per call.';
    end if;

    -- Same normalization the registration check uses: btrim only.
    v_ids := array(
        select distinct btrim(value)
        from unnest(p_student_ids) as value
        where btrim(coalesce(value, '')) <> ''
    );

    select count(*) into v_blank
    from unnest(p_student_ids) as value
    where btrim(coalesce(value, '')) = '';

    select count(*) into v_already
    from public.eligible_student_ids e
    where e.student_id = any (v_ids)
      and e.is_active = true;

    update public.eligible_student_ids e
    set is_active = true
    where e.student_id = any (v_ids)
      and e.is_active = false;
    get diagnostics v_reactivated = row_count;

    insert into public.eligible_student_ids (student_id, is_active)
    select id, true
    from unnest(v_ids) as id
    on conflict (student_id) do nothing;
    get diagnostics v_inserted = row_count;

    return query select v_inserted, v_reactivated, v_already, v_blank;
end;
$function$;

revoke all on function public.admin_import_eligible_student_ids(text[]) from public, anon;
grant execute on function public.admin_import_eligible_student_ids(text[]) to authenticated;

create or replace function public.admin_eligible_student_ids_summary()
returns table (
  total integer,
  active integer,
  registered integer,
  last_added_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
    if not public.is_admin() then
        raise exception 'Administrator access required.';
    end if;

    return query
    select
        count(*)::integer,
        count(*) filter (where e.is_active)::integer,
        count(s.student_id)::integer,
        max(e.created_at)
    from public.eligible_student_ids e
    left join public.students s on s.student_id = e.student_id;
end;
$function$;

revoke all on function public.admin_eligible_student_ids_summary() from public, anon;
grant execute on function public.admin_eligible_student_ids_summary() to authenticated;

commit;

select 'ELIGIBLE ID IMPORT SUCCESS' as result;

-- ================================================================
-- ROLLBACK
-- ================================================================
-- drop function if exists public.admin_import_eligible_student_ids(text[]);
-- drop function if exists public.admin_eligible_student_ids_summary();
