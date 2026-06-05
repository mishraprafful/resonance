"""Pure audio-derivation functions (no I/O), so they're unit-testable without S3/Postgres.

Produces the artifacts the UI needs without ever shipping raw audio to the browser:
  * waveform peaks  — decimated min/max pairs the client draws directly
  * spectrogram     — a log-magnitude STFT rendered to a PNG
  * probes          — duration, peak dBFS
"""

from __future__ import annotations

import io
import json
import math

import numpy as np


def to_mono(samples: np.ndarray) -> np.ndarray:
    """Collapse (frames, channels) or (channels, frames) to mono float32 in [-1, 1]."""
    x = np.asarray(samples, dtype=np.float32)
    if x.ndim == 2:
        # soundfile returns (frames, channels)
        x = x.mean(axis=1) if x.shape[0] >= x.shape[1] else x.mean(axis=0)
    return x


def compute_peaks(samples: np.ndarray, buckets: int = 1000) -> bytes:
    """Decimated min/max peaks as JSON: {"buckets": [[min,max], ...]}.

    Bounded payload regardless of clip length, so the waveform draws instantly.
    """
    x = to_mono(samples)
    n = len(x)
    buckets = max(1, min(buckets, n)) if n else 1
    out: list[list[float]] = []
    if n:
        edges = np.linspace(0, n, buckets + 1, dtype=int)
        for i in range(buckets):
            seg = x[edges[i] : edges[i + 1]]
            if len(seg) == 0:
                out.append([0.0, 0.0])
            else:
                out.append([float(seg.min()), float(seg.max())])
    return json.dumps({"buckets": out}).encode()


def peak_dbfs(samples: np.ndarray) -> float:
    x = to_mono(samples)
    peak = float(np.abs(x).max()) if len(x) else 0.0
    return 20.0 * math.log10(peak) if peak > 0 else -120.0


def spectrogram_png(
    samples: np.ndarray, sr: int, n_fft: int = 1024, hop: int = 256, max_frames: int = 800
) -> bytes:
    """Log-magnitude STFT spectrogram rendered to a PNG (numpy STFT, no heavy deps)."""
    from PIL import Image

    x = to_mono(samples)
    if len(x) < n_fft:
        x = np.pad(x, (0, n_fft - len(x)))
    window = np.hanning(n_fft).astype(np.float32)
    starts = range(0, len(x) - n_fft + 1, hop)
    cols = [np.abs(np.fft.rfft(x[s : s + n_fft] * window)) for s in starts]
    spec = np.array(cols).T if cols else np.zeros((n_fft // 2 + 1, 1))
    spec = 20.0 * np.log10(spec + 1e-6)          # dB
    spec = np.clip((spec - spec.min()) / (np.ptp(spec) + 1e-9), 0, 1)
    spec = np.flipud(spec)                        # low freq at bottom
    if spec.shape[1] > max_frames:                # downsample time axis
        idx = np.linspace(0, spec.shape[1] - 1, max_frames).astype(int)
        spec = spec[:, idx]
    img = Image.fromarray((spec * 255).astype(np.uint8), mode="L")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def derived_key(org_id: str, sha256: str, recipe: str) -> str:
    return f"{org_id}/derived/{sha256}/{recipe}"
