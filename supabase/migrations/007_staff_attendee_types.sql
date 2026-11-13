alter table public.session_checkins
  drop constraint if exists session_checkins_attendee_type_check;

delete from public.session_checkins
where attendee_type = 'student';

alter table public.session_checkins
  add constraint session_checkins_attendee_type_check
  check (attendee_type in ('teacher', 'online_staff', 'admin_staff'));

create or replace function public.record_public_checkin(
  p_token text,
  p_full_name text,
  p_email text,
  p_attendee_type text,
  p_latitude double precision,
  p_longitude double precision
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.tutoring_sessions%rowtype;
  v_checkin public.session_checkins%rowtype;
  v_settings public.settings%rowtype;
  v_action text;
  v_now timestamptz;
  v_email text;
  v_haversine double precision;
  v_distance_meters double precision;
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
  if p_attendee_type is null or p_attendee_type not in ('teacher', 'online_staff', 'admin_staff') then
    raise exception using errcode = '22023', message = 'invalid_attendee_type';
  end if;

  v_email := lower(trim(p_email));
  select * into v_session
  from public.tutoring_sessions
  where qr_token = p_token;

  if v_session.id is null then
    raise exception using errcode = '22023', message = 'invalid_attendance_link';
  end if;

  select * into v_settings
  from public.settings
  where id = true;
  if v_settings.timezone is null then
    raise exception using errcode = 'P0001', message = 'attendance_settings_missing';
  end if;

  if v_session.delivery_mode = 'staffs' then
    if v_settings.office_latitude is null or v_settings.office_longitude is null then
      raise exception using errcode = 'P0001', message = 'office_location_not_configured';
    end if;
    if p_latitude is null or p_longitude is null then
      raise exception using errcode = '22023', message = 'office_location_required';
    end if;
    if p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
      raise exception using errcode = '22023', message = 'invalid_location';
    end if;

    v_haversine :=
      pg_catalog.sin(pg_catalog.radians(p_latitude - v_settings.office_latitude) / 2) ^ 2
      + pg_catalog.cos(pg_catalog.radians(v_settings.office_latitude))
      * pg_catalog.cos(pg_catalog.radians(p_latitude))
      * pg_catalog.sin(pg_catalog.radians(p_longitude - v_settings.office_longitude) / 2) ^ 2;
    v_distance_meters := 2 * 6371000 * pg_catalog.asin(
      pg_catalog.sqrt(case when v_haversine > 1 then 1 else v_haversine end)
    );
    if v_distance_meters > v_settings.office_radius_meters then
      raise exception using errcode = 'P0001', message = 'outside_office_geofence';
    end if;
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
    'timezone', v_settings.timezone
  );
end;
$$;
