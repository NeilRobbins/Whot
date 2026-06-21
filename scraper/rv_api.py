#!/usr/bin/env python3
"""
ResultsVault / InteractSport JSON API client.

The ResultsVault `go.aspx` gateway redirects to a Play-Cricket `live_app`
scorecard page whose detail is rendered client-side by InteractSport's
"match-centre" JS app. That app does NOT read the HTML -- it calls a JSON API:

    GET https://api.resultsvault.co.uk/rv/<entityid>/matches/<matchid>/
        ?apiid=1003&strmflg=3[&format=json]
    GET (same URL) ?apiid=1003&action=getballs&sportid=1   # ball-by-ball

The API is gated by a lightweight anti-bot *request signature* (NOT user auth,
no credentials, no personal data): a header

    X-IAS-API-REQUEST: base64( 3DES-ECB( <unix-ts-string>, key ) )

where the key is the public ``apiSharedSecret`` shipped in the app bundle and
the server only checks the timestamp is recent (~30 min window). We replicate
exactly what the official web app does to read public match data.

This yields the full, structured scorecard (batting / bowling / fielding player
performances, innings totals and extras) and optional ball-by-ball -- including
formats (e.g. youth "pairs"/net-score cricket) that the HTML pages don't render
at all.
"""
from __future__ import annotations

import base64
import time
import logging

import requests

try:
    from Crypto.Cipher import DES3
    from Crypto.Util.Padding import pad
    _HAVE_CRYPTO = True
except Exception:  # pragma: no cover - dependency missing
    _HAVE_CRYPTO = False

log = logging.getLogger("rv.api")

# Public constants extracted from the match-centre bundle
# (embed.interactsport.com/match-centre/1.3.0). apiSharedSecret is 24 ASCII
# bytes -> triple-DES (EDE, K1|K2|K3). apiid identifies the embed client.
API_BASE = "https://api.resultsvault.co.uk/rv"
API_ID = 1003
SHARED_SECRET = b"5BD4A72CE1934BA5A629CD98"


def make_signature(now: float | None = None) -> str:
    """Replicate the app's ``ce()``: base64(3DES-ECB(timestamp, secret)).

    The app uses ``round(now_seconds) - 60`` as the plaintext, PKCS7 padded.
    """
    if not _HAVE_CRYPTO:
        raise RuntimeError(
            "pycryptodome is required for the JSON API "
            "(pip install pycryptodome)")
    ts = str(int(round(now if now is not None else time.time())) - 60)
    cipher = DES3.new(SHARED_SECRET, DES3.MODE_ECB)
    enc = cipher.encrypt(pad(ts.encode("ascii"), 8))
    return base64.b64encode(enc).decode("ascii")


def _headers(extra: dict | None = None) -> dict:
    h = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"),
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-IAS-API-REQUEST": make_signature(),
        "Origin": "https://play-cricket.com",
        "Referer": "https://play-cricket.com/",
    }
    if extra:
        h.update(extra)
    return h


def _get(url: str, params: dict, session: requests.Session,
         timeout: int = 30, retries: int = 4):
    backoff = 2
    last = None
    for attempt in range(1, retries + 1):
        try:
            r = session.get(url, params=params, headers=_headers(),
                            timeout=timeout)
            log.info("API GET (%d/%d) %s -> %s %s (%d b)", attempt, retries,
                     r.url, r.status_code,
                     r.headers.get("Content-Type", ""), len(r.content))
            r.raise_for_status()
            return r.json()
        except (requests.RequestException, ValueError) as exc:
            last = exc
            log.warning("  API request failed: %s", exc)
            if attempt < retries:
                time.sleep(backoff)
                backoff *= 2
    raise RuntimeError(f"API GET failed for {url}: {last}")


def fetch_match(entityid, matchid, session: requests.Session) -> dict:
    """Full match document (teams, innings, player performances, extras)."""
    url = f"{API_BASE}/{entityid}/matches/{matchid}/"
    return _get(url, {"apiid": API_ID, "strmflg": 3, "format": "json"}, session)


def fetch_balls(entityid, matchid, session: requests.Session) -> list:
    """Ball-by-ball list for the match (may be empty if not ball-scored)."""
    url = f"{API_BASE}/{entityid}/matches/{matchid}/"
    data = _get(url, {"apiid": API_ID, "action": "getballs",
                      "sportid": 1, "strmflg": 3}, session)
    return data if isinstance(data, list) else []
