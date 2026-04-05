"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getBrowserSupabaseClient } from "@/lib/supabase/browser";
import { TABLES } from "@/lib/config";

type Props = {
  children: ReactNode;
};

type GateStatus = "checking" | "signed-out" | "denied" | "allowed" | "error";

function SignInCard({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function signIn(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const supabase = getBrowserSupabaseClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setMessage(error.message);
        return;
      }

      onSignedIn();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sign in failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="app-card mx-auto max-w-md p-5 md:p-6">
      <h2 className="text-lg font-semibold">Admin sign in</h2>
      <p className="subtle mt-2 text-sm">Only superadmins or matrix admins can access this tool.</p>
      <form className="mt-4 space-y-3" onSubmit={signIn}>
        <label className="block text-sm">
          Email
          <input
            className="input mt-1"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>

        <label className="block text-sm">
          Password
          <input
            className="input mt-1"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>

        <button className="btn btn-primary w-full" type="submit" disabled={loading}>
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>
      {message ? <p className="mt-3 text-sm text-red-500">{message}</p> : null}
    </section>
  );
}

export function AuthGate({ children }: Props) {
  const [status, setStatus] = useState<GateStatus>("checking");
  const [user, setUser] = useState<User | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");

  async function evaluateUser(nextUser: User | null) {
    setUser(nextUser);

    if (!nextUser) {
      setStatus("signed-out");
      return;
    }

    try {
      const supabase = getBrowserSupabaseClient();
      const { data, error } = await supabase
        .from(TABLES.profiles)
        .select("is_superadmin,is_matrix_admin")
        .eq("id", nextUser.id)
        .maybeSingle();

      if (error) {
        setErrorMessage(error.message);
        setStatus("error");
        return;
      }

      const authorized = Boolean(data?.is_superadmin || data?.is_matrix_admin);
      if (!authorized) {
        setStatus("denied");
        return;
      }

      setStatus("allowed");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Authorization failed.");
      setStatus("error");
    }
  }

  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        const supabase = getBrowserSupabaseClient();
        const { data } = await supabase.auth.getSession();
        if (!mounted) {
          return;
        }
        await evaluateUser(data.session?.user ?? null);

        supabase.auth.onAuthStateChange(async (_event, session) => {
          if (!mounted) {
            return;
          }
          await evaluateUser(session?.user ?? null);
        });
      } catch (error) {
        if (mounted) {
          setErrorMessage(error instanceof Error ? error.message : "Authentication bootstrap failed.");
          setStatus("error");
        }
      }
    }

    void init();

    return () => {
      mounted = false;
    };
  }, []);

  const userHint = useMemo(() => {
    if (!user) {
      return "";
    }
    return user.email ?? user.id;
  }, [user]);

  async function signOut() {
    try {
      const supabase = getBrowserSupabaseClient();
      await supabase.auth.signOut();
      setStatus("signed-out");
    } catch {
      setStatus("signed-out");
    }
  }

  if (status === "checking") {
    return (
      <section className="app-card p-6">
        <p className="subtle">Checking authentication...</p>
      </section>
    );
  }

  if (status === "signed-out") {
    return <SignInCard onSignedIn={() => setStatus("checking")} />;
  }

  if (status === "denied") {
    return (
      <section className="app-card p-6">
        <h2 className="text-lg font-semibold text-red-500">Access denied</h2>
        <p className="subtle mt-2 text-sm">
          User {userHint || "(unknown)"} is not authorized. Required role: profiles.is_superadmin = true OR
          profiles.is_matrix_admin = true.
        </p>
        <button className="btn mt-4" onClick={signOut} type="button">
          Sign out
        </button>
      </section>
    );
  }

  if (status === "error") {
    return (
      <section className="app-card p-6">
        <h2 className="text-lg font-semibold text-red-500">Access denied</h2>
        <p className="subtle mt-2 text-sm">{errorMessage || "Unable to verify admin access."}</p>
        <button className="btn mt-4" onClick={signOut} type="button">
          Sign out
        </button>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <div className="app-card flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
        <p className="text-sm">
          Signed in as <span className="font-medium">{userHint}</span>
        </p>
        <button className="btn" onClick={signOut} type="button">
          Sign out
        </button>
      </div>
      {children}
    </div>
  );
}
