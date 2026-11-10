"""Resonance — audio-first ML experiment tracking SDK.

Typical use::

    import resonance

    run = resonance.init(project="vocoder", config={"lr": 3e-4})
    run.log({"loss/mel": 0.21}, step=step)
    run.log_audio("samples/val", wav, sample_rate=22050, step=step)
    run.finish()
"""

from __future__ import annotations

from .config import Settings
from .run import Run

__all__ = ["init", "Run", "Settings"]

_active_run: Run | None = None


def init(
    project: str,
    *,
    config: dict | None = None,
    name: str | None = None,
    settings: Settings | None = None,
) -> Run:
    """Start (and register as active) a new tracking run."""
    global _active_run
    _active_run = Run.start(project=project, config=config or {}, name=name, settings=settings)
    return _active_run
