import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Brand from '../components/Brand';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage('');

    if (!isSupabaseConfigured || !supabase) {
      setErrorMessage('Supabase is not configured. Add the project URL and public anon key to .env.local, then restart the app.');
      return;
    }

    setIsSubmitting(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setErrorMessage(error.message);
      setIsSubmitting(false);
      return;
    }

    const { data: membership, error: membershipError } = await supabase
      .from('admins')
      .select('user_id')
      .eq('user_id', data.user.id)
      .maybeSingle();

    if (membershipError || !membership) {
      await supabase.auth.signOut();
      setErrorMessage(membershipError?.message ?? 'This account is not authorized as an administrator.');
      setIsSubmitting(false);
      return;
    }

    navigate('/dashboard', { replace: true });
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-brand-900 via-brand-700 to-brand-600 px-5 py-10">
      <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-leaf/30 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-32 -left-20 h-96 w-96 rounded-full bg-sun/20 blur-3xl" aria-hidden="true" />
      <section className="relative w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="h-2 bg-gradient-to-r from-leaf via-sun to-brand-500" />
        <div className="p-7 sm:p-10">
          <div className="mb-8 flex justify-center rounded-2xl bg-slate-50 py-3">
            <Brand />
          </div>
          <p className="text-sm font-bold uppercase tracking-[0.17em] text-brand-600">Administrator access</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Welcome back</h1>
          <p className="mt-2 text-slate-500">Sign in to manage your tutoring attendance.</p>

          <form className="mt-7 grid gap-4" onSubmit={handleSubmit}>
            <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
              Email address
              <input className="rounded-xl border border-slate-200 px-4 py-3 font-normal outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-100" type="email" placeholder="you@example.com" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
              Password
              <input className="rounded-xl border border-slate-200 px-4 py-3 font-normal outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-100" type="password" placeholder="Enter your password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
            {errorMessage && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{errorMessage}</p>}
            <button className="mt-1 rounded-xl bg-brand-700 px-4 py-3.5 font-bold text-white shadow-sm transition hover:bg-brand-900 disabled:cursor-wait disabled:opacity-60" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
          <p className="mt-6 text-center text-xs text-slate-400">Secure access for authorized administrators.</p>
        </div>
      </section>
    </main>
  );
};

export default LoginPage;
