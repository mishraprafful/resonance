// Resonance web UI: auth-gated, team-scoped shell on the Resonance Signal design system.
// Top-nav (default) or sidebar layout, project + team switchers, and the runs / compare / gallery /
// datasets / account surfaces. The active team scopes everything; Tweaks control theme & layout.
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type Me, type Project } from "./api";
import { fmt, themeVars, type Tweaks } from "./design/theme";
import { Icon } from "./design/icons";
import { BrandMark, Btn, ConfirmDialog, Empty, PageTitle } from "./design/ui";
import { useTweaks, TweaksPanel } from "./design/tweaks";
import { AuthGate } from "./Auth";
import { RunsView } from "./RunsView";
import { RunDetail } from "./RunDetail";
import { ComparePage } from "./ComparePage";
import { GalleryPage } from "./GalleryPage";
import { DatasetsPage } from "./DatasetsPage";
import { AccountPage } from "./AccountPage";

type View = "projects" | "new-project" | "runs" | "compare" | "gallery" | "datasets" | "account";

// Project-scoped nav (only shown once a project is open); the "Projects" home is always present.
const NAV: { id: View; label: string; icon: string }[] = [
  { id: "runs", label: "Runs", icon: "activity" },
  { id: "compare", label: "Compare", icon: "columns" },
  { id: "gallery", label: "Gallery", icon: "grid" },
  { id: "datasets", label: "Datasets", icon: "database" },
];

function Logo({ onClick }: { onClick?: () => void }) {
  return (
    <button onClick={onClick} title="Home" disabled={!onClick}
      style={{ display: "flex", alignItems: "center", gap: 10, border: 0, background: "transparent", padding: 0,
        cursor: onClick ? "pointer" : "default", fontFamily: "var(--font-body)" }}>
      <BrandMark size={28} />
      <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 17, letterSpacing: "-0.03em", color: "var(--ink-strong)" }}>Resonance</span>
    </button>
  );
}

