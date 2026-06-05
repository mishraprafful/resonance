// Auth gate: first-run admin bootstrap, then login / signup (with create-or-join a team).
import { type ReactNode, useEffect, useState } from "react";
import { api, ApiError, type Me } from "./api";

const box: React.CSSProperties = { maxWidth: 360, margin: "10vh auto", fontFamily: "system-ui" };
const field: React.CSSProperties = { display: "block", width: "100%", padding: 8, margin: "6px 0", boxSizing: "border-box" };

function BootstrapForm({ onDone }: { onDone: () => void }) {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <div style={box}>
      <h2>Welcome to Resonance</h2>
      <p style={{ color: "#666" }}>First run — create the admin account.</p>
      <input style={field} placeholder="admin username" value={u} onChange={(e) => setU(e.target.value)} />
      <input style={field} type="password" placeholder="admin password" value={p} onChange={(e) => setP(e.target.value)} />
      {err && <p style={{ color: "crimson" }}>{err}</p>}
      <button
        style={field}
        onClick={() => api.bootstrap(u, p).then(onDone).catch((e: ApiError) => setErr(e.message))}
      >
        Create admin & sign in
      </button>
    </div>
  );
}

function LoginSignup({ onDone }: { onDone: () => void }) {
  const [tab, setTab] = useState<"login" | "signup">("login");
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [teamMode, setTeamMode] = useState<"create" | "join">("create");
  const [teamName, setTeamName] = useState("");
  const [teamSlug, setTeamSlug] = useState("");
  const [teams, setTeams] = useState<{ id: string; slug: string; name: string }[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { api.listTeams().then(setTeams).catch(() => {}); }, []);

  const submit = () => {
    setErr(null);
    const action =
      tab === "login"
        ? api.login(u, p)
        : api.signup({
            username: u, password: p, team_mode: teamMode,
            team_name: teamMode === "create" ? teamName : undefined,
            team_slug: teamMode === "create" ? teamName : teamSlug,
          });
    action.then(onDone).catch((e: ApiError) => setErr(e.message));
  };

  return (
    <div style={box}>
      <h2>Resonance</h2>
      <div style={{ marginBottom: 8 }}>
        <button onClick={() => setTab("login")} style={{ fontWeight: tab === "login" ? 700 : 400 }}>Log in</button>
        <button onClick={() => setTab("signup")} style={{ fontWeight: tab === "signup" ? 700 : 400 }}>Sign up</button>
      </div>
      <input style={field} placeholder="username" value={u} onChange={(e) => setU(e.target.value)} />
      <input style={field} type="password" placeholder="password" value={p} onChange={(e) => setP(e.target.value)} />

      {tab === "signup" && (
        <div style={{ border: "1px solid #eee", borderRadius: 6, padding: 8, marginBottom: 6 }}>
          <div style={{ fontSize: 13, marginBottom: 4 }}>Team</div>
          <label style={{ fontSize: 13, marginRight: 10 }}>
            <input type="radio" checked={teamMode === "create"} onChange={() => setTeamMode("create")} /> create new
          </label>
          <label style={{ fontSize: 13 }}>
            <input type="radio" checked={teamMode === "join"} onChange={() => setTeamMode("join")} /> join existing
          </label>
          {teamMode === "create" ? (
            <input style={field} placeholder="team name" value={teamName} onChange={(e) => setTeamName(e.target.value)} />
          ) : (
            <select style={field} value={teamSlug} onChange={(e) => setTeamSlug(e.target.value)}>
              <option value="">choose a team…</option>
              {teams.map((t) => <option key={t.id} value={t.slug}>{t.name}</option>)}
            </select>
          )}
          {teamMode === "join" && <p style={{ fontSize: 12, color: "#888" }}>Joining sends a request a team admin must approve.</p>}
        </div>
      )}
      {err && <p style={{ color: "crimson" }}>{err}</p>}
      <button style={field} onClick={submit}>{tab === "login" ? "Log in" : "Sign up"}</button>
    </div>
  );
}

export function AuthGate({ children }: { children: (me: Me, reload: () => void) => ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [phase, setPhase] = useState<"loading" | "bootstrap" | "auth" | "ready">("loading");

  const reload = () => {
    api.me()
      .then((m) => { setMe(m); setPhase("ready"); })
      .catch(async (e: ApiError) => {
        if (e.status === 401) {
          const { needs_bootstrap } = await api.bootstrapStatus();
          setPhase(needs_bootstrap ? "bootstrap" : "auth");
        } else {
          setPhase("auth");
        }
      });
  };
  useEffect(reload, []);

  if (phase === "loading") return <p style={{ fontFamily: "system-ui", padding: 24 }}>Loading…</p>;
  if (phase === "bootstrap") return <BootstrapForm onDone={reload} />;
  if (phase === "auth") return <LoginSignup onDone={reload} />;
  return <>{me && children(me, reload)}</>;
}
