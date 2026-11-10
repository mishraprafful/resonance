import json

import numpy as np

from resonance_workers import audio


def test_derived_key_is_content_addressed():
    sha = "a" * 64
    assert audio.derived_key("org1", sha, "peaks.json") == f"org1/derived/{sha}/peaks.json"


def test_compute_peaks_is_bounded_and_well_formed():
    x = np.sin(np.linspace(0, 100, 50_000)).astype(np.float32)
    peaks = json.loads(audio.compute_peaks(x, buckets=200))["buckets"]
    assert len(peaks) == 200
    for lo, hi in peaks:
        assert -1.0 <= lo <= hi <= 1.0


def test_peak_dbfs_full_scale_is_zero():
    x = np.array([1.0, -1.0, 0.5], dtype=np.float32)
    assert abs(audio.peak_dbfs(x)) < 1e-6  # full-scale -> 0 dBFS


def test_to_mono_collapses_stereo():
    stereo = np.stack([np.ones(100), -np.ones(100)], axis=1).astype(np.float32)  # (frames, 2)
    mono = audio.to_mono(stereo)
    assert mono.ndim == 1 and len(mono) == 100
    assert np.allclose(mono, 0.0)


def test_spectrogram_png_returns_png_bytes():
    x = np.sin(np.linspace(0, 200, 8000)).astype(np.float32)
    png = audio.spectrogram_png(x, sr=8000)
    assert png[:8] == b"\x89PNG\r\n\x1a\n"  # PNG magic
