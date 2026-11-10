"""Minimal `resonance` CLI entrypoint (expanded in later phases: login, runs ls, ...)."""

from __future__ import annotations

import sys


def main(argv: list[str] | None = None) -> int:
    argv = argv if argv is not None else sys.argv[1:]
    if not argv or argv[0] in ("-h", "--help"):
        print("resonance <command>\n\n  version    show SDK version\n")
        return 0
    if argv[0] == "version":
        from resonance import __doc__  # noqa: F401

        import importlib.metadata as md

        print(md.version("resonance"))
        return 0
    print(f"unknown command: {argv[0]}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
