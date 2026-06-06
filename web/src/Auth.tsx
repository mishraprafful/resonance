// Auth gate: first-run admin bootstrap, then a split-screen login / signup (with team create-or-join).
// Wired to the real /v1/auth endpoints; the brand panel renders a decorative colormap spectrogram.
import { type ReactNode, useEffect, useState } from "react";
import { api, ApiError, type Me } from "./api";
import type { ColormapName } from "./design/theme";
import { Icon } from "./design/icons";
import { Btn } from "./design/ui";
import { DecorSpectrogram } from "./design/audioviz";

function Field({ label, type = "text", value, onChange, placeholder, autoFocus }: {
  label?: string; type?: string; value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean;
}) {
  const [focus, setFocus] = useState(false);
  return (
    <label style={{ display: "block" }}>
      {label && <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.02em", color: "var(--muted)", marginBottom: 6 }}>{label}</div>}
      <input type={type} value={value} placeholder={placeholder} autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        style={{ width: "100%", boxSizing: "border-box", border: `1.5px solid ${focus ? "var(--accent)" : "var(--line)"}`, background: "var(--panel)",
          borderRadius: 8, padding: "11px 13px", fontSize: 14, fontFamily: "var(--font-body)", color: "var(--ink)", outline: "none" }} />
    </label>
  );
}

type Mode = "login" | "signup" | "bootstrap";

function AuthScreen({ initialMode, onDone, colormap }: { initialMode: Mode; onDone: () => void; colormap: ColormapName }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [teamMode, setTeamMode] = useState<"create" | "join">("create");
  const [teamName, setTeamName] = useState("");
  const [teamSlug, setTeamSlug] = useState("");
  const [teams, setTeams] = useState<{ id: string; slug: string; name: string }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.listTeams().then(setTeams).catch(() => {}); }, []);

  const submit = () => {
    setErr(null);
    if (!u.trim() || !p) { setErr("Username and password are required."); return; }
    if (mode === "signup" && teamMode === "create" && !teamName.trim()) { setErr("Name your team."); return; }
    if (mode === "signup" && teamMode === "join" && !teamSlug) { setErr("Choose a team to join."); return; }
    setBusy(true);
    const action =
      mode === "bootstrap"
        ? api.bootstrap(u, p)
        : mode === "login"
          ? api.login(u, p)
          : api.signup({
              username: u, password: p, team_mode: teamMode,
              team_name: teamMode === "create" ? teamName : undefined,
              team_slug: teamMode === "create" ? teamName : teamSlug,
            });
    action.then(onDone).catch((e: ApiError) => { setErr(e.message); setBusy(false); });
  };

  return (
    <div style={{ minHeight: "100vh", display: "grid", gridTemplateColumns: "1.05fr 1fr" }} className="res-auth">
      {/* brand panel */}
      <div className="res-auth-brand" style={{ background: "#191b20", color: "#f1f0eb", padding: "48px 52px", display: "flex", flexDirection: "column", justifyContent: "space-between", position: "relative", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <span style={{ width: 30, height: 30, borderRadius: 8, background: "var(--accent)", color: "var(--accent-ink)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="waveform" size={18} /></span>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 20, letterSpacing: "-0.02em" }}>Resonance</span>
        </div>
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 42, lineHeight: 1.02, letterSpacing: "-0.03em", margin: 0, color: "#fff" }}>
            Audio-first ML<br />experiment <em style={{ fontStyle: "italic" }}>tracking</em>.
          </h1>
          <p style={{ marginTop: 18, fontSize: 15, color: "rgba(241,240,235,0.7)", maxWidth: 380, lineHeight: 1.5 }}>
            Log metrics, params and per-step generated audio. Listen, scrub across training steps, A/B compare, and read waveforms + spectrograms in the browser.
          </p>
        </div>
        <div style={{ borderRadius: 10, overflow: "hidden", border: "1px solid rgba(255,255,255,0.12)" }}>
          <DecorSpectrogram colormap={colormap} height={120} />
        </div>
      </div>

      {/* form panel */}
      <div style={{ background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", padding: 32 }}>
        <div style={{ width: "min(380px, 100%)" }}>
          {mode === "bootstrap" ? (
            <>
              <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 26, letterSpacing: "-0.02em", margin: 0, color: "var(--ink-strong)" }}>Welcome to Resonance</h2>
              <p style={{ color: "var(--muted)", fontSize: 13.5, marginTop: 8 }}>First run — create the platform admin account.</p>
            </>
          ) : (
            <>
              <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 26, letterSpacing: "-0.02em", margin: 0, color: "var(--ink-strong)" }}>{mode === "login" ? "Welcome back" : "Create your account"}</h2>
              <div style={{ display: "flex", gap: 3, background: "var(--panel-2)", padding: 3, borderRadius: 9, border: "1px solid var(--line-soft)", marginTop: 18, marginBottom: 18, width: "fit-content" }}>
                {(["login", "signup"] as const).map((v) => (
                  <button key={v} onClick={() => { setMode(v); setErr(null); }}
                    style={{ border: 0, cursor: "pointer", padding: "7px 16px", borderRadius: 6, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap",
                      background: mode === v ? "var(--panel)" : "transparent", color: mode === v ? "var(--ink-strong)" : "var(--muted)", boxShadow: mode === v ? "var(--shadow)" : "none" }}>{v === "login" ? "Log in" : "Sign up"}</button>
                ))}
              </div>
            </>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: mode === "bootstrap" ? 20 : 0 }}>
            <Field label={mode === "bootstrap" ? "Admin username" : "Username"} value={u} onChange={setU} placeholder="username" autoFocus />
            <Field label={mode === "bootstrap" ? "Admin password" : "Password"} type="password" value={p} onChange={setP} placeholder="password" />

            {mode === "signup" && (
              <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 14, background: "var(--panel)" }}>
                <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.02em", color: "var(--muted)", marginBottom: 10 }}>Team</div>
                <div style={{ display: "flex", gap: 3, background: "var(--panel-2)", padding: 3, borderRadius: 8, border: "1px solid var(--line-soft)", marginBottom: 12 }}>
                  {(["create", "join"] as const).map((v) => (
                    <button key={v} onClick={() => setTeamMode(v)}
                      style={{ flex: 1, border: 0, cursor: "pointer", padding: "7px 10px", borderRadius: 6, fontSize: 12.5, fontWeight: 600,
                        background: teamMode === v ? "var(--panel)" : "transparent", color: teamMode === v ? "var(--ink-strong)" : "var(--muted)" }}>{v === "create" ? "Create new" : "Join existing"}</button>
                  ))}
                </div>
                {teamMode === "create" ? (
                  <Field value={teamName} onChange={setTeamName} placeholder="team name" />
                ) : (
                  <select value={teamSlug} onChange={(e) => setTeamSlug(e.target.value)}
                    style={{ width: "100%", boxSizing: "border-box", border: "1.5px solid var(--line)", background: "var(--panel)", borderRadius: 8, padding: "11px 13px", fontSize: 14, color: "var(--ink)", fontFamily: "var(--font-body)" }}>
                    <option value="">choose a team…</option>
                    {teams.map((t) => <option key={t.id} value={t.slug}>{t.name}</option>)}
                  </select>
                )}
                {teamMode === "join" && <p style={{ fontSize: 11.5, color: "var(--faint)", margin: "8px 0 0" }}>Joining sends a request a team admin must approve.</p>}
              </div>
            )}

            {err && <div style={{ color: "var(--bad)", fontSize: 12.5 }}>{err}</div>}
            <Btn kind="primary" size="lg" onClick={submit} disabled={busy} style={{ justifyContent: "center", marginTop: 2 }}>
              {mode === "bootstrap" ? "Create admin & sign in" : mode === "login" ? "Log in" : "Sign up"}
            </Btn>

            {/* The admin-bootstrap toggle is only offered on first run; once an admin exists the
                option is gone for good (the backend also rejects bootstrap with 409). */}
            {initialMode === "bootstrap" && mode !== "signup" && (
              <div style={{ display: "flex", justifyContent: "flex-end", fontSize: 12, color: "var(--faint)", marginTop: 2 }}>
                <button onClick={() => { setMode(mode === "bootstrap" ? "login" : "bootstrap"); setErr(null); }} className="res-link"
                  style={{ border: 0, background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: 12, padding: 0, fontFamily: "var(--font-body)" }}>
                  {mode === "bootstrap" ? "Have an account? Log in" : "First run? Set up admin"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function AuthGate({ colormap, children }: { colormap: ColormapName; children: (me: Me, reload: () => void) => ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [phase, setPhase] = useState<"loading" | "bootstrap" | "auth" | "ready">("loading");

  const reload = () => {
    api.me()
      .then((m) => { setMe(m); setPhase("ready"); })
      .catch(async (e: ApiError) => {
        if (e.status === 401) {
          try {
            const { needs_bootstrap } = await api.bootstrapStatus();
            setPhase(needs_bootstrap ? "bootstrap" : "auth");
          } catch {
            setPhase("auth");
          }
        } else {
          setPhase("auth");
        }
      });
  };
  useEffect(reload, []);

  if (phase === "loading") return <div style={{ padding: 32, color: "var(--muted)" }}>Loading…</div>;
  if (phase === "bootstrap") return <AuthScreen initialMode="bootstrap" onDone={reload} colormap={colormap} />;
  if (phase === "auth") return <AuthScreen initialMode="login" onDone={reload} colormap={colormap} />;
  return <>{me && children(me, reload)}</>;
}
