"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [light, setLight] = useState(false);

  useEffect(() => {
    setLight(document.documentElement.classList.contains("light"));
  }, []);

  const toggle = () => {
    const next = !document.documentElement.classList.contains("light");
    document.documentElement.classList.toggle("light", next);
    localStorage.setItem("sessionlens-theme", next ? "light" : "dark");
    setLight(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className="press-scale inline-flex h-8 w-8 items-center justify-center rounded-md border"
      style={{ borderColor: "var(--line)", color: "var(--muted)" }}
      aria-label={light ? "切换到深色" : "切换到浅色"}
    >
      {light ? <Moon size={14} /> : <Sun size={14} />}
    </button>
  );
}
