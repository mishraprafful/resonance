// Resonance web UI — Phase 0 shell. Run view, audio panel, A/B compare and dataset views
// land in Phases 1-3.
export function App() {
  return (
    <main style={{ fontFamily: "system-ui", padding: "2rem", maxWidth: 720 }}>
      <h1>Resonance</h1>
      <p>Audio-first ML experiment tracking. UI scaffold — Phase 0.</p>
      <ul>
        <li>Run view with live metric charts — Phase 1</li>
        <li>Audio panel: per-step samples, waveform, spectrogram — Phase 2</li>
        <li>A/B synced compare + dataset browser — Phase 3</li>
      </ul>
    </main>
  );
}
