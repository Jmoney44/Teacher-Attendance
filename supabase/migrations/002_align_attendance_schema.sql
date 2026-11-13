alter table public.admin_users rename to admins;
alter table public.attendance_settings rename to settings;
alter table public.settings rename column singleton to id;
alter table public.settings rename column cooldown_seconds to duplicate_scan_interval_seconds;
alter table public.settings
  drop constraint if exists attendance_settings_cooldown_seconds_check;
alter table public.settings
  add constraint settings_duplicate_scan_interval_check
  check (duplicate_scan_interval_seconds between 0 and 3600);
alter table public.settings add column timezone text not null default 'Africa/Lagos';
alter table public.attendance rename to attendance_events;
alter table public.attendance_events add column scanned_by uuid default auth.uid();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admins
    where user_id = (select auth.uid())
  );
$$;

create or replace function public.validate_settings_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from pg_catalog.pg_timezone_names where name = new.timezone
  ) then
    raise exception using errcode = '22023', message = 'invalid_timezone';
  end if;
  return new;
end;
$$;

create trigger validate_settings_timezone_before_write
before insert or update of timezone on public.settings
for each row execute function public.validate_settings_timezone();

drop policy if exists "admins can view own admin membership" on public.admins;
drop policy if exists "admins can view attendance settings" on public.settings;
drop policy if exists "admins can update attendance settings" on public.settings;
drop policy if exists "admins can view attendance" on public.attendance_events;

create policy "admins can read own membership" on public.admins
  for select to authenticated using (user_id = (select auth.uid()));
create policy "admins can read settings" on public.settings
  for select to authenticated using ((select public.is_admin()));
create policy "admins can update settings" on public.settings
  for update to authenticated using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy "admins can read attendance events" on public.attendance_events
  for select to authenticated using ((select public.is_admin()));

alter table public.admins enable row level security;
alter table public.settings enable row level security;
alter table public.teachers enable row level security;
alter table public.attendance_events enable row level security;

revoke all on public.admins, public.settings, public.teachers, public.attendance_events
  from anon, authenticated;
revoke select (id, full_name, email, is_active, created_at),
  update (full_name, email, is_active), delete
  on public.teachers from anon, authenticated;
grant select on public.admins to authenticated;
grant select (id, full_name, email, is_active, created_at),
  update (full_name, email, is_active)
  on public.teachers to authenticated;
grant select (id, duplicate_scan_interval_seconds, timezone),
  update (duplicate_scan_interval_seconds, timezone)
  on public.settings to authenticated;
grant select on public.attendance_events to authenticated;

create or replace function public.record_scan(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_teacher public.teachers%rowtype;
  v_settings public.settings%rowtype;
  v_last public.attendance_events%rowtype;
  v_event_type text;
  v_now timestamptz := clock_timestamp();
  v_event public.attendance_events%rowtype;
begin
  if (select auth.uid()) is null or not (select public.is_admin()) then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  if p_token is null or length(p_token) not between 32 and 128 then
    raise exception using errcode = '22023', message = 'invalid_code';
  end if;

  select * into v_teacher
  from public.teachers
  where qr_token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  for update;

  if v_teacher.id is null then
    raise exception using errcode = '22023', message = 'invalid_code';
  end if;
  if not v_teacher.is_active then
    raise exception using errcode = '22023', message = 'teacher_inactive';
  end if;

  select * into v_settings from public.settings where id = true;
  if v_settings.id is null then
    raise exception using errcode = 'P0001', message = 'attendance_settings_missing';
  end if;

  select * into v_last from public.attendance_events
  where teacher_id = v_teacher.id
  order by scanned_at desc, id desc
  limit 1;

  if v_last.id is not null
    and v_settings.duplicate_scan_interval_seconds > 0
    and v_now - v_last.scanned_at < pg_catalog.make_interval(
      secs => v_settings.duplicate_scan_interval_seconds
    ) then
    raise exception using errcode = 'P0001', message = 'duplicate_scan';
  end if;

  if v_last.id is not null
    and (v_last.scanned_at at time zone v_settings.timezone)::date
      = (v_now at time zone v_settings.timezone)::date then
    if v_last.event_type = 'sign_in' then
      v_event_type := 'sign_out';
    else
      raise exception using errcode = 'P0001', message = 'daily_attendance_complete';
    end if;
  else
    v_event_type := 'sign_in';
  end if;

  insert into public.attendance_events (
    teacher_id, teacher_name, teacher_email, event_type, scanned_at
  ) values (
    v_teacher.id, v_teacher.full_name, v_teacher.email, v_event_type, v_now
  ) returning * into v_event;

  return to_jsonb(v_event);
end;
$$;

create or replace function public.dashboard_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_settings public.settings%rowtype;
  v_now timestamptz := statement_timestamp();
  v_day_start timestamptz;
  v_counts jsonb;
begin
  if (select auth.uid()) is null or not (select public.is_admin()) then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  select * into v_settings from public.settings where id = true;
  if v_settings.id is null then
    raise exception using errcode = 'P0001', message = 'attendance_settings_missing';
  end if;

  v_day_start := pg_catalog.date_trunc(
    'day', v_now at time zone v_settings.timezone
  ) at time zone v_settings.timezone;

  with today as (
    select e.teacher_id, e.event_type,
      row_number() over (partition by e.teacher_id order by e.scanned_at desc, e.id desc) as position
    from public.attendance_events e
    join public.teachers t on t.id = e.teacher_id and t.is_active
    where e.scanned_at >= v_day_start
  )
  select pg_catalog.jsonb_build_object(
    'total_teachers', (select count(*) from public.teachers where is_active),
    'signed_in_today', (select count(distinct teacher_id) from today where event_type = 'sign_in'),
    'signed_out', (select count(*) from today where position = 1 and event_type = 'sign_out'),
    'present_now', (select count(*) from today where position = 1 and event_type = 'sign_in')
  ) into v_counts;

  return v_counts;
end;
$$;

drop function if exists public.record_teacher_scan(text);

revoke all on function public.is_admin() from public, anon;
revoke all on function public.create_teacher(text, text) from public, anon;
revoke all on function public.record_scan(text) from public, anon;
revoke all on function public.dashboard_counts() from public, anon;
revoke all on function public.validate_settings_timezone() from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.create_teacher(text, text) to authenticated;
grant execute on function public.record_scan(text) to authenticated;
grant execute on function public.dashboard_counts() to authenticated;