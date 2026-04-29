"use client";

import { useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { HumorFlavorManager } from "@/components/humor-flavor-manager";
import { ThemeModeToggle } from "@/components/theme-mode-toggle";
import type { ThemeMode } from "@/types/humor";

const STORAGE_KEY = "humorflavor-theme-mode";

export function AppClient() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") {
      return "system";
    }

    const stored = window.localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }

    return "system";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", themeMode);
    window.localStorage.setItem(STORAGE_KEY, themeMode);
  }, [themeMode]);

  const title = useMemo(() => "HumorFlavor Manager", []);

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 md:px-8 md:py-12">
      <header className="app-card mb-6 flex flex-col gap-4 p-5 md:mb-8 md:flex-row md:items-center md:justify-between md:p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
          <p className="subtle mt-2 text-sm md:text-base">
            Manage humor flavors, ordered steps, and test caption generation.
          </p>
        </div>
        <ThemeModeToggle value={themeMode} onChange={setThemeMode} />
      </header>

      <AuthGate>
        <HumorFlavorManager />
      </AuthGate>
    </main>
  );
}
