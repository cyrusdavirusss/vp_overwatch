"use client";

/**
 * VP·OVERWATCH — SubscribeModal (v2)
 * ─────────────────────────────────────────────────────────────────────────
 * Replaces the existing subscribe-modal.tsx.
 * Uses vp-theme.css classes — no Tailwind needed inside this file.
 *
 * Usage in page.tsx:
 *   import { SubscribeModal } from "@/components/subscribe-modal";
 *   {showSubscribe && <SubscribeModal onClose={() => setShowSubscribe(false)} />}
 */

import { useState } from "react";

interface SubscribeModalProps {
  onClose: () => void;
}

type AlertKey = "takeoff" | "landing" | "lost";

const ALERT_LABELS: Record<AlertKey, string> = {
  takeoff: "✈ Takeoff",
  landing: "⬇ Landing",
  lost:    "⚠ Lost Signal",
};

const XIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

export function SubscribeModal({ onClose }: SubscribeModalProps) {
  const [name, setName]     = useState("");
  const [phone, setPhone]   = useState("");
  const [toggles, setToggles] = useState<Record<AlertKey, boolean>>({
    takeoff: true,
    landing: true,
    lost:    true,
  });
  const [loading, setLoading]   = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const toggle = (k: AlertKey) =>
    setToggles((p) => ({ ...p, [k]: !p[k] }));

  const handleSubmit = async () => {
    if (!phone.trim()) {
      setError("Phone number is required.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || undefined,
          phone: phone.trim(),
          alertTakeoff: toggles.takeoff,
          alertLanding: toggles.landing,
          alertLostSignal: toggles.lost,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSubmitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Subscription failed. Try again.");
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="vp-modal-overlay" onClick={onClose}>
        <div className="vp-modal" onClick={(e) => e.stopPropagation()}>
          <div className="vp-modal-header">
            <div className="vp-modal-title">REQUEST RECEIVED</div>
            <div className="vp-modal-subtitle">Pending confirmation — no calls until verified</div>
          </div>
          <div className="vp-modal-body" style={{ textAlign: "center", padding: "32px 20px" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, lineHeight: 1.6 }}>
              We've recorded <strong style={{ color: "rgba(255,255,255,0.8)" }}>{phone}</strong>. Before any
              calls are placed we'll confirm your number — you won't be contacted until consent is verified.
            </div>
          </div>
          <div className="vp-modal-footer">
            <button className="vp-modal-submit" onClick={onClose}>CLOSE</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="vp-modal-overlay" onClick={onClose}>
      <div className="vp-modal" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="vp-modal-header">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div className="vp-modal-title">SUBSCRIBE — FREE</div>
              <div className="vp-modal-subtitle">Hermes AI voice alerts via Bland AI</div>
            </div>
            <button
              onClick={onClose}
              style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", padding: 4 }}
              aria-label="Close"
            >
              <XIcon />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="vp-modal-body">
          <div className="vp-modal-field">
            <label className="vp-modal-label" htmlFor="sub-name">Name (optional)</label>
            <input
              id="sub-name"
              className="vp-modal-input"
              placeholder="e.g. Alex"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
          </div>

          <div className="vp-modal-field">
            <label className="vp-modal-label" htmlFor="sub-phone">Phone Number *</label>
            <input
              id="sub-phone"
              className="vp-modal-input"
              placeholder="+61 4XX XXX XXX"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="tel"
            />
          </div>

          <div style={{ marginTop: 12 }}>
            <div className="vp-modal-label" style={{ marginBottom: 8, display: "block" }}>Alert Types</div>
            {(["takeoff", "landing", "lost"] as AlertKey[]).map((k) => (
              <div className="vp-modal-toggle-row" key={k}>
                <span className="vp-modal-toggle-label">{ALERT_LABELS[k]}</span>
                <div
                  className={`vp-toggle ${toggles[k] ? "on" : ""}`}
                  onClick={() => toggle(k)}
                  role="switch"
                  aria-checked={toggles[k]}
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && toggle(k)}
                />
              </div>
            ))}
          </div>

          {error && (
            <div style={{ marginTop: 8, padding: "6px 10px", background: "rgba(255,45,45,0.1)", border: "1px solid rgba(255,45,45,0.3)", borderRadius: 4, fontFamily: "'Space Mono', monospace", fontSize: 10, color: "var(--vp-red)" }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="vp-modal-footer">
          <button className="vp-modal-cancel" onClick={onClose} disabled={loading}>
            CANCEL
          </button>
          <button
            className="vp-modal-submit"
            onClick={handleSubmit}
            disabled={loading}
            style={loading ? { opacity: 0.6, cursor: "not-allowed" } : {}}
          >
            {loading ? "SUBSCRIBING…" : "SUBSCRIBE"}
          </button>
        </div>
      </div>
    </div>
  );
}
