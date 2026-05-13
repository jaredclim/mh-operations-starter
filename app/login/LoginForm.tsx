"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function EyeIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
        <line x1="1" y1="1" x2="23" y2="23" />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const from = params.get("from") || "/";
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || "Wrong password.");
        setLoading(false);
        return;
      }
      router.push(from);
      router.refresh();
    } catch {
      setError("Something went wrong. Try again.");
      setLoading(false);
    }
  }

  return (
    <main
      className="relative min-h-screen flex flex-col items-center justify-center p-6 overflow-hidden"
      style={{
        background: "radial-gradient(ellipse at 50% 35%, #1b3f60 0%, #0F2D4A 45%, #071929 100%)",
      }}
    >
      {/* Grain texture */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`,
          opacity: 0.035,
        }}
      />

      {/* Subtle vignette */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(ellipse at 50% 50%, transparent 50%, rgba(4,12,22,0.55) 100%)",
        }}
      />

      <div className="relative w-full max-w-[420px]">
        {/* Logo pill — white container matches nav pattern */}
        <div className="flex flex-col items-center mb-7">
          <div
            className="h-14 px-4 rounded-2xl flex items-center justify-center mb-4"
            style={{
              background: "rgba(255,255,255,0.97)",
              boxShadow: "0 2px 8px rgba(0,0,0,0.25), 0 0 0 1px rgba(255,255,255,0.1)",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/cc-logo.png" alt="Colour Craft" className="h-8 w-auto object-contain" />
          </div>
          <p className="text-[11px] uppercase tracking-[0.28em] font-semibold text-cc-accent">
            Colour Craft Painting
          </p>
        </div>

        {/* Card */}
        <div
          className="bg-white rounded-2xl overflow-hidden"
          style={{
            boxShadow:
              "0 4px 6px rgba(0,0,0,0.08), 0 24px 64px -12px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.06)",
          }}
        >
          {/* Orange accent bar */}
          <div className="h-[3px] w-full bg-cc-accent" />

          <div className="px-8 pt-7 pb-8">
            {/* Heading */}
            <div className="mb-7 text-center">
              <h1 className="text-[26px] font-bold tracking-tight text-text-primary leading-tight">
                Dashboard
              </h1>
              <p className="mt-1.5 text-sm text-text-secondary">
                Enter your password to continue
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-text-primary mb-2">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    autoFocus
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-xl border border-border-strong bg-bg px-4 py-3 text-base pr-11
                      placeholder-text-muted text-text-primary
                      focus:outline-none focus:ring-2 focus:ring-cc-accent/25 focus:border-cc-accent
                      transition-shadow duration-150"
                    placeholder="••••••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    tabIndex={-1}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md
                      text-text-muted hover:text-text-secondary transition-colors"
                  >
                    <EyeIcon open={showPassword} />
                  </button>
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2.5 text-sm text-cc-danger bg-red-50 border border-red-100 rounded-xl px-4 py-3">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 mt-0.5">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !password}
                className="w-full rounded-xl font-semibold py-3 text-[15px] text-white
                  transition-all duration-150 focus:outline-none focus:ring-2
                  focus:ring-cc-accent/40 focus:ring-offset-2
                  disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: "linear-gradient(135deg, #0F2D4A 0%, #1E5C8A 100%)",
                  boxShadow: loading || !password
                    ? "none"
                    : "0 1px 2px rgba(15,45,74,0.2), 0 4px 12px -2px rgba(15,45,74,0.35)",
                }}
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <Spinner />
                    Signing in…
                  </span>
                ) : (
                  "Sign in"
                )}
              </button>
            </form>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center mt-6 text-[11px] text-white/25 tracking-wide">
          &copy; {new Date().getFullYear()} Colour Craft Painting
        </p>
      </div>
    </main>
  );
}
