import { Link } from 'react-router-dom';
import Brand from '../components/Brand';

const QRScannerPage: React.FC = () => (
  <main className="min-h-screen bg-slate-50">
    <header className="border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
        <Brand />
        <Link className="rounded-full bg-brand-50 px-4 py-2 text-sm font-semibold text-brand-700" to="/dashboard">Back to dashboard</Link>
      </div>
    </header>
    <div className="mx-auto max-w-3xl px-5 py-12 sm:px-8 sm:py-20">
      <section className="rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-card sm:p-12">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-50 text-3xl text-brand-700" aria-hidden="true">⌗</div>
        <p className="mt-6 text-sm font-bold uppercase tracking-[0.17em] text-brand-600">Attendance tools</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Use your session code</h1>
        <p className="mx-auto mt-3 max-w-lg leading-6 text-slate-500">The camera scanner is not available here yet. Open the tutoring session’s printed QR code on a phone to check in, then scan it again at the end of class to check out.</p>
        <Link className="mt-7 inline-flex rounded-xl bg-brand-700 px-5 py-3 font-bold text-white transition hover:bg-brand-900" to="/dashboard">Go to sessions</Link>
      </section>
    </div>
  </main>
);

export default QRScannerPage;
