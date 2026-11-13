alter table public.session_checkins
  add column if not exists departed_at timestamptz;

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
  v_action text;
  v_now timestamptz;
  v_email text;
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
  if p_attendee_type is null or p_attendee_type not in ('teacher', 'student') then
    raise exception using errcode = '22023', message = 'invalid_attendee_type';
  end if;

  v_email := lower(trim(p_email));
  select * into v_session
  from public.tutoring_sessions
  where qr_token = p_token;

  if v_session.id is null then
    raise exception using errcode = '22023', message = 'invalid_attendance_link';
  end if;

  select timezone into v_timezone
  from public.settings
  where id = true;
  if v_timezone is null then
    raise exception using errcode = 'P0001', message = 'attendance_settings_missing';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_session.id::text || ':' || v_email, 0)
  );
  v_now := clock_timestamp();

  select * into v_checkin
  from public.session_checkins
  where session_id = v_session.id
    and lower(email) = v_email
  for update;

  if v_checkin.id is not null then
    if v_checkin.departed_at is not null then
      raise exception using errcode = 'P0001', message = 'attendance_complete';
    end if;

    update public.session_checkins
    set departed_at = v_now
    where id = v_checkin.id
    returning * into v_checkin;
    v_action := 'check_out';
  else
    if not v_session.is_open then
      raise exception using errcode = 'P0001', message = 'session_closed';
    end if;

    insert into public.session_checkins (session_id, full_name, email, attendee_type, arrived_at)
    values (v_session.id, trim(p_full_name), v_email, p_attendee_type, v_now)
    returning * into v_checkin;
    v_action := 'check_in';
  end if;

  return pg_catalog.jsonb_build_object(
    'id', v_checkin.id,
    'full_name', v_checkin.full_name,
    'email', v_checkin.email,
    'attendee_type', v_checkin.attendee_type,
    'arrived_at', v_checkin.arrived_at,
    'departed_at', v_checkin.departed_at,
    'action', v_action,
    'session_name', v_session.session_name,
    'delivery_mode', v_session.delivery_mode,
    'timezone', v_timezone
  );
end;
$$;
