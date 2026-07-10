#!/usr/bin/env python3
"""Run the vendored Hermes model picker against AI Workspace state."""

from __future__ import annotations

import sys


def main() -> None:
    # Keep the upstream command implementation intact. The Node launcher sets
    # HERMES_HOME to AI Workspace's private runtime configuration directory.
    from hermes_cli.main import main as hermes_main

    sys.argv = ["aiw", "model", *sys.argv[1:]]
    hermes_main()


if __name__ == "__main__":
    main()
