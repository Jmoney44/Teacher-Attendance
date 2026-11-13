import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import Brand from '../components/Brand';
import { supabase } from '../lib/supabase';
import { getCurrentCoordinates } from '../utils/geolocation';

type PublicSession = {
  session_name: string;
  delivery_mode: 'in_home' | 'online' | 'staffs';
  is_open: boolean;
};

type SavedAttendance = {
  full_name: string;
  email: string;
  attendee_type: 'teacher' | 'student';
  arrived_at: string;
  departed_at: string | null;
  action: 'check_in' | 'check_out';
  session_name: string;
  delivery_mode: 'in_home' | 'online' | 'staffs';
  timezone: string;
};

const CheckInPage: React.FC = () => {
  const { token = '' } = useParams();
  const [session, setSession] = useState<PublicSession | null>(null);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [attendeeType, setAttendeeType] = useState<'teacher' | 'student'>('teacher');
  const [savedAttendance, setSavedAttendance] = useState<SavedAttendance | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const loadSession = async () => {
      if (!supabase || !token) {
        setErrorMessage('This attendance link is invalid.');
        setIsLoading(false);
        return;
      }

      const { data, error } = await supabase.rpc('get_public_tutoring_session', { p_token: token });
      if (error) setErrorMessage(error.message);
      else setSession(data as PublicSession);
      setIsLoading(false);
    };

    void loadSession();
  }, [token]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage('');
    if (!supabase) {
      setErrorMessage('Attendance is unavailable because the service is not configured.');
      return;
    }

    setIsSubmitting(true);
    let coordinates: { latitude: number; longitude: number } | null = null;
    if (session?.delivery_mode === 'staffs') {
      try {
        coordinates = await getCurrentCoordinates();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Could not determine your current location.');
        setIsSubmitting(false);
        return;
      }
    }

    const { data, error } = await supabase.rpc('record_public_checkin', {
      p_token: token,
      p_full_name: fullName,
      p_email: email,
      p_attendee_type: attendeeType,
      p_latitude: coordinates?.latitude ?? null,
      p_longitude: coordinates?.longitude ?? null,
    });
    setIsSubmitting(false);

    if (error) {
      const message = error.message.toLocaleLowerCase();
      if (message.includes('duplicate_checkin')) {
        setErrorMessage('This email already has an attendance record. Apply the latest Supabase migration to enable departure scans.');
      } else if (message.includes('attendance_complete')) {
        setErrorMessage('A departure has already been recorded for this email and session.');
      } else if (message.includes('session_closed')) {
        setErrorMessage('This session is closed to new arrivals. If you have already checked in, use the same email to record your departure.');
      } else if (message.includes('office_location_not_configured')) {
        setErrorMessage('Staffs attendance is not available until an admin sets the office location.');
      } else if (message.includes('outside_office_geofence')) {
        setErrorMessage('You must be within the office attendance area to use this Staffs code.');
      } else if (message.includes('office_location_required') || message.includes('invalid_location')) {
        setErrorMessage('Allow location access and try again to check in to Staffs attendance.');
      } else {
        setErrorMessage(error.message);
      }
      return;
    }

    const saved = data as SavedAttendance | null;
    if (!saved?.arrived_at || !saved.action) {
      setErrorMessage('The attendance record was not confirmed by the server.');
      return;
    }
    setSavedAttendance(saved);
  };

  const formatAttendanceTime = (timestamp: string) => new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: savedAttendance?.timezone,
  }).format(new Date(timestamp));
  const deliveryLabel = (mode: PublicSession['delivery_mode']) => {
    if (mode === 'in_home') return 'In-home tutoring';
    if (mode === 'online') return 'Online tutoring';
    return 'Staffs attendance';
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-brand-50 via-white to-emerald-50 px-5 py-10">
      <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-leaf/10 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-28 -left-20 h-80 w-80 rounded-full bg-sun/20 blur-3xl" aria-hidden="true" />
      <div className="relative w-full max-w-lg">
        <div className="mb-6 flex justify-center">
          <div className="rounded-2xl bg-white px-4 py-2 shadow-sm ring-1 ring-slate-100"><Brand /></div>
        </div>
        <section className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-card">
          <div className="h-2 bg-gradient-to-r from-brand-600 via-leaf to-sun" />
          <div className="p-6 sm:p-9">
            <p className="text-sm font-bold uppercase tracking-[0.17em] text-brand-600">Tutoring attendance</p>
            {isLoading ? <p className="mt-6 text-slate-500">Loading attendance form...</p> : errorMessage && !session ? (
              <p className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">{errorMessage}</p>
            ) : savedAttendance ? (
              <section className="mt-5" aria-live="polite">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-2xl font-bold text-brand-700" aria-hidden="true">
                  {savedAttendance.action === 'check_in' ? '✓' : '↗'}
                </div>
                <h1 className="mt-5 text-3xl font-bold tracking-tight text-slate-900">
                  {savedAttendance.action === 'check_in' ? 'You’re checked in!' : 'You’re checked out!'}
                </h1>
                <p className="mt-2 leading-6 text-slate-600">
                  {savedAttendance.action === 'check_in'
                    ? `${savedAttendance.full_name}, your arrival for ${savedAttendance.session_name} has been recorded.`
                    : `${savedAttendance.full_name}, your departure from ${savedAttendance.session_name} has been recorded.`}
                </p>
                <div className="mt-6 rounded-2xl bg-slate-50 p-5">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{savedAttendance.action === 'check_in' ? 'Arrival time' : 'Class attendance'}</p>
                  <p className="mt-1 text-lg font-bold text-slate-900">{formatAttendanceTime(savedAttendance.arrived_at)}</p>
                  {savedAttendance.departed_at && <p className="mt-1 text-sm text-slate-600">Departure · {formatAttendanceTime(savedAttendance.departed_at)}</p>}
                  <p className="mt-2 text-sm text-slate-500">{savedAttendance.attendee_type === 'teacher' ? 'Teacher' : 'Student'} · {deliveryLabel(savedAttendance.delivery_mode)}</p>
                </div>
                {savedAttendance.action === 'check_in' && (
                  <div className="mt-6 rounded-2xl border border-brand-100 bg-brand-50/70 p-4">
                    <p className="font-semibold text-brand-900">Remember to check out</p>
                    <p className="mt-1 text-sm leading-5 text-brand-800">Scan this same code at the end of class and enter the same email to record your departure.</p>
                    <button className="mt-3 rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-brand-900" type="button" onClick={() => {
                      setFullName(savedAttendance.full_name);
                      setEmail(savedAttendance.email);
                      setAttendeeType(savedAttendance.attendee_type);
                      setSavedAttendance(null);
                    }}>
                      Record my departure
                    </button>
                  </div>
                )}
              </section>
            ) : session ? (
              <>
                <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{session.session_name}</h1>
                <p className="mt-2 text-slate-500">{deliveryLabel(session.delivery_mode)} · Check in when class begins and check out when it ends.</p>
                {session.delivery_mode === 'staffs' && (
                  <p className="mt-3 rounded-xl border border-brand-100 bg-brand-50 p-3 text-sm text-brand-900">
                    Location access is required. Staffs attendance scans are accepted only within 100 meters of the office.
                  </p>
                )}
                {!session.is_open && (
                  <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-5 text-amber-900">
                    This session is closed to new arrivals. Already-checked-in attendees can still enter the same email to record a departure.
                  </p>
                )}
                <form className="mt-6 grid gap-4" onSubmit={handleSubmit}>
                  <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                    I am a
                    <select className="rounded-xl border border-slate-200 bg-white px-4 py-3 font-normal outline-none transition focus:border-brand-500 focus:ring-4 focus:ring-brand-100" value={attendeeType} onChange={(event) => setAttendeeType(event.target.value as 'teacher' | 'student')}>
                      <option value="teacher">Teacher</option>
                      <option value="student">Student</option>
                    </select>
                  </label>
                  <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                    Full name
                    <input className="rounded-xl border border-slate-200 px-4 py-3 font-normal outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-100" autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Enter your full name" required />
                  </label>
                  <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                    Email address
                    <input className="rounded-xl border border-slate-200 px-4 py-3 font-normal outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-100" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required />
                  </label>
                  {errorMessage && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{errorMessage}</p>}
                  <button className="mt-1 rounded-xl bg-brand-700 px-4 py-3.5 font-bold text-white shadow-sm transition hover:bg-brand-900 disabled:cursor-wait disabled:opacity-60" type="submit" disabled={isSubmitting}>
                    {isSubmitting ? 'Saving attendance...' : session.is_open ? 'Continue' : 'Record departure'}
                  </button>
                  <p className="text-center text-xs leading-5 text-slate-500">This form records the name and email entered. The shared link does not verify identity.</p>
                </form>
              </>
            ) : null}
          </div>
        </section>
        <p className="mt-5 text-center text-xs text-slate-400">A better day of learning starts with being here.</p>
      </div>
    </main>
  );
};

export default CheckInPage;
