// Resonance web UI — auth-gated, team-scoped shell on the Epidemic Sound design system.
// Top-nav (default) or sidebar layout, project + team switchers, and the runs / compare / gallery /
// datasets / account surfaces. The active team scopes everything; Tweaks control theme & layout.
import { useEffect, useState } from "react";
import { api, type Me, type Project } from "./api";
import { fmt, themeVars, type Tweaks } from "./design/theme";
import { Icon } from "./design/icons";
import { Empty } from "./design/ui";
import { useTweaks, TweaksPanel } from "./design/tweaks";
import { AuthGate } from "./Auth";
import { RunsView } from "./RunsView";
import { RunDetail } from "./RunDetail";
import { ComparePage } from "./ComparePage";
import { GalleryPage } from "./GalleryPage";
import { DatasetsPage } from "./DatasetsPage";
import { AccountPage } from "./AccountPage";

type View = "runs" | "compare" | "gallery" | "datasets" | "account";

const NAV: { id: View; label: string; icon: string }[] = [
  { id: "runs", label: "Runs", icon: "activity" },
  { id: "compare", label: "Compare", icon: "columns" },
  { id: "gallery", label: "Gallery", icon: "grid" },
  { id: "datasets", label: "Datasets", icon: "database" },
];

function Logo() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ width: 26, height: 26, borderRadius: 7, background: "var(--accent)", color: "var(--accent-ink)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Icon name="waveform" size={16} />
      </span>
      <span style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 17, letterSpacing: "-0.02em", color: "var(--ink-strong)" }}>Resonance</span>
    </div>
  );
}

function ProjectSwitcher({ project, projects, onPick }: { project: Project; projects: Project[]; onPick: (slug: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen((o) => !o)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 9, padding: "9px 12px", cursor: "pointer", color: "var(--ink)" }}>
        <span style={{ width: 28, height: 28, borderRadius: 7, background: "var(--accent)", color: "var(--accent-ink)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon name="music" size={16} />
        </span>
        <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink-strong)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{project.name}</div>
          <div style={{ fontSize: 11, color: "var(--faint)" }}>{project.slug}</div>
        </div>
        <Icon name="chevron-down" size={15} style={{ color: "var(--faint)" }} />
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, minWidth: 220, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10, boxShadow: "var(--shadow)", padding: 6, zIndex: 50 }}>
          {projects.map((p) => (
            <button key={p.id} onMouseDown={() => { onPick(p.slug); setOpen(false); }}
              style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", border: 0, background: p.id === project.id ? "var(--panel-3)" : "transparent", borderRadius: 7, padding: "9px 10px", cursor: "pointer", color: "var(--ink)", textAlign: "left" }}>
              <Icon name="music" size={15} style={{ color: "var(--muted)" }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TeamSwitcher({ me, reload, onManage }: { me: Me; reload: () => void; onManage: () => void }) {
  const [open, setOpen] = useState(false);
  const cur = me.teams.find((t) => t.org_id === me.current_org);
  const switchTo = (orgId: string) => { setOpen(false); api.switchTeam(orgId).then(reload).catch(() => {}); };
  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen((o) => !o)} onBlur={() => setTimeout(() => setOpen(false), 160)}
        style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 9, padding: "7px 11px", cursor: "pointer", color: "var(--ink)" }}>
        <Icon name="layers" size={15} style={{ color: "var(--muted)" }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-strong)", whiteSpace: "nowrap" }}>{cur ? cur.name : "No team"}</span>
        <Icon name="chevron-down" size={14} style={{ color: "var(--faint)" }} />
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, minWidth: 220, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10, boxShadow: "var(--shadow)", padding: 6, zIndex: 60 }}>
          <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--faint)", padding: "6px 10px" }}>Switch team</div>
          {me.teams.map((t) => (
            <button key={t.org_id} onMouseDown={() => switchTo(t.org_id)}
              style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", border: 0, background: t.org_id === me.current_org ? "var(--panel-3)" : "transparent", borderRadius: 7, padding: "9px 10px", cursor: "pointer", color: "var(--ink)", textAlign: "left" }}>
              <Icon name="layers" size={15} style={{ color: "var(--muted)" }} />
              <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{t.name}</span>
              <span style={{ fontSize: 11, color: "var(--faint)" }}>{t.role}</span>
              {t.org_id === me.current_org && <Icon name="check" size={14} style={{ color: "var(--accent)" }} />}
            </button>
          ))}
          {me.teams.length === 0 && <div style={{ padding: "6px 10px", fontSize: 12.5, color: "var(--faint)" }}>No teams yet.</div>}
          <div style={{ height: 1, background: "var(--line-soft)", margin: "6px 4px" }} />
          <button onMouseDown={onManage} style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", border: 0, background: "transparent", borderRadius: 7, padding: "9px 10px", cursor: "pointer", color: "var(--muted)", textAlign: "left", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
            <Icon name="sliders" size={15} />Manage teams
          </button>
        </div>
      )}
    </div>
  );
}

