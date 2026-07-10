"""Compatibility Google OAuth helper for Hermes versions without agent.google_oauth.

Newer Hermes builds may no longer ship ``agent.google_oauth`` while
the Antigravity provider still imports it.  This module provides the small
subset used by ``agent.google_antigravity_oauth``.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import requests

from hermes_constants import get_hermes_home

ENV_CLIENT_ID = "GOOGLE_CLIENT_ID"
ENV_CLIENT_SECRET = "GOOGLE_CLIENT_SECRET"
_DEFAULT_CLIENT_ID = ""
_DEFAULT_CLIENT_SECRET = ""
OAUTH_SCOPES = "openid email profile"
AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/auth"
TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
DEFAULT_REDIRECT_PORT = 51121
REDIRECT_HOST = "localhost"
CALLBACK_PATH = "/auth/callback"


class GoogleOAuthError(RuntimeError):
    def __init__(self, message: str, *, code: str = "google_oauth_error") -> None:
        super().__init__(message)
        self.code = code


@dataclass
class RefreshParts:
    refresh_token: str

    @classmethod
    def parse(cls, value: str) -> "RefreshParts":
        return cls(refresh_token=str(value or "").strip())


@dataclass
class GoogleCredentials:
    access_token: str = ""
    refresh_token: str = ""
    expires_ms: int = 0
    email: str = ""
    project_id: str = ""
    managed_project_id: str = ""

    def access_token_expired(self, *, skew_seconds: int = 60) -> bool:
        if not self.access_token:
            return True
        if self.expires_ms <= 0:
            return True
        return self.expires_ms <= int((time.time() + skew_seconds) * 1000)


def _credentials_path() -> Path:
    return get_hermes_home() / "auth" / "google_oauth.json"


def _lock_path() -> Path:
    return _credentials_path().with_suffix(".json.lock")


def _credentials_from_mapping(data: dict[str, Any]) -> GoogleCredentials | None:
    access = str(data.get("access_token") or data.get("accessToken") or "")
    refresh = str(data.get("refresh_token") or data.get("refreshToken") or "")
    if not access and not refresh:
        return None
    expires_ms = int(data.get("expires_ms") or data.get("expires_at_ms") or 0)
    expires_in = data.get("expires_in")
    if not expires_ms and expires_in:
        try:
            expires_ms = int((time.time() + int(expires_in)) * 1000)
        except (TypeError, ValueError):
            expires_ms = 0
    return GoogleCredentials(
        access_token=access,
        refresh_token=refresh,
        expires_ms=expires_ms,
        email=str(data.get("email") or ""),
        project_id=str(data.get("project_id") or ""),
        managed_project_id=str(data.get("managed_project_id") or ""),
    )


def load_credentials() -> GoogleCredentials | None:
    try:
        data = json.loads(_credentials_path().read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    return _credentials_from_mapping(data)


def save_credentials(creds: GoogleCredentials) -> None:
    path = _credentials_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "access_token": creds.access_token,
        "refresh_token": creds.refresh_token,
        "expires_ms": creds.expires_ms,
        "email": creds.email,
        "project_id": creds.project_id,
        "managed_project_id": creds.managed_project_id,
    }
    tmp = path.with_suffix(f".tmp.{os.getpid()}")
    tmp.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def clear_credentials() -> None:
    try:
        _credentials_path().unlink()
    except FileNotFoundError:
        pass


def update_project_ids(project_id: str = "", managed_project_id: str = "") -> None:
    creds = load_credentials()
    if creds is None:
        return
    if project_id:
        creds.project_id = project_id
    if managed_project_id:
        creds.managed_project_id = managed_project_id
    save_credentials(creds)


def resolve_project_id_from_env() -> str:
    for var in (
        "GOOGLE_CLOUD_PROJECT",
        "GOOGLE_CLOUD_PROJECT_ID",
        "HERMES_GOOGLE_CLOUD_PROJECT",
        "HERMES_GOOGLE_PROJECT_ID",
    ):
        value = os.getenv(var, "").strip()
        if value:
            return value
    return ""


def _require_client_id() -> str:
    client_id = os.getenv(ENV_CLIENT_ID, "").strip() or _DEFAULT_CLIENT_ID
    if not client_id:
        raise GoogleOAuthError("Google OAuth client id is missing.", code="google_oauth_missing_client_id")
    return client_id


def _require_client_secret() -> str:
    client_secret = os.getenv(ENV_CLIENT_SECRET, "").strip() or _DEFAULT_CLIENT_SECRET
    if not client_secret:
        raise GoogleOAuthError(
            "Google OAuth client secret is missing.",
            code="google_oauth_missing_client_secret",
        )
    return client_secret


def _generate_pkce_pair() -> tuple[str, str]:
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode("ascii").rstrip("=")
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")
    return verifier, challenge


def exchange_code(
    code: str,
    verifier: str,
    redirect_uri: str,
    *,
    client_id: str | None = None,
    client_secret: str | None = None,
) -> dict[str, Any]:
    data = {
        "code": code,
        "client_id": client_id or _require_client_id(),
        "client_secret": client_secret or _require_client_secret(),
        "code_verifier": verifier,
        "grant_type": "authorization_code",
        "redirect_uri": redirect_uri,
    }
    resp = requests.post(TOKEN_ENDPOINT, data=data, timeout=30)
    if resp.status_code >= 400:
        raise GoogleOAuthError(
            f"Google OAuth token endpoint returned HTTP {resp.status_code}: {resp.text}",
            code="google_oauth_token_exchange_failed",
        )
    return resp.json()


def _persist_token_response(token_resp: dict[str, Any], *, project_id: str = "") -> GoogleCredentials:
    expires_in = int(token_resp.get("expires_in") or 3600)
    creds = GoogleCredentials(
        access_token=str(token_resp.get("access_token") or ""),
        refresh_token=str(token_resp.get("refresh_token") or ""),
        expires_ms=int((time.time() + expires_in) * 1000),
        email=str(token_resp.get("email") or ""),
        project_id=project_id,
    )
    if not creds.refresh_token:
        existing = load_credentials()
        if existing and existing.refresh_token:
            creds.refresh_token = existing.refresh_token
    save_credentials(creds)
    return creds


def _refresh_access_token(creds: GoogleCredentials) -> GoogleCredentials:
    if not creds.refresh_token:
        raise GoogleOAuthError("No Google OAuth refresh token found.", code="google_oauth_missing_refresh_token")
    data = {
        "client_id": _require_client_id(),
        "client_secret": _require_client_secret(),
        "grant_type": "refresh_token",
        "refresh_token": creds.refresh_token,
    }
    resp = requests.post(TOKEN_ENDPOINT, data=data, timeout=30)
    if resp.status_code >= 400:
        raise GoogleOAuthError(
            f"Google OAuth refresh endpoint returned HTTP {resp.status_code}: {resp.text}",
            code="google_oauth_refresh_failed",
        )
    payload = resp.json()
    expires_in = int(payload.get("expires_in") or 3600)
    refreshed = GoogleCredentials(
        access_token=str(payload.get("access_token") or ""),
        refresh_token=str(payload.get("refresh_token") or creds.refresh_token),
        expires_ms=int((time.time() + expires_in) * 1000),
        email=creds.email,
        project_id=creds.project_id,
        managed_project_id=creds.managed_project_id,
    )
    save_credentials(refreshed)
    return refreshed


def get_valid_access_token(*, force_refresh: bool = False) -> str:
    creds = load_credentials()
    if creds is None:
        raise GoogleOAuthError("No Google OAuth credentials found.", code="google_oauth_not_logged_in")
    if force_refresh or creds.access_token_expired():
        creds = _refresh_access_token(creds)
    return creds.access_token
