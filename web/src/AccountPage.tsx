// Account & Teams: your teams (switch / active), create a team, request to join others, and — for
// team owners/admins — approve/deny pending join requests. Wired to the real /v1/teams + auth APIs.
import { useEffect, useState } from "react";
import { api, ApiError, type Me, type Project } from "./api";
import { fmt } from "./design/theme";
import { Icon } from "./design/icons";
import { Badge, Btn, ConfirmDialog, Empty, PageTitle, SectionLabel } from "./design/ui";

interface PendingReq { orgId: string; team: string; id: string; username: string }

function Field({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [focus, setFocus] = useState(false);
  return (
    <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
      style={{ width: "100%", boxSizing: "border-box", border: `1.5px solid ${focus ? "var(--accent)" : "var(--line)"}`, background: "var(--panel)",
        borderRadius: "var(--r-md)", padding: "11px 13px", fontSize: 14, fontFamily: "var(--font-body)", color: "var(--ink)", outline: "none" }} />
  );
}

export function AccountPage({ me, reload, projects = [], canManageProjects = false, onDeleteProject }: {
  me: Me; reload: () => void; projects?: Project[]; canManageProjects?: boolean; onDeleteProject?: (p: Project) => void;
}) {
  const activeTeam = me.teams.find((t) => t.org_id === me.current_org);
  const [allTeams, setAllTeams] = useState<{ id: string; slug: string; name: string }[]>([]);
  const [pending, setPending] = useState<PendingReq[]>([]);
  const [newTeam, setNewTeam] = useState("");
  const [delTeam, setDelTeam] = useState<{ orgId: string; name: string } | null>(null);
  const [delBusy, setDelBusy] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);
  const myOrgIds = new Set(me.teams.map((t) => t.org_id));
  // Every team the user owns/admins is surfaced — not just the first one.
  const adminTeams = me.teams.filter((t) => t.role === "owner" || t.role === "admin");
  const pendingSlugs = new Set(me.pending_requests.map((r) => r.slug));

  useEffect(() => { api.listTeams().then(setAllTeams).catch(() => {}); }, [me]);

  // Aggregate pending join requests across all teams the user administers.
  const refreshRequests = () => {
    Promise.all(
      me.teams
        .filter((t) => t.role === "owner" || t.role === "admin")
        .map((t) =>
          api.listRequests(t.org_id)
            .then((rs) => rs.filter((r) => r.status === "pending")
              .map((r): PendingReq => ({ orgId: t.org_id, team: t.name, id: r.id, username: r.username })))
            .catch(() => [] as PendingReq[]))
    ).then((lists) => setPending(lists.flat()));
  };
  useEffect(refreshRequests, [me]);

  const decide = (orgId: string, reqId: string, action: "approve" | "deny") => {
    api.decideRequest(orgId, reqId, action).then(refreshRequests).catch(() => {});
  };

  const confirmDeleteTeam = () => {
    if (!delTeam) return;
    setDelBusy(true); setDelErr(null);
    api.deleteTeam(delTeam.orgId)
      .then(() => { setDelTeam(null); reload(); })
      .catch((e) => setDelErr(e instanceof ApiError ? e.message : "could not delete team"))
      .finally(() => setDelBusy(false));
  };

  return (
    <div style={{ maxWidth: 760 }}>
      <PageTitle eyebrow="Settings">Account</PageTitle>

      {/* identity */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 18, marginBottom: 26, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "var(--r-lg)", padding: 16 }}>
        <span style={{ width: 46, height: 46, borderRadius: "var(--r-lg)", background: "var(--accent)", color: "var(--accent-ink)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 17, fontFamily: "var(--font-display)" }}>{fmt.initials(me.username)}</span>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16, fontWeight: 600, color: "var(--ink-strong)" }}>{me.username}</span>
            {me.is_admin && <Badge tone="accent">platform admin</Badge>}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>{me.teams.length} team{me.teams.length !== 1 ? "s" : ""} · active scope governs everything you see</div>
        </div>
        <Btn kind="outline" icon="arrow-up-right" onClick={() => api.logout().then(reload)}>Log out</Btn>
      </div>

      {/* your teams */}
      <SectionLabel>Your teams</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
        {me.teams.length === 0 && <Empty msg="No team yet — create one or request to join below." />}
        {me.teams.map((t) => {
          const active = me.current_org === t.org_id;
          return (
            <div key={t.org_id} style={{ display: "flex", alignItems: "center", gap: 14, background: "var(--panel)", border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`, borderRadius: "var(--r-lg)", padding: 14 }}>
              <span style={{ width: 38, height: 38, borderRadius: "var(--r-lg)", background: "var(--panel-3)", color: "var(--ink)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="layers" size={18} /></span>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 600, color: "var(--ink-strong)", fontSize: 14.5, whiteSpace: "nowrap" }}>{t.name}</span>
                  <Badge tone={t.role === "owner" ? "accent" : "neutral"}>{t.role}</Badge>
                </div>
                <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 2 }}>{t.slug}</div>
              </div>
              {active ? <Badge tone="ok"><Icon name="check" size={11} />active</Badge> : <Btn kind="soft" onClick={() => api.switchTeam(t.org_id).then(reload)}>Switch</Btn>}
              {(t.role === "owner" || t.role === "admin" || me.is_admin) && (
                <Btn kind="ghost" size="sm" icon="x" title="Delete team"
                  onClick={() => { setDelErr(null); setDelTeam({ orgId: t.org_id, name: t.name }); }}
                  style={{ color: "var(--bad)" }}>Delete</Btn>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28 }} className="res-detail-grid">
        {/* create team */}
        <div>
          <SectionLabel>Create a team</SectionLabel>
          <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "var(--r-lg)", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            <Field value={newTeam} onChange={setNewTeam} placeholder="team name" />
            <Btn kind="primary" icon="plus" onClick={() => { if (newTeam.trim()) api.createTeam(newTeam.trim(), newTeam.trim()).then(() => { setNewTeam(""); reload(); }); }} style={{ justifyContent: "center" }}>Create team</Btn>
          </div>
        </div>

        {/* request to join */}
        <div>
          <SectionLabel>Request to join</SectionLabel>
          <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "var(--r-lg)", padding: 8, display: "flex", flexDirection: "column" }}>
            {allTeams.filter((t) => !myOrgIds.has(t.id)).map((t, i, arr) => {
              const isPending = pendingSlugs.has(t.slug);
              return (
                <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 8px", borderBottom: i < arr.length - 1 ? "1px solid var(--line-soft)" : "none" }}>
                  <span style={{ width: 30, height: 30, borderRadius: "var(--r-md)", background: "var(--panel-3)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)" }}><Icon name="layers" size={15} /></span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>{t.name}</div>
                    <div style={{ fontSize: 11, color: "var(--faint)" }}>{t.slug}</div>
                  </div>
                  {isPending ? <Badge tone="warn">requested</Badge> : <Btn kind="outline" size="sm" onClick={() => api.requestJoin(t.id).then(reload)}>Request</Btn>}
                </div>
              );
            })}
            {allTeams.filter((t) => !myOrgIds.has(t.id)).length === 0 && <div style={{ padding: 16, textAlign: "center", color: "var(--faint)", fontSize: 13 }}>You're on every team.</div>}
          </div>
        </div>
      </div>

      {/* manage projects (active team) — delete lives here, not on the project cards */}
      {canManageProjects && onDeleteProject && activeTeam && (
        <div style={{ marginTop: 28 }}>
          <SectionLabel right={<span style={{ fontSize: 12, color: "var(--faint)" }}>{activeTeam.name}</span>}>Manage projects</SectionLabel>
          <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "var(--r-lg)", padding: projects.length ? 8 : 0 }}>
            {projects.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "var(--faint)", fontSize: 13 }}>No projects in this team.</div>}
            {projects.map((p, i) => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 8px", borderBottom: i < projects.length - 1 ? "1px solid var(--line-soft)" : "none" }}>
                <span style={{ width: 32, height: 32, borderRadius: "var(--r-md)", background: "var(--panel-3)", color: "var(--ink)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon name="music" size={15} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: "var(--faint)", fontFamily: "var(--mono)" }}>{p.slug}</div>
                </div>
                <Btn kind="ghost" size="sm" icon="x" onClick={() => onDeleteProject(p)} style={{ color: "var(--bad)" }}>Delete</Btn>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* admin: join requests — aggregated across every team you administer */}
      {adminTeams.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <SectionLabel right={<span style={{ fontSize: 12, color: "var(--faint)" }}>across {adminTeams.length} team{adminTeams.length !== 1 ? "s" : ""} you manage</span>}>Pending join requests</SectionLabel>
          <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "var(--r-lg)", padding: pending.length ? 8 : 0 }}>
            {pending.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "var(--faint)", fontSize: 13 }}>No pending requests.</div>}
            {pending.map((r, i) => (
              <div key={`${r.orgId}:${r.id}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 8px", borderBottom: i < pending.length - 1 ? "1px solid var(--line-soft)" : "none" }}>
                <span style={{ width: 32, height: 32, borderRadius: "var(--r-md)", background: "var(--panel-3)", color: "var(--ink)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12, fontFamily: "var(--font-display)" }}>{fmt.initials(r.username)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>{r.username}</div>
                  <div style={{ fontSize: 11, color: "var(--faint)" }}>wants to join {r.team}</div>
                </div>
                <Btn kind="primary" size="sm" icon="check" onClick={() => decide(r.orgId, r.id, "approve")}>Approve</Btn>
                <Btn kind="soft" size="sm" onClick={() => decide(r.orgId, r.id, "deny")}>Deny</Btn>
              </div>
            ))}
          </div>
        </div>
      )}

      {delTeam && (
        <ConfirmDialog
          title={`Delete ${delTeam.name}?`}
          confirmLabel="Delete team"
          confirmWord={delTeam.name}
          busy={delBusy}
          error={delErr}
          onCancel={() => { if (!delBusy) setDelTeam(null); }}
          onConfirm={confirmDeleteTeam}
          message={<>This <b style={{ color: "var(--ink)" }}>permanently deletes</b> the team and <b style={{ color: "var(--ink)" }}>everything in it</b> — all projects, runs, logged audio, datasets, API tokens and memberships. This cannot be undone.</>}
        />
      )}
    </div>
  );
}