function ProjectSwitcher({ project, projects, onPick }: { project: Project; projects: Project[]; onPick: (slug: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen((o) => !o)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", border: "1px solid var(--line)", background: "var(--panel-2)", borderRadius: "var(--r-md)", padding: "8px 10px", cursor: "pointer", color: "var(--ink)" }}>
        <span style={{ width: 28, height: 28, borderRadius: "var(--r-md)", background: "var(--accent-soft)", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon name="music" size={15} />
        </span>
        <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink-strong)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{project.name}</div>
          <div style={{ fontSize: 11, color: "var(--faint)", fontFamily: "var(--mono)" }}>{project.slug}</div>
        </div>
        <Icon name="chevron-down" size={15} style={{ color: "var(--faint)" }} />
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, minWidth: 220, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow)", padding: 6, zIndex: 50 }}>
          {projects.map((p) => (
            <button key={p.id} onMouseDown={() => { onPick(p.slug); setOpen(false); }}
              style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", border: 0, background: p.id === project.id ? "var(--panel-3)" : "transparent", borderRadius: "var(--r-md)", padding: "9px 10px", cursor: "pointer", color: "var(--ink)", textAlign: "left" }}>
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
        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", border: "1px solid var(--line)", background: "var(--panel-2)", borderRadius: "var(--r-md)", padding: "8px 10px", cursor: "pointer", color: "var(--ink)" }}>
        <Icon name="layers" size={15} style={{ color: "var(--muted)" }} />
        <span style={{ flex: 1, textAlign: "left", fontSize: 13, fontWeight: 600, color: "var(--ink-strong)", whiteSpace: "nowrap" }}>{cur ? cur.name : "No team"}</span>
        <Icon name="chevron-down" size={14} style={{ color: "var(--faint)" }} />
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, minWidth: 220, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow)", padding: 6, zIndex: 60 }}>
          <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--faint)", padding: "6px 10px" }}>Switch team</div>
          {me.teams.map((t) => (
            <button key={t.org_id} onMouseDown={() => switchTo(t.org_id)}
              style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", border: 0, background: t.org_id === me.current_org ? "var(--panel-3)" : "transparent", borderRadius: "var(--r-md)", padding: "9px 10px", cursor: "pointer", color: "var(--ink)", textAlign: "left" }}>
              <Icon name="layers" size={15} style={{ color: "var(--muted)" }} />
              <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{t.name}</span>
              <span style={{ fontSize: 10.5, color: "var(--faint)", fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{t.role}</span>
              {t.org_id === me.current_org && <Icon name="check" size={14} style={{ color: "var(--accent)" }} />}
            </button>
          ))}
          {me.teams.length === 0 && <div style={{ padding: "6px 10px", fontSize: 12.5, color: "var(--faint)" }}>No teams yet.</div>}
          <div style={{ height: 1, background: "var(--line-soft)", margin: "6px 4px" }} />
          <button onMouseDown={onManage} style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", border: 0, background: "transparent", borderRadius: "var(--r-md)", padding: "9px 10px", cursor: "pointer", color: "var(--muted)", textAlign: "left", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
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
        style={{ width: 34, height: 34, borderRadius: "var(--r-md)", border: "1px solid var(--line)", background: "var(--panel-2)", color: "var(--ink-strong)", cursor: "pointer", fontWeight: 500, fontSize: 12, fontFamily: "var(--mono)" }}>
        {fmt.initials(me.username)}
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, minWidth: 200, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow)", padding: 6, zIndex: 60 }}>
          <div style={{ padding: "8px 10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink-strong)" }}>{me.username}</span>
              {me.is_admin && <span style={{ fontSize: 10.5, fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--accent)" }}>admin</span>}
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
  display: "flex", alignItems: "center", gap: 9, width: "100%", border: 0, background: "transparent", borderRadius: "var(--r-md)",
  padding: "9px 10px", cursor: "pointer", color: "var(--ink)", textAlign: "left", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap",
};

function ProjectsGrid({ projects, onOpen, onNew }: { projects: Project[]; onOpen: (slug: string) => void; onNew: () => void }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 22, gap: 16 }}>
        <div>
          <PageTitle eyebrow="Workspace">Projects</PageTitle>
          <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "var(--muted)" }}>{projects.length} project{projects.length === 1 ? "" : "s"} in this team</p>
        </div>
        <Btn kind="primary" icon="plus" onClick={onNew}>New project</Btn>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(248px, 1fr))", gap: 16 }}>
        {projects.map((p) => (
          <button key={p.id} onClick={() => onOpen(p.slug)} className="rsn-card"
            style={{ textAlign: "left", width: "100%", border: "1px solid var(--line)", background: "var(--panel)", borderRadius: "var(--r-lg)", padding: 20,
              cursor: "pointer", display: "flex", flexDirection: "column", gap: 14, minHeight: 150, color: "var(--ink)" }}>
            <span style={{ width: 38, height: 38, borderRadius: "var(--r-md)", background: "var(--accent-soft)", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Icon name="music" size={19} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 17, letterSpacing: "-0.02em", color: "var(--ink-strong)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
              <div style={{ fontSize: 12, color: "var(--faint)", fontFamily: "var(--mono)", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.slug}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "auto", paddingTop: 12, borderTop: "1px solid var(--line-soft)", fontSize: 12, color: "var(--muted)", fontFamily: "var(--mono)" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name="clock" size={13} />{fmt.ago(p.created_at)}</span>
              <Icon name="chevron-right" size={16} style={{ color: "var(--faint)" }} />
            </div>
          </button>
        ))}
        <button onClick={onNew} className="rsn-card"
          style={{ textAlign: "left", border: "1px dashed var(--line)", background: "transparent", borderRadius: "var(--r-lg)", padding: 20,
            cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 14, minHeight: 150, color: "var(--muted)" }}>
          <span style={{ width: 38, height: 38, borderRadius: "var(--r-md)", background: "var(--panel-3)", color: "var(--ink)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon name="plus" size={19} />
          </span>
          <div style={{ marginTop: "auto" }}>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 16, letterSpacing: "-0.02em", color: "var(--ink-strong)" }}>New project</div>
            <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 3 }}>Create an empty project</div>
          </div>
        </button>
      </div>
    </div>
  );
}

function NewProject({ onCreate, onCancel }: { onCreate: (slug: string, name: string) => Promise<void>; onCancel?: () => void }) {
  const [name, setName] = useState("");
  const [focus, setFocus] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const submit = () => {
    if (!slug || busy) return;
    setBusy(true); setErr(null);
    onCreate(slug, name.trim())
      .catch((e) => setErr(e instanceof ApiError ? e.message : "could not create project"))
      .finally(() => setBusy(false));
  };
  return (
    <div style={{ display: "flex", justifyContent: "center", paddingTop: 64 }}>
      <div style={{ width: "100%", maxWidth: 440, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "var(--r-lg)", padding: 28, boxShadow: "var(--shadow)" }}>
        {onCancel && (
          <button onClick={onCancel} className="res-link"
            style={{ display: "inline-flex", alignItems: "center", gap: 5, border: 0, background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: 12.5, padding: 0, marginBottom: 16, fontFamily: "var(--font-body)" }}>
            <Icon name="chevron-left" size={15} />Back to projects
          </button>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
          <span style={{ width: 38, height: 38, borderRadius: "var(--r-md)", background: "var(--accent-soft)", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon name="music" size={19} />
          </span>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 18, letterSpacing: "-0.02em", color: "var(--ink-strong)" }}>New project</div>
        </div>
        <p style={{ fontSize: 13.5, color: "var(--muted)", margin: "0 0 18px", lineHeight: 1.5 }}>
          {onCancel
            ? "Add a project to this team. You can also create one by logging a run with the SDK pointed at this team."
            : "No projects in this team yet. Create one here, or log a run with the SDK pointed at this team — either creates the project."}
        </p>
        <input
          value={name} placeholder="Project name" autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
          style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${focus ? "var(--accent)" : "var(--line)"}`, background: "var(--panel-2)",
            boxShadow: focus ? "0 0 0 3px var(--accent-soft)" : "none",
            borderRadius: "var(--r-md)", padding: "11px 13px", fontSize: 14, fontFamily: "var(--font-body)", color: "var(--ink)", outline: "none" }} />
        <div style={{ fontSize: 12, color: "var(--faint)", margin: "8px 2px 16px", minHeight: 16 }}>
          {slug ? <>slug: <span style={{ fontFamily: "var(--mono)", color: "var(--muted)" }}>{slug}</span></> : "used in run logging and URLs"}
        </div>
        {err && <div style={{ fontSize: 12.5, color: "var(--bad)", marginBottom: 12 }}>{err}</div>}
        <Btn kind="primary" icon="plus" disabled={!slug || busy} onClick={submit} style={{ width: "100%", justifyContent: "center" }}>
          {busy ? "Creating…" : "Create project"}
        </Btn>
      </div>
    </div>
  );
}

function Shell({ me, reload, t }: { me: Me; reload: () => void; t: Tweaks }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectSlug, setProjectSlug] = useState<string | null>(null);
  const [view, setView] = useState<View>(me.current_org ? "projects" : "account");
  const [runId, setRunId] = useState<string | null>(null);
  const [compareSeed, setCompareSeed] = useState<string[]>([]);
  const [runsView, setRunsView] = useState<"table" | "cards">(t.runsView);
  const [delProject, setDelProject] = useState<Project | null>(null);
  const [delBusy, setDelBusy] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);
  useEffect(() => { setRunsView(t.runsView); }, [t.runsView]);

  // Only owners/admins of the active team (or platform admins) can delete projects.
  const activeRole = me.teams.find((tm) => tm.org_id === me.current_org)?.role;
  const canManage = me.is_admin || activeRole === "owner" || activeRole === "admin";

  const loadProjects = useCallback(() => {
    if (!me.current_org) {
      setProjects([]);
      return;
    }
    api.projects().then((ps) => {
      setProjects(ps);
      // No auto-select: the default landing is the projects grid, not a single project's runs.
      // Keep the current selection only if it still exists.
      setProjectSlug((cur) => (cur && ps.some((p) => p.slug === cur) ? cur : null));
    }).catch(() => setProjects([]));
  }, [me.current_org]);
  useEffect(() => { loadProjects(); }, [loadProjects]);

  const project = projects.find((p) => p.slug === projectSlug) ?? null;

  const go = (v: View) => { setView(v); if (v !== "runs") setRunId(null); };
  const openRun = (id: string) => { setRunId(id); setView("runs"); window.scrollTo(0, 0); };
  const pickProject = (slug: string) => { setProjectSlug(slug); setRunId(null); setView("runs"); };
  const addCompare = (id?: string) => { setCompareSeed(id ? [id] : []); setView("compare"); setRunId(null); };
  const openAccount = () => { setView("account"); setRunId(null); };
  // Optimistically show the freshly created project and drop straight into it.
  const onProjectCreated = (p: Project) => {
    setProjects((cur) => (cur.some((x) => x.slug === p.slug) ? cur : [p, ...cur]));
    setProjectSlug(p.slug);
    setRunId(null);
    setView("runs");
  };
  const confirmDeleteProject = () => {
    if (!delProject) return;
    const slug = delProject.slug;
    setDelBusy(true); setDelErr(null);
    api.deleteProject(slug)
      .then(() => {
        // Stay on whatever surface triggered the delete (e.g. the Account page).
        setProjects((cur) => cur.filter((p) => p.slug !== slug));
        setProjectSlug((cur) => (cur === slug ? null : cur));
        setRunId(null);
        setDelProject(null);
      })
      .catch((e) => setDelErr(e instanceof ApiError ? e.message : "could not delete project"))
      .finally(() => setDelBusy(false));
  };

  // "Projects" home is always available; the per-project surfaces appear only inside a project.
  const navList: { id: View; label: string; icon: string }[] = [
    { id: "projects", label: "Projects", icon: "layers" },
    ...(project ? NAV : []),
  ];
  const navItems = navList.map((n) => {
    const active = view === n.id;
    const sidebar = t.layout === "sidebar";
    return (
      <button key={n.id} onClick={() => go(n.id)} className={active ? undefined : "rsn-nav"}
        style={{ display: "flex", alignItems: "center", gap: 11, width: sidebar ? "100%" : "auto", border: 0,
          background: active ? "var(--accent-soft)" : "transparent", borderRadius: "var(--r-md)", padding: sidebar ? "9px 12px" : "8px 12px",
          boxShadow: active ? (sidebar ? "inset 2px 0 0 var(--accent)" : "inset 0 -2px 0 var(--accent)") : "none",
          cursor: "pointer", color: active ? "var(--ink-strong)" : "var(--muted)", fontWeight: 500, fontSize: 13.5, fontFamily: "var(--font-body)" }}>
        <Icon name={n.icon} size={16} style={{ color: active ? "var(--accent)" : undefined }} />{n.label}
      </button>
    );
  });
  const navLabel = (label: string) => (
    <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--faint)", padding: "0 12px", marginBottom: 2 }}>{label}</div>
  );

  const main = view === "account"
    ? <AccountPage me={me} reload={reload} projects={projects}
        canManageProjects={canManage}
        onDeleteProject={canManage ? (p) => { setDelErr(null); setDelProject(p); } : undefined} />
    : !me.current_org
      ? <Empty msg="You're not on a team yet — create or join one from Account & teams." />
      : (view === "new-project" || projects.length === 0)
        // Explicit "New project" action, or the zero-state when the team has no projects yet.
        ? <NewProject
            onCreate={(slug, name) => api.createProject(slug, name).then(onProjectCreated)}
            onCancel={projects.length ? () => go("projects") : undefined} />
        : (view === "projects" || !project)
          // Default landing: cards for every project the user can access.
          ? <ProjectsGrid projects={projects} onOpen={pickProject} onNew={() => setView("new-project")} />
          : (
          <>
            {view === "runs" && !runId && <RunsView project={project} runsView={{ value: runsView, set: setRunsView }} onOpenRun={openRun} onCompare={() => addCompare()} colormap={t.colormap} />}
            {view === "runs" && runId && <RunDetail runId={runId} project={project} onBack={() => setRunId(null)} onCompare={addCompare} chartStyle={t.chartStyle} colormap={t.colormap} />}
            {view === "compare" && <ComparePage project={project} seedRunIds={compareSeed} colormap={t.colormap} chartStyle={t.chartStyle} />}
            {view === "gallery" && <GalleryPage project={project} colormap={t.colormap} />}
            {view === "datasets" && <DatasetsPage />}
          </>
        );

  const projectDeleteDialog = delProject && (
    <ConfirmDialog
      title={`Delete ${delProject.name}?`}
      confirmLabel="Delete project"
      busy={delBusy}
      error={delErr}
      onCancel={() => { if (!delBusy) setDelProject(null); }}
      onConfirm={confirmDeleteProject}
      message={<>This <b style={{ color: "var(--ink)" }}>permanently deletes</b> <b style={{ color: "var(--ink)" }}>{delProject.name}</b> and all of its runs, logged audio and dataset versions. This cannot be undone.</>}
    />
  );

  if (t.layout === "sidebar") {
    return (
      <div className="rsn-grid" style={{ display: "flex", minHeight: "100vh" }}>
        {projectDeleteDialog}
        <aside style={{ width: 248, flexShrink: 0, borderRight: "1px solid var(--line)", background: "var(--panel)", display: "flex", flexDirection: "column", padding: "18px 14px", gap: 18, position: "sticky", top: 0, height: "100vh", boxSizing: "border-box" }}>
          <div style={{ padding: "0 4px" }}><Logo onClick={() => go("projects")} /></div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {navLabel("Team")}
            <TeamSwitcher me={me} reload={reload} onManage={openAccount} />
            {project && <ProjectSwitcher project={project} projects={projects} onPick={pickProject} />}
          </div>
          <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {navLabel(project ? "Project" : "Workspace")}
            {navItems}
          </nav>
          <div style={{ flex: 1 }} />
          <button onClick={openAccount} className={view === "account" ? undefined : "rsn-nav"} style={{ display: "flex", alignItems: "center", gap: 10, border: "1px solid var(--line-soft)", background: view === "account" ? "var(--accent-soft)" : "var(--panel-2)", borderRadius: "var(--r-md)", padding: "9px 10px", cursor: "pointer", color: "var(--ink)", textAlign: "left" }}>
            <span style={{ width: 30, height: 30, borderRadius: "var(--r-md)", background: "var(--panel-3)", border: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 500, fontSize: 11.5, fontFamily: "var(--mono)", color: "var(--ink-strong)" }}>{fmt.initials(me.username)}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-strong)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{me.username}</div>
              <div style={{ fontSize: 11, color: "var(--faint)" }}>Account &amp; teams</div>
            </div>
          </button>
        </aside>
        <main style={{ flex: 1, minWidth: 0, padding: "32px 36px 80px", maxWidth: 1360 }}>{main}</main>
      </div>
    );
  }

  return (
    <div className="rsn-grid" style={{ minHeight: "100vh" }}>
      {projectDeleteDialog}
      <header style={{ position: "sticky", top: 0, zIndex: 40, borderBottom: "1px solid var(--line)", background: "color-mix(in srgb, var(--panel) 82%, transparent)", backdropFilter: "blur(14px)", padding: "0 24px", height: 60, display: "flex", alignItems: "center", gap: 18 }}>
        <Logo onClick={() => go("projects")} />
        <div style={{ width: 1, height: 24, background: "var(--line)" }} />
        <div><TeamSwitcher me={me} reload={reload} onManage={openAccount} /></div>
        {project && <div style={{ width: 200 }}><ProjectSwitcher project={project} projects={projects} onPick={pickProject} /></div>}
        <nav style={{ display: "flex", gap: 2 }}>{navItems}</nav>
        <div style={{ flex: 1 }} />
        <UserMenu me={me} reload={reload} onAccount={openAccount} />
      </header>
      <main style={{ padding: "32px 36px 80px", maxWidth: 1360, margin: "0 auto" }}>{main}</main>
    </div>
  );
}

function Workspace({ me, reload }: { me: Me; reload: () => void }) {
  const [t, setTweak] = useTweaks();
  return (
    <div style={{ ...themeVars(t), background: "var(--bg)", color: "var(--ink)", minHeight: "100vh", fontFamily: "var(--font-body)", fontSize: "var(--fs)", letterSpacing: "-0.01em" }}>
      <Shell key={me.current_org ?? "none"} me={me} reload={reload} t={t} />
      <TweaksPanel t={t} setTweak={setTweak} />
    </div>
  );
}

export function App() {
  return <AuthGate>{(me, reload) => <Workspace me={me} reload={reload} />}</AuthGate>;
}
