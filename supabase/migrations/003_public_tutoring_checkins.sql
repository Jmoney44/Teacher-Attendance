create table if not exists public.tutoring_sessions (
  id uuid primary key default gen_random_uuid(),
  session_name text not null check (length(trim(session_name)) > 0),
  delivery_mode text not null check (delivery_mode in ('in_home', 'online')),
  is_open boolean not null default true,
  qr_token text not null unique,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create table if not exists public.session_checkins (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.tutoring_sessions (id) on delete restrict,
  full_name text not null check (length(trim(full_name)) > 0),
  email text not null,
  attendee_type text not null check (attendee_type in ('teacher', 'student')),
  arrived_at timestamptz not null default clock_timestamp()
);

create unique index if not exists session_checkins_unique_attendee
  on public.session_checkins (session_id, lower(email));
create index if not exists session_checkins_arrived_at_idx
  on public.session_checkins (arrived_at desc);

alter table public.tutoring_sessions enable row level security;
alter table public.session_checkins enable row level security;

drop policy if exists "admins can read tutoring sessions" on public.tutoring_sessions;
create policy "admins can read tutoring sessions"
  on public.tutoring_sessions for select to authenticated
  using ((select public.is_admin()));

drop policy if exists "admins can read session checkins" on public.session_checkins;
create policy "admins can read session checkins"
  on public.session_checkins for select to authenticated
  using ((select public.is_admin()));

revoke all on public.tutoring_sessions, public.session_checkins from anon, authenticated;
grant select (id, session_name, delivery_mode, is_open, qr_token, created_at)
  on public.tutoring_sessions to authenticated;
grant select on public.session_checkins to authenticated;

create or replace function public.create_tutoring_session(
  p_session_name text,
  p_delivery_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_session public.tutoring_sessions%rowtype;
begin
  if (select auth.uid()) is null or not (select public.is_admin()) then
    raise exception using errcode = '42501', message = 'admin_required';
  end if;
  if nullif(trim(p_session_name), '') is null then
    raise exception using errcode = '22023', message = 'session_name_required';
  end if;
  if p_delivery_mode not in ('in_home', 'online') then
    raise exception using errcode = '22023', message = 'invalid_delivery_mode';
  end if;

  v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  insert into public.tutoring_sessions (session_name, delivery_mode, qr_token, created_by)
  values (trim(p_session_name), p_delivery_mode, v_token, (select auth.uid()))
  returning * into v_session;

  return pg_catalog.jsonb_build_object(
    'id', v_session.id,
    'session_name', v_session.session_name,
    'delivery_mode', v_session.delivery_mode,
    'is_open', v_session.is_open,
    'created_at', v_session.created_at,
    'qr_token', v_session.qr_token
  );
end;
$$;

create or replace function public.set_tutoring_session_status(
  p_session_id uuid,
  p_is_open boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  if (select auth.uid()) is null or not (select public.is_admin()) then
    raise exception using errcode = '42501', message = 'admin_required';
  end if;

  update public.tutoring_sessions
  set is_open = p_is_open
  where id = p_session_id;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception using errcode = 'P0002', message = 'session_not_found';
  end if;
  return true;
end;
$$;

create or replace function public.get_public_tutoring_session(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.tutoring_sessions%rowtype;
begin
  if p_token is null or length(p_token) not between 32 and 128 then
    raise exception using errcode = '22023', message = 'invalid_attendance_link';
  end if;

  select * into v_session from public.tutoring_sessions where qr_token = p_token;
  if v_session.id is null then
    raise exception using errcode = '22023', message = 'invalid_attendance_link';
  end if;

  return pg_catalog.jsonb_build_object(
    'session_name', v_session.session_name,
    'delivery_mode', v_session.delivery_mode,
    'is_open', v_session.is_open
  );
end;
$$;

create or replace function public.record_public_checkin(
  p_token text,
  p_full_name text,
  p_email text,
  p_attendee_type text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.tutoring_sessions%rowtype;
  v_checkin public.session_checkins%rowtype;
  v_timezone text;
begin
  if p_token is null or length(p_token) not between 32 and 128 then
    raise exception using errcode = '22023', message = 'invalid_attendance_link';
  end if;
  if nullif(trim(p_full_name), '') is null or nullif(trim(p_email), '') is null then
    raise exception using errcode = '22023', message = 'name_and_email_required';
  end if;
  if trim(p_email) !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
    raise exception using errcode = '22023', message = 'invalid_email';
  end if;
  if p_attendee_type not in ('teacher', 'student') then
    raise exception using errcode = '22023', message = 'invalid_attendee_type';
  end if;

  select * into v_session from public.tutoring_sessions where qr_token = p_token;
  if v_session.id is null then
    raise exception using errcode = '22023', message = 'invalid_attendance_link';
  end if;
  if not v_session.is_open then
    raise exception using errcode = 'P0001', message = 'session_closed';
  end if;

  select timezone into v_timezone from public.settings where id = true;
  if v_timezone is null then
    raise exception using errcode = 'P0001', message = 'attendance_settings_missing';
  end if;

  begin
    insert into public.session_checkins (session_id, full_name, email, attendee_type)
    values (v_session.id, trim(p_full_name), lower(trim(p_email)), p_attendee_type)
    returning * into v_checkin;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'duplicate_checkin';
  end;

  return pg_catalog.jsonb_build_object(
    'id', v_checkin.id,
    'full_name', v_checkin.full_name,
    'email', v_checkin.email,
    'attendee_type', v_checkin.attendee_type,
    'arrived_at', v_checkin.arrived_at,
    'session_name', v_session.session_name,
    'delivery_mode', v_session.delivery_mode,
    'timezone', v_timezone
  );
end;
$$;

revoke all on function public.create_tutoring_session(text, text) from public, anon;
revoke all on function public.set_tutoring_session_status(uuid, boolean) from public, anon;
revoke all on function public.get_public_tutoring_session(text) from public;
revoke all on function public.record_public_checkin(text, text, text, text) from public;
grant execute on function public.create_tutoring_session(text, text) to authenticated;
grant execute on function public.set_tutoring_session_status(uuid, boolean) to authenticated;
grant execute on function public.get_public_tutoring_session(text) to anon, authenticated;
grant execute on function public.record_public_checkin(text, text, text, text) to anon, authenticated;