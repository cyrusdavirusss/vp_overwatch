"use client";

/**
 * VP·OVERWATCH — install-to-phone button
 * ─────────────────────────────────────────────────────────────────────────
 * For the reader who lands on the site on a phone and wants the app on their
 * home screen instead of a browser tab. Three states, because browsers
 * disagree about what "install" means:
 *
 *   1. Chromium / Android — fires `beforeinstallprompt`, so we can offer a
 *      real one-tap install with the native dialog.
 *   2. iOS Safari — never fires it. No API call can install on iOS; the user
 *      must go through Share → Add to Home Screen, so the button explains it.
 *   3. Already installed (standalone display mode) — render nothing. Offering
 *      to install the app you are currently using reads as broken.
 *
 * This also registers /sw.js. The worker deliberately caches nothing (live
 * telemetry must never be served stale), but registering it on load is what
 * the browser wants before offering the richer install path — and push needs
 * a worker too. Previously it only registered when someone opened the push
 * toggle, so a first-time visitor had no worker at all.
 *
 * Requires vp-theme.css (`.vp-btn`, `.vp-modal*`).
 */

import { useCallback, useEffect, useState } from "react";

/** Not in lib.dom: Chrome/Samsung ship it, Safari/Firefox do not. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Module scope on purpose. `beforeinstallprompt` can fire before React mounts,
 * and a listener added inside useEffect would miss it — the button would then
 * never appear on exactly the browsers that support one-tap install.
 */
let captured: BeforeInstallPromptEvent | null = null;
const subscribers = new Set<(e: BeforeInstallPromptEvent | null) => void>();

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // suppress the browser's own mini-infobar; we ask instead
    captured = e as BeforeInstallPromptEvent;
    subscribers.forEach((fn) => fn(captured));
  });
  window.addEventListener("appinstalled", () => {
    captured = null;
    subscribers.forEach((fn) => fn(null));
  });
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS predates display-mode and exposes this non-standard flag instead.
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/** iOS is the one platform where install is manual — and every browser there is WebKit. */
function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports itself as a Mac; the touch points give it away.
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  );
}

export function PwaInstall() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(captured);
  const [installed, setInstalled] = useState(false);
  const [showSteps, setShowSteps] = useState(false);

  useEffect(() => {
    setInstalled(isStandalone());

    const onPrompt = (e: BeforeInstallPromptEvent | null) => {
      setDeferred(e);
      if (e) setShowSteps(false);
    };
    subscribers.add(onPrompt);

    // Fires when the app is launched from the home screen instead, so the
    // button retires itself without a reload.
    const mq = window.matchMedia("(display-mode: standalone)");
    const onMode = () => setInstalled(isStandalone());
    mq.addEventListener?.("change", onMode);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        /* insecure context or unsupported — the button simply stays hidden */
      });
    }

    return () => {
      subscribers.delete(onPrompt);
      mq.removeEventListener?.("change", onMode);
    };
  }, []);

  const dismiss = useCallback(() => setShowSteps(false), []);

  if (installed) return null;

  const needsSteps = !deferred && isIOS();

  const onClick = async () => {
    if (!deferred) {
      setShowSteps(true);
      return;
    }
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    // 'dismissed' keeps the button: they may well want it later.
    if (outcome === "accepted") setDeferred(null);
  };

  if (!deferred && !needsSteps) return null; // no install path here — say nothing

  return (
    <>
      <button
        className="vp-btn vp-btn--install"
        onClick={onClick}
        aria-label="Install VP·Overwatch on this device"
      >
        <InstallIcon />
        <span>Install</span>
      </button>

      {showSteps && (
        <div className="vp-modal-overlay" onClick={dismiss} role="dialog" aria-modal="true">
          <div className="vp-modal" onClick={(e) => e.stopPropagation()}>
            <div className="vp-modal-header">
              <div className="vp-modal-title">INSTALL ON iPHONE</div>
              <div className="vp-modal-subtitle">Two taps in Safari — iOS has no install button to offer</div>
            </div>
            <div className="vp-modal-body">
              <p>
                iOS does not let a website install itself — there is no button any site
                can press for you. Two taps in Safari:
              </p>
              <ol style={{ margin: "10px 0 0 18px", lineHeight: 1.7 }}>
                <li>
                  Tap <strong>Share</strong> (the square with the arrow) in Safari&apos;s toolbar.
                </li>
                <li>
                  Scroll down and tap <strong>Add to Home Screen</strong>.
                </li>
              </ol>
              <p style={{ marginTop: 10, opacity: 0.75 }}>
                It opens full-screen like an app, with the VP·OVERWATCH icon.
              </p>
            </div>
            <div className="vp-modal-footer">
              <button className="vp-btn vp-modal-submit" onClick={dismiss}>
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function InstallIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M4 21h16" />
    </svg>
  );
}
