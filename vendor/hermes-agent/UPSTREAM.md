# Vendored Hermes Agent Runtime

This directory contains the Python runtime source used by AI Workspace's model,
provider, and authentication setup flow.

- Upstream: `NousResearch/hermes-agent`
- Imported version: `0.18.0`
- Imported on: `2026-07-10`
- License: MIT (see `LICENSE`)

Only runtime Python sources and provider manifests are included. Virtual
environments, caches, tests, web builds, Git history, and generated assets are
excluded.

AI Workspace executes this source directly through `aiw model`; it does not
shell out to the separately installed `hermes` command. `HERMES_HOME` is scoped
to `<workspace>/.ai-workspace/config`, so upstream-compatible model and
credential files belong to AI Workspace.

When refreshing the vendor snapshot, preserve local integration files
(`aiw_model.py` and this document), copy the upstream MIT license, and run the
AI Workspace test suite plus an interactive model-picker smoke test.
