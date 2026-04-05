"use client";

import type { ThemeMode } from "@/types/humor";

type Props = {
  value: ThemeMode;
  onChange: (value: ThemeMode) => void;
};

export function ThemeModeToggle({ value, onChange }: Props) {
  const options: ThemeMode[] = ["light", "dark", "system"];

  return (
    <div className="app-card inline-flex items-center gap-1 p-1">
      {options.map((option) => {
        const active = option === value;
        return (
          <button
            key={option}
            className={`btn px-3 py-1.5 text-sm ${active ? "btn-primary" : ""}`}
            onClick={() => onChange(option)}
            type="button"
          >
            {option[0].toUpperCase() + option.slice(1)}
          </button>
        );
      })}
    </div>
  );
}