function UserMenu({ me, reload, onAccount }: { me: Me; reload: () => void; onAccount: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen((o) => !o)} onBlur={() => setTimeout(() => setOpen(false), 160)}
        style={{ width: 34, height: 34, borderRadius: 999, border: "1px solid var(--line)", background: "var(--panel-3)", color: "var(--ink)", cursor: "pointer", fontWeight: 700, fontSize: 12.5, fontFamily: "var(--font-display)" }}>
        {fmt.initials(me.username)}
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, minWidth: 200, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10, boxShadow: "var(--shadow)", padding: 6, zIndex: 60 }}>
          <div style={{ padding: "8px 10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink-strong)" }}>{me.username}</span>
              {me.is_admin && <span style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)" }}>admin</span>}
            </div>
          </div>
          <div style={{ height: 1, background: "var(--line-soft)", margin: "4px 4px" }} />
          <button onMouseDown={onAccount} style={menuItemStyle}><Icon name="git-branch" size={15} style={{ color: "var(--muted)" }} />Account &amp; teams</button>
          <button onMouseDown={() => api.logout().then(reload)} style={menuItemStyle}><Icon name="arrow-up-right" size={15} style={{ color: "var(--muted)" }} />Log out</button>
        </div>
      )}
    </div>
  );
}

const menuItemStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 9, width: "100%", border: 0, background: "transparent", borderRadius: 7,
  padding: "9px 10px", cursor: "pointer", color: "var(--ink)", textAlign: "left", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap",
};

