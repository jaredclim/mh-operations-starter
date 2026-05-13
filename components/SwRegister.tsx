"use client";

import { useEffect } from "react";

/**
 * Registers the service worker on first mount. Required for installable
 * PWA on most platforms. Silent if the browser doesn't support service
 * workers (e.g. older browsers, internal Vercel preview env).
 */
export function SwRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // Register after page load so it doesn't slow first paint
    const onLoad = () => {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.warn("sw register failed", err);
      });
    };
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad, { once: true });
  }, []);
  return null;
}
