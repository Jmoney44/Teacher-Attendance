alter table public.tutoring_sessions
  drop constraint if exists tutoring_sessions_delivery_mode_check;

alter table public.tutoring_sessions
  add constraint tutoring_sessions_delivery_mode_check
  check (delivery_mode in ('in_home', 'online', 'staffs'));

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
  if p_delivery_mode not in ('in_home', 'online', 'staffs') then
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
