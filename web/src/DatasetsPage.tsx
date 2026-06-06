// Datasets: content-addressed dataset versions for the active team's projects. Pick a version to
// browse its members; each item plays at original quality (lazily presigned). Identical content
// across runs is stored once (deduped).
import { useEffect, useState } from "react";
import { api, type Dataset, type DatasetDetail } from "./api";
import { fmt } from "./design/theme";
import { Icon } from "./design/icons";
import { Badge, Empty, Tag } from "./design/ui";
import { playBtnStyle, useAudioPlayer } from "./design/audioviz";

export function DatasetsPage() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [detail, setDetail] = useState<DatasetDetail | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    api.datasets().then((ds) => {
      setDatasets(ds);
      setOpenId((cur) => cur ?? ds[0]?.id ?? null);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!openId) {
      setDetail(null);
      return;
    }
    let alive = true;
    api.dataset(openId).then((d) => alive && setDetail(d)).catch(() => alive && setDetail(null));
    return () => {
      alive = false;
    };
  }, [openId]);

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 34, fontWeight: 500, letterSpacing: "-0.03em", margin: 0, color: "var(--ink-strong)" }}>Datasets</h1>
        <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: 14 }}>Content-addressed dataset versions. Identical content across runs is stored once.</p>
      </div>

      {datasets.length === 0 && <Empty msg="No datasets yet. Log one with run.log_dataset(...)." />}

      {datasets.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "320px minmax(0,1fr)", gap: 22, alignItems: "start" }} className="res-detail-grid">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {datasets.map((d) => (
              <button key={d.id} onClick={() => setOpenId(d.id)}
                style={{ textAlign: "left", border: `1px solid ${openId === d.id ? "var(--accent)" : "var(--line)"}`, background: "var(--panel)", borderRadius: 12, padding: 14, cursor: "pointer" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <Icon name="database" size={16} style={{ color: "var(--accent)" }} />
                  <span style={{ fontWeight: 600, color: "var(--ink-strong)", fontSize: 14 }}>{d.name}</span>
                  <Tag>@{d.version}</Tag>
                </div>
                <div style={{ display: "flex", gap: 14, marginTop: 10, fontSize: 12, color: "var(--muted)" }}>
                  <span>{fmt.compact(d.item_count)} items</span>
                  <span>{fmt.ago(d.created_at)}</span>
                </div>
              </button>
            ))}
          </div>

          {detail && (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <h2 style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 500, letterSpacing: "-0.02em", margin: 0, color: "var(--ink-strong)" }}>{detail.name}</h2>
                <Tag>@{detail.version}</Tag>
                <Badge tone="ok"><Icon name="check" size={11} />deduped</Badge>
                <span style={{ fontSize: 12.5, color: "var(--faint)" }}>{fmt.int(detail.item_count)} items</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 10 }}>
                {detail.items.map((it) => (
                  <DatasetItemCard key={it.sha256} sha={it.sha256} path={it.path} size={it.size_bytes} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DatasetItemCard({ sha, path, size }: { sha: string; path: string; size?: number }) {
  const [url, setUrl] = useState<string | undefined>(undefined);
  const { playing, toggle } = useAudioPlayer(url);
  useEffect(() => {
    let alive = true;
    api.streamUrl(sha).then((u) => alive && setUrl(u)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [sha]);
  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={toggle} disabled={!url} style={{ ...playBtnStyle(32), opacity: url ? 1 : 0.5 }}>
          <Icon name={playing ? "pause" : "play"} size={14} fill={playing ? "none" : "current"} stroke={playing ? 2.4 : 0} />
        </button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{path}</div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--faint)", marginTop: 2 }}>
            sha {sha.slice(0, 10)}… {size != null ? `· ${(size / 1e6).toFixed(1)} MB` : ""}
          </div>
        </div>
      </div>
    </div>
  );
}
