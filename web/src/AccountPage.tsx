// Account & teams: see your teams, switch the active team, create a team, request to join others,
// and (for team owners/admins) approve/deny pending join requests.
import { useEffect, useState } from "react";
import { api, type Me } from "./api";

export function AccountPage({ me, reload }: { me: Me; reload: () => void }) {
  const [allTeams, setAllTeams] = useState<{ id: string; slug: string; name: string }[]>([]);
  const [requests, setRequests] = useState<{ id: string; username: string; status: string }[]>([]);
  const [newTeam, setNewTeam] = useState("");
  const myOrgIds = new Set(me.teams.map((t) => t.org_id));
  const adminTeam = me.teams.find((t) => t.role === "owner" || t.role === "admin");

  useEffect(() => { api.listTeams().then(setAllTeams).catch(() => {}); }, [me]);
  useEffect(() => {
    if (adminTeam) api.listRequests(adminTeam.org_id).then(setRequests).catch(() => setRequests([]));
  }, [adminTeam?.org_id]);

  return (
    <section style={{ maxWidth: 560 }}>
      <h2>Account</h2>
      <p>
        Signed in as <strong>{me.username}</strong>{me.is_admin ? " (platform admin)" : ""}.{" "}
        <button onClick={() => api.logout().then(reload)}>Log out</button>
      </p>

      <h3>Your teams</h3>
      {me.teams.length === 0 && <p style={{ color: "#888" }}>No team yet — create one or request to join below.</p>}
      <ul style={{ listStyle: "none", padding: 0 }}>
        {me.teams.map((t) => (
          <li key={t.org_id} style={{ marginBottom: 4 }}>
            <strong>{t.name}</strong> <span style={{ fontSize: 12, color: "#888" }}>· {t.role}</span>{" "}
            {me.current_org === t.org_id
              ? <span style={{ fontSize: 12, color: "#4f46e5" }}>● active</span>
              : <button onClick={() => api.switchTeam(t.org_id).then(reload)}>switch</button>}
          </li>
        ))}
      </ul>

      <h3>Create a team</h3>
      <input placeholder="team name" value={newTeam} onChange={(e) => setNewTeam(e.target.value)} />
      <button onClick={() => newTeam && api.createTeam(newTeam, newTeam).then(() => { setNewTeam(""); reload(); })}>create</button>

      <h3>Request to join</h3>
      {me.pending_requests.length > 0 && (
        <p style={{ fontSize: 12, color: "#888" }}>Pending: {me.pending_requests.map((r) => r.slug).join(", ")}</p>
      )}
      <ul style={{ listStyle: "none", padding: 0 }}>
        {allTeams.filter((t) => !myOrgIds.has(t.id)).map((t) => (
          <li key={t.id} style={{ marginBottom: 4 }}>
            {t.name}{" "}
            <button onClick={() => api.requestJoin(t.id).then(reload)}>request to join</button>
          </li>
        ))}
      </ul>

      {adminTeam && (
        <>
          <h3>Join requests for {adminTeam.name}</h3>
          {requests.length === 0 && <p style={{ color: "#888" }}>No pending requests.</p>}
          <ul style={{ listStyle: "none", padding: 0 }}>
            {requests.map((r) => (
              <li key={r.id} style={{ marginBottom: 4 }}>
                {r.username}{" "}
                <button onClick={() => api.decideRequest(adminTeam.org_id, r.id, "approve").then(() => api.listRequests(adminTeam.org_id).then(setRequests))}>approve</button>{" "}
                <button onClick={() => api.decideRequest(adminTeam.org_id, r.id, "deny").then(() => api.listRequests(adminTeam.org_id).then(setRequests))}>deny</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
