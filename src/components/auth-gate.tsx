"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getBrowserSupabaseClient } from "@/lib/supabase/browser";

type Props = {
  children: ReactNode;
};

type GateStatus = "checking" | "signed-out" | "denied" | "allowed" | "error";

function SignInCard() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function signInWithGoogle() {
    setLoading(true);
    setMessage(null);

    try {
      const supabase = getBrowserSupabaseClient();

      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
      const origin = siteUrl
        ? siteUrl.startsWith("http://") || siteUrl.startsWith("https://")
          ? siteUrl
          : `https://${siteUrl}`
        : window.location.origin;

      const redirectTo = new URL("/auth/callback", origin).toString();

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
          skipBrowserRedirect: true,
          queryParams: {
            access_type: "offline",
            prompt: "consent",
          },
        },
      });

      if (error || !data?.url) {
        setLoading(false);
        setMessage(error?.message ?? "Unable to start Google sign-in. Please try again.");
        return;
      }

      window.location.assign(data.url);
    } catch (error) {
      setLoading(false);
      setMessage(error instanceof Error ? error.message : "Google sign in failed.");
    }
  }

  return (
    <section className="app-card mx-auto max-w-md p-5 md:p-6">
      <h2 className="text-lg font-semibold">Admin sign in</h2>
      <p className="subtle mt-2 text-sm">Use Google to sign in. Access still requires admin profile roles.</p>
      <button className="btn btn-primary mt-4 w-full" type="button" onClick={() => void signInWithGoogle()} disabled={loading}>
        {loading ? "Redirecting to Google..." : "Continue with Google"}
      </button>
      {message ? <p className="mt-3 text-sm text-red-500">{message}</p> : null}
    </section>
  );
}

export function AuthGate({ children }: Props) {
  const [status, setStatus] = useState<GateStatus>("checking");
  const [user, setUser] = useState<User | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");

  async function evaluateUser(nextUser: User | null, accessToken?: string | null) {
    setUser(nextUser);

    if (!nextUser) {
      setStatus("signed-out");
      return;
    }

    try {
      const supabase = getBrowserSupabaseClient();
      const token =
        accessToken ??
        (await supabase.auth.getSession()).data.session?.access_token ??
        null;

      if (!token) {
        setStatus("signed-out");
        return;
      }

      const response = await fetch("/api/admin/me", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string; authorized?: boolean }
        | null;

      if (!response.ok) {
        if (response.status === 403) {
          setStatus("denied");
          return;
        }

        setErrorMessage(payload?.error ?? "Failed to verify admin role.");
        setStatus("error");
        return;
      }

      if (!payload?.authorized) {
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
    let unsubscribe: (() => void) | null = null;

    async function init() {
      try {
        const supabase = getBrowserSupabaseClient();
        const { data } = await supabase.auth.getSession();
        if (!mounted) {
          return;
        }
        await evaluateUser(data.session?.user ?? null, data.session?.access_token ?? null);

        const {
          data: { subscription },
        } = supabase.auth.onAuthStateChange(async (_event, session) => {
          if (!mounted) {
            return;
          }
          await evaluateUser(session?.user ?? null, session?.access_token ?? null);
        });

        unsubscribe = () => subscription.unsubscribe();
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
      unsubscribe?.();
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
    return <SignInCard />;
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
