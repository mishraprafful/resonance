// Dataset browser: list content-addressed dataset versions, open one to see its members, and play
// each item (original quality, lazily presigned). Datasets are deduped by content — the same member
// set across many runs is one version.
import { useEffect, useState } from "react";
import { api, type Dataset, type DatasetDetail, type Project } from "./api";

export function DatasetsPage({ projects }: { projects: Project[] }) {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [detail, setDetail] = useState<DatasetDetail | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => { api.datasets().then(setDatasets).catch(() => {}); }, []);

  const open = async (id: string) => {
    const d = await api.dataset(id);
    setDetail(d);
    setUrls({});
    // presign the first handful eagerly; the rest play on demand below
    for (const it of d.items.slice(0, 20)) {
      api.streamUrl(it.sha256).then((u) => setUrls((m) => ({ ...m, [it.sha256]: u })));
    }
  };

  const projName = (pid: string | null) => projects.find((p) => p.id === pid)?.name ?? "—";

  return (
    <section>
      <h2>Datasets</h2>
      <div style={{ display: "flex", gap: 24 }}>
        <div style={{ minWidth: 280 }}>
          {datasets.length === 0 && <p style={{ color: "#888" }}>No datasets yet. Log one with <code>run.log_dataset(...)</code>.</p>}
          <ul style={{ listStyle: "none", padding: 0 }}>
            {datasets.map((d) => (
              <li key={d.id} style={{ marginBottom: 6 }}>
                <button onClick={() => open(d.id)}>
                  {d.name} <code style={{ fontSize: 11 }}>@{d.version}</code>
                </button>
                <span style={{ fontSize: 11, color: "#888" }}> · {d.item_count} items · {projName(d.project_id)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div style={{ flex: 1 }}>
          {detail && (
            <>
              <h3>{detail.name} <code style={{ fontSize: 12 }}>@{detail.version}</code> · {detail.item_count} items</h3>
              <ul style={{ listStyle: "none", padding: 0 }}>
                {detail.items.map((it) => (
                  <li key={it.sha256} style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 12, color: "#555" }}>{it.path}</div>
                    {urls[it.sha256] ? (
                      <audio controls src={urls[it.sha256]} style={{ width: 420 }} />
                    ) : (
                      <button onClick={() => api.streamUrl(it.sha256).then((u) => setUrls((m) => ({ ...m, [it.sha256]: u })))}>
                        load audio
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