function Shell({ me, reload, t }: { me: Me; reload: () => void; t: Tweaks }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectSlug, setProjectSlug] = useState<string | null>(null);
  const [view, setView] = useState<View>(me.current_org ? "runs" : "account");
  const [runId, setRunId] = useState<string | null>(null);
  const [compareSeed, setCompareSeed] = useState<string[]>([]);
  const [runsView, setRunsView] = useState<"table" | "cards">(t.runsView);
  useEffect(() => { setRunsView(t.runsView); }, [t.runsView]);

  useEffect(() => {
    if (!me.current_org) {
      setProjects([]);
      return;
    }
    api.projects().then((ps) => {
      setProjects(ps);
      setProjectSlug((cur) => (cur && ps.some((p) => p.slug === cur) ? cur : ps[0]?.slug ?? null));
    }).catch(() => setProjects([]));
  }, [me.current_org]);

  const project = projects.find((p) => p.slug === projectSlug) ?? null;

  const go = (v: View) => { setView(v); if (v !== "runs") setRunId(null); };
  const openRun = (id: string) => { setRunId(id); setView("runs"); window.scrollTo(0, 0); };
  const pickProject = (slug: string) => { setProjectSlug(slug); setRunId(null); setView("runs"); };
  const addCompare = (id?: string) => { setCompareSeed(id ? [id] : []); setView("compare"); setRunId(null); };
  const openAccount = () => { setView("account"); setRunId(null); };

  const navItems = NAV.map((n) => {
    const active = view === n.id;
    return (
      <button key={n.id} onClick={() => go(n.id)}
        style={{ display: "flex", alignItems: "center", gap: 11, width: t.layout === "sidebar" ? "100%" : "auto", border: 0,
          background: active ? "var(--panel-3)" : "transparent", borderRadius: 9, padding: t.layout === "sidebar" ? "10px 12px" : "9px 13px",
          cursor: "pointer", color: active ? "var(--ink-strong)" : "var(--muted)", fontWeight: 600, fontSize: 13.5, fontFamily: "var(--font-body)" }}>
        <Icon name={n.icon} size={17} />{n.label}
      </button>
    );
  });

  const main = view === "account"
    ? <AccountPage me={me} reload={reload} />
    : !me.current_org
      ? <Empty msg="You're not on a team yet — create or join one from Account & teams." />
      : !project
        ? <Empty msg="No projects in this team yet. Create one with the SDK." />
        : (
          <>
            {view === "runs" && !runId && <RunsView project={project} runsView={{ value: runsView, set: setRunsView }} onOpenRun={openRun} onCompare={() => addCompare()} colormap={t.colormap} />}
            {view === "runs" && runId && <RunDetail runId={runId} project={project} onBack={() => setRunId(null)} onCompare={addCompare} chartStyle={t.chartStyle} colormap={t.colormap} />}
            {view === "compare" && <ComparePage project={project} seedRunIds={compareSeed} colormap={t.colormap} chartStyle={t.chartStyle} />}
            {view === "gallery" && <GalleryPage project={project} colormap={t.colormap} />}
            {view === "datasets" && <DatasetsPage />}
          </>
        );

  if (t.layout === "sidebar") {
    return (
      <div style={{ display: "flex", minHeight: "100vh" }}>
        <aside style={{ width: 232, flexShrink: 0, borderRight: "1px solid var(--line)", background: "var(--panel)", display: "flex", flexDirection: "column", padding: 16, gap: 16, position: "sticky", top: 0, height: "100vh", boxSizing: "border-box" }}>
          <Logo />
          <TeamSwitcher me={me} reload={reload} onManage={openAccount} />
          {project && <ProjectSwitcher project={project} projects={projects} onPick={pickProject} />}
          <nav style={{ display: "flex", flexDirection: "column", gap: 3 }}>{navItems}</nav>
          <div style={{ flex: 1 }} />
          <button onClick={openAccount} style={{ display: "flex", alignItems: "center", gap: 10, border: 0, background: view === "account" ? "var(--panel-3)" : "transparent", borderRadius: 9, padding: "9px 10px", cursor: "pointer", color: "var(--ink)", textAlign: "left", borderTop: "1px solid var(--line-soft)" }}>
            <span style={{ width: 30, height: 30, borderRadius: 999, background: "var(--panel-3)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12, fontFamily: "var(--font-display)", color: "var(--ink)" }}>{fmt.initials(me.username)}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-strong)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{me.username}</div>
              <div style={{ fontSize: 11, color: "var(--faint)" }}>Account &amp; teams</div>
            </div>
          </button>
        </aside>
        <main style={{ flex: 1, minWidth: 0, padding: "28px 32px 80px", maxWidth: 1360 }}>{main}</main>
      </div>
    );
  }

  return (
    <div>
      <header style={{ position: "sticky", top: 0, zIndex: 40, borderBottom: "1px solid var(--line)", background: "color-mix(in srgb, var(--panel) 85%, transparent)", backdropFilter: "blur(12px)", padding: "0 24px", height: 64, display: "flex", alignItems: "center", gap: 18 }}>
        <Logo />
        <TeamSwitcher me={me} reload={reload} onManage={openAccount} />
        {project && <div style={{ width: 200 }}><ProjectSwitcher project={project} projects={projects} onPick={pickProject} /></div>}
        <nav style={{ display: "flex", gap: 4 }}>{navItems}</nav>
        <div style={{ flex: 1 }} />
        <UserMenu me={me} reload={reload} onAccount={openAccount} />
      </header>
      <main style={{ padding: "28px 32px 80px", maxWidth: 1360, margin: "0 auto" }}>{main}</main>
    </div>
  );
}

export function App() {
  const [t, setTweak] = useTweaks();
  return (
    <div style={{ ...themeVars(t), background: "var(--bg)", color: "var(--ink)", minHeight: "100vh", fontFamily: "var(--font-body)", fontSize: "var(--fs)", letterSpacing: "-0.01em" }}>
      <AuthGate colormap={t.colormap}>
        {(me, reload) => <Shell key={me.current_org ?? "none"} me={me} reload={reload} t={t} />}
      </AuthGate>
      <TweaksPanel t={t} setTweak={setTweak} />
    </div>
  );
}
