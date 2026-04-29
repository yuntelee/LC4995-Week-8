import Link from "next/link";

export default function AuthErrorPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 py-16 text-white">
      <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-white/5 p-8 text-center shadow-2xl shadow-black/30 backdrop-blur">
        <p className="text-sm font-medium uppercase tracking-[0.3em] text-rose-300">
          Authentication error
        </p>
        <h1 className="mt-4 text-3xl font-semibold">Unable to sign you in</h1>
        <p className="mt-4 text-sm leading-6 text-slate-300">
          Check your Supabase environment variables and Google OAuth redirect URLs,
          then try again.
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex rounded-2xl bg-white px-5 py-3 font-semibold text-slate-950 transition hover:bg-slate-200"
        >
          Back to login
        </Link>
      </div>
    </main>
  );
}
