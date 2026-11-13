create extension if not exists pgcrypto with schema extensions;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.teachers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) > 0),
  email text not null,
  is_active boolean not null default true,
  qr_token_hash text not null unique,
  created_at timestamptz not null default now()
);

create unique index if not exists teachers_email_lower_key
  on public.teachers (lower(email));

create table if not exists public.attendance_settings (
  singleton boolean primary key default true check (singleton),
  cooldown_seconds integer not null default 30 check (cooldown_seconds between 1 and 3600)
);

insert into public.attendance_settings (singleton)
values (true)
on conflict (singleton) do nothing;

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers (id),
  teacher_name text not null,
  teacher_email text not null,
  event_type text not null check (event_type in ('sign_in', 'sign_out')),
  scanned_at timestamptz not null default clock_timestamp()
);

create index if not exists attendance_scanned_at_idx on public.attendance (scanned_at desc);
create index if not exists attendance_teacher_scanned_at_idx
  on public.attendance (teacher_id, scanned_at desc);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = (select auth.uid())
  );
$$;

alter table public.admin_users enable row level security;
alter table public.teachers enable row level security;
alter table public.attendance_settings enable row level security;
alter table public.attendance enable row level security;

drop policy if exists "admins can view own admin membership" on public.admin_users;
create policy "admins can view own admin membership"
  on public.admin_users for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "admins can manage teachers" on public.teachers;
create policy "admins can manage teachers"
  on public.teachers for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "admins can view attendance settings" on public.attendance_settings;
create policy "admins can view attendance settings"
  on public.attendance_settings for select to authenticated
  using ((select public.is_admin()));

drop policy if exists "admins can update attendance settings" on public.attendance_settings;
create policy "admins can update attendance settings"
  on public.attendance_settings for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "admins can view attendance" on public.attendance;
create policy "admins can view attendance"
  on public.attendance for select to authenticated
  using ((select public.is_admin()));

revoke all on public.admin_users, public.teachers, public.attendance_settings, public.attendance from anon, authenticated;
grant select on public.admin_users to authenticated;
grant select (id, full_name, email, is_active, created_at), update (full_name, email, is_active), delete
  on public.teachers to authenticated;
grant select (singleton, cooldown_seconds), update (cooldown_seconds)
  on public.attendance_settings to authenticated;
grant select on public.attendance to authenticated;

create or replace function public.create_teacher(p_full_name text, p_email text)
returns table (teacher_id uuid, full_name text, email text, qr_token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_teacher public.teachers%rowtype;
begin
  if not (select public.is_admin()) then
    raise exception using errcode = '42501', message = 'admin_required';
  end if;

  if nullif(trim(p_full_name), '') is null or nullif(trim(p_email), '') is null then
    raise exception using errcode = '22023', message = 'name_and_email_required';
  end if;

  v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');

  insert into public.teachers (full_name, email, qr_token_hash)
  values (trim(p_full_name), lower(trim(p_email)), encode(extensions.digest(v_token, 'sha256'), 'hex'))
  returning * into v_teacher;

  return query select v_teacher.id, v_teacher.full_name, v_teacher.email, v_token;
end;
$$;

create or replace function public.record_teacher_scan(p_qr_token text)
returns table (
  attendance_id uuid,
  teacher_id uuid,
  teacher_name text,
  teacher_email text,
  event_type text,
  scanned_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_teacher public.teachers%rowtype;
  v_last public.attendance%rowtype;
  v_has_last boolean;
  v_event text;
  v_cooldown integer;
  v_scanned_at timestamptz;
begin
  if (select auth.uid()) is null or not (select public.is_admin()) then
    raise exception using errcode = '42501', message = 'admin_required';
  end if;

  if p_qr_token is null or length(p_qr_token) not between 32 and 128 then
    raise exception using errcode = '22023', message = 'invalid_qr_code';
  end if;

  select * into v_teacher
  from public.teachers
  where qr_token_hash = encode(extensions.digest(p_qr_token, 'sha256'), 'hex')
    and is_active;

  if not found then
    raise exception using errcode = '22023', message = 'invalid_qr_code';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_teacher.id::text, 0));

  select cooldown_seconds into v_cooldown
  from public.attendance_settings where singleton = true;

  select * into v_last
  from public.attendance
  where attendance.teacher_id = v_teacher.id
  order by scanned_at desc, id desc
  limit 1;
  v_has_last := found;
  v_scanned_at := clock_timestamp();

  if v_has_last and v_last.scanned_at >= v_scanned_at - pg_catalog.make_interval(secs => v_cooldown) then
    raise exception using errcode = 'P0001', message = 'duplicate_scan';
  end if;

  if v_has_last and (v_last.scanned_at at time zone 'UTC')::date = (v_scanned_at at time zone 'UTC')::date then
    if v_last.event_type = 'sign_in' then
      v_event := 'sign_out';
    else
      raise exception using errcode = 'P0001', message = 'daily_attendance_complete';
    end if;
  elsif v_has_last and v_last.event_type = 'sign_in' then
    raise exception using errcode = 'P0001', message = 'incomplete_previous_attendance';
  else
    v_event := 'sign_in';
  end if;

  return query
  insert into public.attendance (teacher_id, teacher_name, teacher_email, event_type, scanned_at)
  values (v_teacher.id, v_teacher.full_name, v_teacher.email, v_event, v_scanned_at)
  returning attendance.id, attendance.teacher_id, attendance.teacher_name,
    attendance.teacher_email, attendance.event_type, attendance.scanned_at;
end;
$$;

revoke all on function public.is_admin() from public, anon;
revoke all on function public.create_teacher(text, text) from public, anon;
revoke all on function public.record_teacher_scan(text) from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.create_teacher(text, text) to authenticated;
grant execute on function public.record_teacher_scan(text) to authenticated;