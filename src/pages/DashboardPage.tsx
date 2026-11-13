import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import Brand from '../components/Brand';
import TablePagination from '../components/TablePagination';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { getCurrentCoordinates } from '../utils/geolocation';

type TutoringSession = {
  id: string;
  session_name: string;
  delivery_mode: 'in_home' | 'online' | 'staffs';
  is_open: boolean;
  created_at: string;
  qr_token: string;
};

type Arrival = {
  id: string;
  session_id: string;
  full_name: string;
  email: string;
  attendee_type: 'teacher' | 'online_staff' | 'admin_staff';
  arrived_at: string;
  departed_at: string | null;
};

const deliveryLabel = (mode: TutoringSession['delivery_mode']) => {
  if (mode === 'in_home') return 'In-home';
  if (mode === 'online') return 'Online';
  return 'Staffs';
};

const deliveryDescription = (mode: TutoringSession['delivery_mode']) => (
  mode === 'staffs' ? 'Staffs attendance' : `${deliveryLabel(mode)} tutoring`
);

const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<TutoringSession[]>([]);
  const [arrivals, setArrivals] = useState<Arrival[]>([]);
  const [sessionName, setSessionName] = useState('');
  const [deliveryMode, setDeliveryMode] = useState<TutoringSession['delivery_mode']>('in_home');
  const [attendanceTimezone, setAttendanceTimezone] = useState('Africa/Lagos');
  const [officeLocation, setOfficeLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [officeRadiusMeters, setOfficeRadiusMeters] = useState(100);
  const [selectedSession, setSelectedSession] = useState<TutoringSession | null>(null);
  const [printSession, setPrintSession] = useState<TutoringSession | null>(null);
  const [printArrivals, setPrintArrivals] = useState<{ label: string; rows: Arrival[] } | null>(null);
  const [arrivalSearch, setArrivalSearch] = useState('');
  const [sessionPage, setSessionPage] = useState(1);
  const [sessionPageSize, setSessionPageSize] = useState(10);
  const [teacherArrivalPage, setTeacherArrivalPage] = useState(1);
  const [onlineStaffArrivalPage, setOnlineStaffArrivalPage] = useState(1);
  const [adminStaffArrivalPage, setAdminStaffArrivalPage] = useState(1);
  const [arrivalPageSize, setArrivalPageSize] = useState(10);
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [hasDashboardLoadError, setHasDashboardLoadError] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingOfficeLocation, setIsSavingOfficeLocation] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const loadDashboard = async () => {
    if (!supabase || !isSupabaseConfigured) {
      setErrorMessage('Supabase is not configured. Add the project URL and publishable key to .env.local.');
      setIsLoading(false);
      return;
    }

    const [sessionResult, arrivalResult, settingsResult] = await Promise.all([
      supabase.from('tutoring_sessions')
        .select('id, session_name, delivery_mode, is_open, created_at, qr_token')
        .order('created_at', { ascending: false }),
      supabase.from('session_checkins')
        .select('id, session_id, full_name, email, attendee_type, arrived_at, departed_at')
        .order('arrived_at', { ascending: false }),
      supabase.from('settings')
        .select('timezone, office_latitude, office_longitude, office_radius_meters')
        .eq('id', true)
        .single(),
    ]);

    setIsLoading(false);
    if (sessionResult.error || arrivalResult.error || settingsResult.error) {
      setHasDashboardLoadError(true);
      setErrorMessage(sessionResult.error?.message ?? arrivalResult.error?.message ?? settingsResult.error?.message ?? 'Could not load attendance.');
      return;
    }

    setHasDashboardLoadError(false);
    setErrorMessage('');
    setSessions((sessionResult.data ?? []) as TutoringSession[]);
    setArrivals((arrivalResult.data ?? []) as Arrival[]);
    setAttendanceTimezone(settingsResult.data.timezone);
    setOfficeLocation(
      settingsResult.data.office_latitude !== null && settingsResult.data.office_longitude !== null
        ? { latitude: settingsResult.data.office_latitude, longitude: settingsResult.data.office_longitude }
        : null,
    );
    setOfficeRadiusMeters(settingsResult.data.office_radius_meters);
  };

  useEffect(() => {
    void loadDashboard();
  }, []);

  useEffect(() => {
    if (!printSession && !printArrivals) return;

    const timeoutId = window.setTimeout(() => window.print(), 150);
    const handleAfterPrint = () => {
      setPrintSession(null);
      setPrintArrivals(null);
    };
    window.addEventListener('afterprint', handleAfterPrint);
    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('afterprint', handleAfterPrint);
    };
  }, [printSession, printArrivals]);

  const handleCreateSession = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage('');
    if (!supabase) return;

    setIsSaving(true);
    const { data, error } = await supabase.rpc('create_tutoring_session', {
      p_session_name: sessionName,
      p_delivery_mode: deliveryMode,
    });
    setIsSaving(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    const newSession = data as TutoringSession | null;
    if (!newSession?.qr_token || !newSession.id) {
      setErrorMessage('The session was not confirmed by the database, so no QR link was displayed.');
      return;
    }

    setSelectedSession(newSession);
    setSessionPage(1);
    setSessionName('');
    await loadDashboard();
  };

  const handleSetOfficeLocation = async () => {
    if (!supabase) {
      setErrorMessage('Office location is unavailable because the service is not configured.');
      return;
    }

    setErrorMessage('');
    setIsSavingOfficeLocation(true);
    try {
      const coordinates = await getCurrentCoordinates();
      const { data, error } = await supabase.from('settings')
        .update({
          office_latitude: coordinates.latitude,
          office_longitude: coordinates.longitude,
          office_radius_meters: 100,
        })
        .eq('id', true)
        .select('office_radius_meters')
        .single();

      if (error) {
        setErrorMessage(error.message);
        return;
      }

      setOfficeLocation(coordinates);
      setOfficeRadiusMeters(data.office_radius_meters);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not determine the office location.');
    } finally {
      setIsSavingOfficeLocation(false);
    }
  };

  const handleSessionStatus = async (session: TutoringSession) => {
    if (!supabase) return;
    const { error } = await supabase.rpc('set_tutoring_session_status', {
      p_session_id: session.id,
      p_is_open: !session.is_open,
    });
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    await loadDashboard();
  };

  const handleLogout = async () => {
    if (!supabase) {
      setErrorMessage('Could not sign out because Supabase is not configured.');
      return;
    }

    setErrorMessage('');
    setIsLoggingOut(true);
    const { error } = await supabase.auth.signOut();
    setIsLoggingOut(false);

    if (error) {
      setErrorMessage(`Could not sign out: ${error.message}`);
      return;
    }

    navigate('/login', { replace: true });
  };

  const getCheckInUrl = (token: string) => `${window.location.origin}/check-in/${token}`;
  const formatAttendanceTime = (timestamp: string) => new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: attendanceTimezone,
  }).format(new Date(timestamp));
  const normalizedSearch = arrivalSearch.trim().toLocaleLowerCase();
  const matchingArrivals = arrivals.filter((arrival) => {
    if (!normalizedSearch) return true;
    const arrivalDate = new Date(arrival.arrived_at);
    const searchDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: attendanceTimezone }).format(arrivalDate);
    const localDate = arrivalDate.toLocaleDateString(undefined, { timeZone: attendanceTimezone });
    return [
      arrival.full_name,
      arrival.email,
      searchDate,
      localDate,
      arrival.arrived_at.slice(0, 10),
    ].some((value) => value.toLocaleLowerCase().includes(normalizedSearch));
  });
  const teacherArrivals = matchingArrivals.filter((arrival) => arrival.attendee_type === 'teacher');
  const onlineStaffArrivals = matchingArrivals.filter((arrival) => arrival.attendee_type === 'online_staff');
  const adminStaffArrivals = matchingArrivals.filter((arrival) => arrival.attendee_type === 'admin_staff');

  const renderArrivalTable = (
    label: string,
    rows: Arrival[],
    page: number,
    setPage: (page: number) => void,
  ) => {
    const visibleRows = rows.slice((page - 1) * arrivalPageSize, page * arrivalPageSize);

    return (
      <>
        <div className="hidden overflow-x-auto md:block">
          {rows.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-500">No {label.toLocaleLowerCase()} match this search.</p>
          ) : (
            <table className="w-full min-w-[54rem] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">Name</th>
                  <th className="px-5 py-3 font-semibold">Email</th>
                  <th className="px-5 py-3 font-semibold">Tutoring session</th>
                  <th className="px-5 py-3 font-semibold">Arrival</th>
                  <th className="px-5 py-3 font-semibold">Departure</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleRows.map((arrival) => {
                  const session = sessions.find((item) => item.id === arrival.session_id);
                  return (
                    <tr className="transition-colors hover:bg-brand-50/50" key={arrival.id}>
                      <td className="px-5 py-4 font-semibold text-slate-800">{arrival.full_name}</td>
                      <td className="px-5 py-4 text-slate-600">{arrival.email}</td>
                      <td className="px-5 py-4 text-slate-600">{session ? `${session.session_name} · ${deliveryLabel(session.delivery_mode)}` : 'Session unavailable'}</td>
                      <td className="whitespace-nowrap px-5 py-4 text-slate-600">{formatAttendanceTime(arrival.arrived_at)}</td>
                      <td className="whitespace-nowrap px-5 py-4 text-slate-600">{arrival.departed_at ? formatAttendanceTime(arrival.departed_at) : '—'}</td>
                      <td className="px-5 py-4">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${arrival.departed_at ? 'bg-slate-100 text-slate-600' : 'bg-brand-50 text-brand-700'}`}>
                          {arrival.departed_at ? 'Departed' : 'Present'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="grid gap-3 p-3 md:hidden">
          {rows.length === 0 ? (
            <p className="px-2 py-5 text-center text-sm text-slate-500">No {label.toLocaleLowerCase()} match this search.</p>
          ) : visibleRows.map((arrival) => {
            const session = sessions.find((item) => item.id === arrival.session_id);
            return (
              <article className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4" key={arrival.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="break-words font-bold text-slate-900">{arrival.full_name}</h4>
                    <p className="mt-1 break-all text-sm text-slate-600">{arrival.email}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${arrival.departed_at ? 'bg-slate-100 text-slate-600' : 'bg-brand-50 text-brand-700'}`}>
                    {arrival.departed_at ? 'Departed' : 'Present'}
                  </span>
                </div>
                <dl className="mt-4 grid gap-3 border-t border-slate-200 pt-3 text-sm">
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tutoring session</dt>
                    <dd className="mt-0.5 break-words text-slate-700">{session ? `${session.session_name} · ${deliveryLabel(session.delivery_mode)}` : 'Session unavailable'}</dd>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="min-w-0">
                      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Arrival</dt>
                      <dd className="mt-0.5 text-slate-700">{formatAttendanceTime(arrival.arrived_at)}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Departure</dt>
                      <dd className="mt-0.5 text-slate-700">{arrival.departed_at ? formatAttendanceTime(arrival.departed_at) : '—'}</dd>
                    </div>
                  </div>
                </dl>
              </article>
            );
          })}
        </div>
        <TablePagination
          label={`${label.toLocaleLowerCase()} arrivals`}
          page={page}
          pageSize={arrivalPageSize}
          totalItems={rows.length}
          onPageChange={setPage}
          onPageSizeChange={(pageSize) => {
            setArrivalPageSize(pageSize);
            setTeacherArrivalPage(1);
            setOnlineStaffArrivalPage(1);
            setAdminStaffArrivalPage(1);
          }}
        />
      </>
    );
  };

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:gap-5 sm:px-8 sm:py-4">
          <Brand />
          <nav className="grid w-full grid-cols-4 gap-1 text-center text-xs font-semibold sm:flex sm:w-auto sm:items-center sm:gap-2 sm:text-sm">
            <Link className="rounded-full bg-brand-50 px-2 py-2 text-brand-700 sm:px-4" to="/dashboard">Dashboard</Link>
            <a className="rounded-full px-2 py-2 text-slate-600 transition hover:bg-slate-100 sm:px-4" href="#sessions">Sessions</a>
            <a className="rounded-full px-2 py-2 text-slate-600 transition hover:bg-slate-100 sm:px-4" href="#arrivals">Arrivals</a>
            <button
              className="rounded-full border border-slate-200 px-2 py-2 text-slate-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:cursor-wait disabled:opacity-60 sm:px-4"
              type="button"
              onClick={() => void handleLogout()}
              disabled={isLoggingOut}
            >
              {isLoggingOut ? 'Signing out...' : 'Log out'}
            </button>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-8 sm:py-10">
        <section className="mb-7 flex flex-wrap items-end justify-between gap-4 sm:mb-8">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-brand-600">Your school, in sync</p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-4xl">Attendance dashboard</h1>
            <p className="mt-2 text-slate-500">Manage tutoring sessions and see who is in class.</p>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:grid-cols-4 sm:gap-3">
            <div className="min-w-0 rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-sm sm:px-5 sm:py-4">
              <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-500 sm:text-xs">Sessions</p>
              <p className="mt-1 text-xl font-bold text-slate-900 sm:text-2xl">{sessions.length}</p>
            </div>
            <div className="min-w-0 rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-sm sm:px-5 sm:py-4">
              <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-500 sm:text-xs">Teachers</p>
              <p className="mt-1 text-xl font-bold text-brand-700 sm:text-2xl">{arrivals.filter((arrival) => arrival.attendee_type === 'teacher').length}</p>
            </div>
            <div className="min-w-0 rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-sm sm:px-5 sm:py-4">
              <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-500 sm:text-xs">Online staff</p>
              <p className="mt-1 text-xl font-bold text-brand-700 sm:text-2xl">{arrivals.filter((arrival) => arrival.attendee_type === 'online_staff').length}</p>
            </div>
            <div className="min-w-0 rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-sm sm:px-5 sm:py-4">
              <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-500 sm:text-xs">Admin staff</p>
              <p className="mt-1 text-xl font-bold text-brand-700 sm:text-2xl">{arrivals.filter((arrival) => arrival.attendee_type === 'admin_staff').length}</p>
            </div>
          </div>
        </section>

        {errorMessage && <p className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{errorMessage}</p>}

        <section className="mb-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" aria-labelledby="office-location-title">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 id="office-location-title" className="text-lg font-bold text-slate-900">Staffs office check</h2>
              <p className="mt-1 text-sm text-slate-600">
                {officeLocation
                  ? `Office location saved · scans must be within ${officeRadiusMeters} meters.`
                  : 'Office location not set · Staffs check-ins are blocked until an admin sets it.'}
              </p>
              <p className="mt-1 text-xs text-slate-500">Set this while at the office. GPS may be spoofed and is not identity verification.</p>
            </div>
            <button
              className="rounded-xl border border-brand-100 px-4 py-2.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-50 disabled:cursor-wait disabled:opacity-60"
              type="button"
              onClick={() => void handleSetOfficeLocation()}
              disabled={isSavingOfficeLocation}
            >
              {isSavingOfficeLocation ? 'Getting location...' : officeLocation ? 'Update office location' : 'Set office location'}
            </button>
          </div>
        </section>

        <section className="mb-6 overflow-hidden rounded-3xl bg-gradient-to-br from-brand-700 to-brand-900 p-5 text-white shadow-card sm:mb-8 sm:p-8" aria-labelledby="new-session-title">
          <div className="mb-5">
            <p className="text-sm font-semibold text-brand-100">START A CLASS</p>
            <h2 id="new-session-title" className="mt-1 text-2xl font-bold">Create a tutoring session</h2>
            <p className="mt-1 text-sm text-brand-100">Get a QR code attendees can use to check in and out.</p>
          </div>
          <form className="grid gap-3 sm:grid-cols-[1fr_12rem_auto]" onSubmit={handleCreateSession}>
            <label className="grid gap-1.5 text-sm font-semibold">
              Session name
              <input className="rounded-xl border border-white/30 bg-white px-4 py-3 font-normal text-slate-900 outline-none ring-brand-100 placeholder:text-slate-400 focus:ring-4" placeholder="e.g. Mathematics, Monday" value={sessionName} onChange={(event) => setSessionName(event.target.value)} required />
            </label>
            <label className="grid gap-1.5 text-sm font-semibold">
              Tutoring type
              <select className="rounded-xl border border-white/30 bg-white px-4 py-3 font-normal text-slate-900 outline-none ring-brand-100 focus:ring-4" value={deliveryMode} onChange={(event) => setDeliveryMode(event.target.value as TutoringSession['delivery_mode'])}>
                <option value="in_home">In-home</option>
                <option value="online">Online</option>
                <option value="staffs">Staffs</option>
              </select>
            </label>
            <button className="self-end rounded-xl bg-sun px-5 py-3 font-bold text-brand-900 transition hover:brightness-95 disabled:cursor-wait disabled:opacity-60" type="submit" disabled={isSaving}>
              {isSaving ? 'Creating...' : 'Create session'}
            </button>
          </form>
        </section>

        {selectedSession && (
          <section className="mb-8 flex flex-col items-center gap-6 rounded-3xl border border-brand-100 bg-white p-6 shadow-card sm:flex-row sm:p-8" aria-labelledby="session-qr-title">
            <div className="rounded-2xl bg-brand-50 p-4">
              <QRCodeSVG value={getCheckInUrl(selectedSession.qr_token)} size={176} level="M" includeMargin />
            </div>
            <div className="min-w-0 flex-1 text-center sm:text-left">
              <p className="text-sm font-bold uppercase tracking-wide text-brand-600">Your session code is ready</p>
              <h2 id="session-qr-title" className="mt-1 text-2xl font-bold text-slate-900">{selectedSession.session_name}</h2>
              <p className="mt-1 text-slate-500">{deliveryDescription(selectedSession.delivery_mode)} · scan to check in and out</p>
              <p className="mt-3 break-all rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{getCheckInUrl(selectedSession.qr_token)}</p>
              <div className="mt-4 flex flex-wrap justify-center gap-3 sm:justify-start">
                <button className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-brand-700" type="button" onClick={() => setPrintSession(selectedSession)}>Print code</button>
                <button className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50" type="button" onClick={() => setSelectedSession(null)}>Dismiss</button>
              </div>
              <p className="mt-3 text-xs text-slate-500">Anyone with this link can submit a name and email. It does not verify identity.</p>
            </div>
          </section>
        )}

        <section id="sessions" className="mb-6 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm sm:mb-8" aria-labelledby="sessions-title">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-5 sm:px-6">
            <div>
              <h2 id="sessions-title" className="text-xl font-bold text-slate-900">Tutoring sessions</h2>
              <p className="mt-1 text-sm text-slate-500">Open a session code, print it, or manage its link.</p>
            </div>
            <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700">{sessions.filter((session) => session.is_open).length} open</span>
          </div>
          {isLoading ? <p className="px-6 py-10 text-center text-sm text-slate-500">Loading sessions...</p> : hasDashboardLoadError ? null : sessions.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-slate-500">No tutoring sessions yet. Create one above to generate a check-in code.</p>
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[48rem] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr><th className="px-5 py-3 font-semibold">Session</th><th className="px-5 py-3 font-semibold">Type</th><th className="px-5 py-3 font-semibold">Status</th><th className="px-5 py-3 text-right font-semibold">Actions</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sessions.slice((sessionPage - 1) * sessionPageSize, sessionPage * sessionPageSize).map((session) => (
                      <tr className="transition-colors hover:bg-slate-50" key={session.id}>
                        <td className="px-5 py-4 font-semibold text-slate-800">{session.session_name}</td>
                        <td className="px-5 py-4 text-slate-600">{deliveryLabel(session.delivery_mode)}</td>
                        <td className="px-5 py-4">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${session.is_open ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-600'}`}>{session.is_open ? 'Open' : 'Closed'}</span>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex justify-end gap-2">
                            <button className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50" type="button" onClick={() => setSelectedSession(session)}>Show code</button>
                            <button className="rounded-lg border border-brand-100 px-3 py-2 text-xs font-semibold text-brand-700 transition hover:bg-brand-50" type="button" onClick={() => setPrintSession(session)}>Print code</button>
                            <button className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-800" type="button" onClick={() => void handleSessionStatus(session)}>{session.is_open ? 'Close link' : 'Reopen'}</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            <div className="divide-y divide-slate-100 md:hidden">
              {sessions.slice((sessionPage - 1) * sessionPageSize, sessionPage * sessionPageSize).map((session) => (
                <article className="space-y-3 p-4" key={session.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="break-words font-bold text-slate-900">{session.session_name}</h3>
                      <p className="mt-1 text-sm text-slate-500">{deliveryDescription(session.delivery_mode)}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${session.is_open ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-600'}`}>{session.is_open ? 'Open' : 'Closed'}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button className="rounded-lg border border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50" type="button" onClick={() => setSelectedSession(session)}>Show code</button>
                    <button className="rounded-lg border border-brand-100 px-3 py-2.5 text-xs font-semibold text-brand-700 transition hover:bg-brand-50" type="button" onClick={() => setPrintSession(session)}>Print code</button>
                    <button className="col-span-2 rounded-lg px-3 py-2.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-800" type="button" onClick={() => void handleSessionStatus(session)}>{session.is_open ? 'Close link' : 'Reopen link'}</button>
                  </div>
                </article>
              ))}
            </div>
            </>
          )}
          {!isLoading && !hasDashboardLoadError && sessions.length > 0 && (
            <TablePagination
              label="tutoring sessions"
              page={sessionPage}
              pageSize={sessionPageSize}
              totalItems={sessions.length}
              onPageChange={setSessionPage}
              onPageSizeChange={(pageSize) => {
                setSessionPageSize(pageSize);
                setSessionPage(1);
              }}
            />
          )}
        </section>

        <section id="arrivals" aria-labelledby="arrivals-title">
          <div className="mb-4 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm sm:mb-5">
            <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-6">
              <div>
                <h2 id="arrivals-title" className="text-xl font-bold text-slate-900">Attendance arrivals</h2>
                <p className="mt-1 text-sm text-slate-500">Teacher, online staff, and admin staff records are listed separately.</p>
              </div>
              <button className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50" type="button" onClick={() => void loadDashboard()}>Refresh</button>
            </div>
            <div className="border-t border-slate-100 bg-slate-50/70 px-5 py-4 sm:px-6">
              <label className="relative block max-w-xl">
                <span className="sr-only">Search arrivals by name, email, or date</span>
                <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-slate-400" aria-hidden="true">⌕</span>
                <input className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-sm outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-100" type="search" placeholder="Search by name, email, or date..." value={arrivalSearch} onChange={(event) => {
                  setArrivalSearch(event.target.value);
                  setTeacherArrivalPage(1);
                  setOnlineStaffArrivalPage(1);
                  setAdminStaffArrivalPage(1);
                }} />
              </label>
            </div>
          </div>

          {isLoading ? (
            <div className="rounded-3xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500 shadow-sm">Loading attendance...</div>
          ) : hasDashboardLoadError ? null : (
            <div className="grid gap-5">
              <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm" aria-labelledby="teacher-arrivals-title">
                <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-4 sm:px-6">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-sm font-bold text-brand-700" aria-hidden="true">T</span>
                  <h3 id="teacher-arrivals-title" className="font-bold text-slate-800">Teacher arrivals</h3>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{teacherArrivals.length}</span>
                  <button
                    className="ml-auto rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    type="button"
                    onClick={() => setPrintArrivals({ label: 'Teacher arrivals', rows: teacherArrivals })}
                    disabled={teacherArrivals.length === 0}
                  >
                    Print list
                  </button>
                </div>
                {arrivals.length === 0
                  ? <p className="px-5 py-8 text-center text-sm text-slate-500">No one has checked in yet.</p>
                  : renderArrivalTable('teachers', teacherArrivals, teacherArrivalPage, setTeacherArrivalPage)}
              </section>

              <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm" aria-labelledby="online-staff-arrivals-title">
                <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-4 sm:px-6">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-50 text-sm font-bold text-sky-700" aria-hidden="true">O</span>
                  <h3 id="online-staff-arrivals-title" className="font-bold text-slate-800">Online staff arrivals</h3>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{onlineStaffArrivals.length}</span>
                  <button
                    className="ml-auto rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    type="button"
                    onClick={() => setPrintArrivals({ label: 'Online staff arrivals', rows: onlineStaffArrivals })}
                    disabled={onlineStaffArrivals.length === 0}
                  >
                    Print list
                  </button>
                </div>
                {arrivals.length === 0
                  ? <p className="px-5 py-8 text-center text-sm text-slate-500">No one has checked in yet.</p>
                  : renderArrivalTable('online staff', onlineStaffArrivals, onlineStaffArrivalPage, setOnlineStaffArrivalPage)}
              </section>

              <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm" aria-labelledby="admin-staff-arrivals-title">
                <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-4 sm:px-6">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-50 text-sm font-bold text-violet-700" aria-hidden="true">A</span>
                  <h3 id="admin-staff-arrivals-title" className="font-bold text-slate-800">Admin staff arrivals</h3>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{adminStaffArrivals.length}</span>
                  <button
                    className="ml-auto rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    type="button"
                    onClick={() => setPrintArrivals({ label: 'Admin staff arrivals', rows: adminStaffArrivals })}
                    disabled={adminStaffArrivals.length === 0}
                  >
                    Print list
                  </button>
                </div>
                {arrivals.length === 0
                  ? <p className="px-5 py-8 text-center text-sm text-slate-500">No one has checked in yet.</p>
                  : renderArrivalTable('admin staff', adminStaffArrivals, adminStaffArrivalPage, setAdminStaffArrivalPage)}
              </section>
            </div>
          )}
        </section>
      </div>

      {printSession && (
        <section className="print-sheet hidden flex-col items-center gap-6 p-12 text-center text-slate-900" aria-label="Printable tutoring session code">
          <Brand />
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-brand-700">Staffs and Online Admin Attendance</p>
            <h1 className="mt-3 text-4xl font-bold">{printSession.session_name}</h1>
            <p className="mt-2 text-xl text-slate-600">{deliveryDescription(printSession.delivery_mode)}</p>
          </div>
          <QRCodeSVG value={getCheckInUrl(printSession.qr_token)} size={300} level="M" includeMargin />
          <p className="text-sm text-slate-500">Scan to check in when class begins and check out when class ends.</p>
        </section>
      )}

      {printArrivals && (
        <section className="print-sheet hidden flex-col gap-6 p-8 text-slate-900" aria-label={`Printable ${printArrivals.label} list`}>
          <Brand />
          <div className="w-full border-b border-slate-300 pb-4">
            <h1 className="text-3xl font-bold">{printArrivals.label}</h1>
            <p className="mt-2 text-sm text-slate-600">Printed {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())} · {printArrivals.rows.length} records</p>
            {arrivalSearch.trim() && <p className="mt-1 text-sm text-slate-600">Search: {arrivalSearch.trim()}</p>}
          </div>
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b-2 border-slate-400">
                <th className="px-2 py-2 font-semibold">Name</th>
                <th className="px-2 py-2 font-semibold">Email</th>
                <th className="px-2 py-2 font-semibold">Tutoring session</th>
                <th className="px-2 py-2 font-semibold">Arrival</th>
                <th className="px-2 py-2 font-semibold">Departure</th>
                <th className="px-2 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {printArrivals.rows.map((arrival) => {
                const session = sessions.find((item) => item.id === arrival.session_id);
                return (
                  <tr className="border-b border-slate-200" key={arrival.id}>
                    <td className="px-2 py-2">{arrival.full_name}</td>
                    <td className="px-2 py-2">{arrival.email}</td>
                    <td className="px-2 py-2">{session ? `${session.session_name} · ${deliveryLabel(session.delivery_mode)}` : 'Session unavailable'}</td>
                    <td className="px-2 py-2">{formatAttendanceTime(arrival.arrived_at)}</td>
                    <td className="px-2 py-2">{arrival.departed_at ? formatAttendanceTime(arrival.departed_at) : '—'}</td>
                    <td className="px-2 py-2">{arrival.departed_at ? 'Departed' : 'Present'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
};

export default DashboardPage;
