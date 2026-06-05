// Account & Teams: your teams (switch / active), create a team, request to join others, and — for
// team owners/admins — approve/deny pending join requests. Wired to the real /v1/teams + auth APIs.
import { useEffect, useState } from "react";
import { api, type Me } from "./api";
import { fmt } from "./design/theme";
import { Icon } from "./design/icons";
import { Badge, Btn, Empty, SectionLabel } from "./design/ui";

function Field({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [focus, setFocus] = useState(false);
  return (
    <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
      style={{ width: "100%", boxSizing: "border-box", border: `1.5px solid ${focus ? "var(--accent)" : "var(--line)"}`, background: "var(--panel)",
        borderRadius: 8, padding: "11px 13px", fontSize: 14, fontFamily: "var(--font-body)", color: "var(--ink)", outline: "none" }} />
  );
}

export function AccountPage({ me, reload }: { me: Me; reload: () => void }) {
  const [allTeams, setAllTeams] = useState<{ id: string; slug: string; name: string }[]>([]);
  const [requests, setRequests] = useState<{ id: string; username: string; status: string }[]>([]);
  const [newTeam, setNewTeam] = useState("");
  const myOrgIds = new Set(me.teams.map((t) => t.org_id));
  const adminTeam = me.teams.find((t) => t.role === "owner" || t.role === "admin");
  const pendingSlugs = new Set(me.pending_requests.map((r) => r.slug));

  useEffect(() => { api.listTeams().then(setAllTeams).catch(() => {}); }, [me]);
  useEffect(() => {
    if (adminTeam) api.listRequests(adminTeam.org_id).then(setRequests).catch(() => setRequests([]));
    else setRequests([]);
  }, [adminTeam?.org_id]);

  const refreshRequests = () => {
    if (adminTeam) api.listRequests(adminTeam.org_id).then(setRequests).catch(() => {});
  };
  const decide = (reqId: string, action: "approve" | "deny") => {
    if (adminTeam) api.decideRequest(adminTeam.org_id, reqId, action).then(refreshRequests).catch(() => {});
  };

  const pending = requests.filter((r) => r.status === "pending");

  return (
    <div style={{ maxWidth: 760 }}>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: 34, fontWeight: 500, letterSpacing: "-0.03em", margin: 0, color: "var(--ink-strong)" }}>Account</h1>

      {/* identity */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 18, marginBottom: 26, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: 16 }}>
        <span style={{ width: 46, height: 46, borderRadius: 12, background: "var(--accent)", color: "var(--accent-ink)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 17, fontFamily: "var(--font-display)" }}>{fmt.initials(me.username)}</span>
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
            <div key={t.org_id} style={{ display: "flex", alignItems: "center", gap: 14, background: "var(--panel)", border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`, borderRadius: 12, padding: 14 }}>
              <span style={{ width: 38, height: 38, borderRadius: 10, background: "var(--panel-3)", color: "var(--ink)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="layers" size={18} /></span>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 600, color: "var(--ink-strong)", fontSize: 14.5, whiteSpace: "nowrap" }}>{t.name}</span>
                  <Badge tone={t.role === "owner" ? "accent" : "neutral"}>{t.role}</Badge>
                </div>
                <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 2 }}>{t.slug}</div>
              </div>
              {active ? <Badge tone="ok"><Icon name="check" size={11} />active</Badge> : <Btn kind="soft" onClick={() => api.switchTeam(t.org_id).then(reload)}>Switch</Btn>}
            </div>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28 }} className="res-detail-grid">
        {/* create team */}
        <div>
          <SectionLabel>Create a team</SectionLabel>
          <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            <Field value={newTeam} onChange={setNewTeam} placeholder="team name" />
            <Btn kind="primary" icon="plus" onClick={() => { if (newTeam.trim()) api.createTeam(newTeam.trim(), newTeam.trim()).then(() => { setNewTeam(""); reload(); }); }} style={{ justifyContent: "center" }}>Create team</Btn>
          </div>
        </div>

        {/* request to join */}
        <div>
          <SectionLabel>Request to join</SectionLabel>
          <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: 8, display: "flex", flexDirection: "column" }}>
            {allTeams.filter((t) => !myOrgIds.has(t.id)).map((t, i, arr) => {
              const isPending = pendingSlugs.has(t.slug);
              return (
                <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 8px", borderBottom: i < arr.length - 1 ? "1px solid var(--line-soft)" : "none" }}>
                  <span style={{ width: 30, height: 30, borderRadius: 8, background: "var(--panel-3)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)" }}><Icon name="layers" size={15} /></span>
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

      {/* admin: join requests */}
      {adminTeam && (
        <div style={{ marginTop: 28 }}>
          <SectionLabel right={<span style={{ fontSize: 12, color: "var(--faint)" }}>{adminTeam.name} · you are {adminTeam.role}</span>}>Pending join requests</SectionLabel>
          <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: pending.length ? 8 : 0 }}>
            {pending.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "var(--faint)", fontSize: 13 }}>No pending requests.</div>}
            {pending.map((r, i) => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 8px", borderBottom: i < pending.length - 1 ? "1px solid var(--line-soft)" : "none" }}>
                <span style={{ width: 32, height: 32, borderRadius: 8, background: "var(--panel-3)", color: "var(--ink)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12, fontFamily: "var(--font-display)" }}>{fmt.initials(r.username)}</span>
                <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>{r.username}</span>
                <Btn kind="primary" size="sm" icon="check" onClick={() => decide(r.id, "approve")}>Approve</Btn>
                <Btn kind="soft" size="sm" onClick={() => decide(r.id, "deny")}>Deny</Btn>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
