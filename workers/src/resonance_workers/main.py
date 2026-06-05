"""Resonance audio derivation workers.

Consume asset-created events from the stream queue and produce, idempotently, cached back into
object storage (keyed by source hash + recipe):
  - a web-streamable rendition (Opus/AAC)
  - waveform peaks (decimated min/max -> peaks.json) so the UI draws waveforms without the audio
  - a mel-spectrogram image
  - loudness/quality probes (LUFS, peak dBFS, duration, sr, channels)

Phase 0: the recipe functions exist as pure stubs so they're unit-testable and the consumer loop
has a shape; queue wiring lands in Phase 2.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Derivations:
    peaks_key: str
    spectrogram_key: str
    rendition_key: str


def recipe_key(source_sha: str, recipe: str) -> str:
    """Deterministic, content-addressed key for a derivation of a source asset."""
    return f"derived/{source_sha}/{recipe}"


def derive(source_sha: str) -> Derivations:
    """Compute the derivation keys for an asset (compute itself wired in Phase 2)."""
    return Derivations(
        peaks_key=recipe_key(source_sha, "peaks.json"),
        spectrogram_key=recipe_key(source_sha, "melspec.png"),
        rendition_key=recipe_key(source_sha, "stream.opus"),
    )


def main() -> None:  # pragma: no cover - process entrypoint
    print("resonance-workers: queue consumer not wired until Phase 2")


if __name__ == "__main__":  # pragma: no cover
    main()
