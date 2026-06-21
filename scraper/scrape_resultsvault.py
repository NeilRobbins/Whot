#!/usr/bin/env python3
"""
ResultsVault cricket scorecard scraper.

The ResultsVault ``go.aspx`` gateway is a thin redirector: it maps a
``matchid`` to a Play-Cricket "live app" scorecard and issues an HTTP 302 to

    https://play-cricket.com/live_app/scorecard?id=<internal_id>

That page is *rendered HTML* (no usable JSON/XML variant is exposed without an
ECB API token -- see README.md for the probe results). This script therefore
parses the HTML, keying off cell/row *labels* and stable CSS hooks rather than
fixed column indices, so it survives layout shuffles.

Usage:
    python scrape_resultsvault.py                # uses URLS below / urls.txt
    python scrape_resultsvault.py URL [URL ...]  # explicit URLs
    python scrape_resultsvault.py --urls urls.txt

Outputs:
    ./raw/<sha>.html        cached raw responses (idempotent re-runs)
    ./out/<matchid>.json    one file per match
    ./out/matches.json      combined array
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import re
import sys
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from urllib.parse import urlparse, parse_qs

import requests
from selectolax.parser import HTMLParser

import rv_api

# --------------------------------------------------------------------------- #
# Config
# --------------------------------------------------------------------------- #
HERE = os.path.dirname(os.path.abspath(__file__))
RAW_DIR = os.path.join(HERE, "raw")
OUT_DIR = os.path.join(HERE, "out")

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-GB,en;q=0.9",
}
TIMEOUT = 30
MAX_RETRIES = 4
POLITE_DELAY = 1.5  # seconds between *network* requests

# Default seed list (one URL per line, '#' comments allowed).
DEFAULT_URLS = """
https://api.resultsvault.co.uk/go.aspx?matchid=7443828&ofl=0&id=MATCH&entityid=108595
# add more URLs here, one per line
"""

log = logging.getLogger("rv")


# --------------------------------------------------------------------------- #
# Schema (dataclasses -> dict via asdict)
# --------------------------------------------------------------------------- #
@dataclass
class Extras:
    byes: int = 0
    leg_byes: int = 0
    wides: int = 0
    no_balls: int = 0
    total: int = 0


@dataclass
class Bat:
    name: str = ""
    how_out: str = ""
    bowler: str = ""
    fielder: str = ""
    runs: int | None = None
    balls: int | None = None
    fours: int | None = None
    sixes: int | None = None
    sr: float | None = None


@dataclass
class Fow:
    wicket_no: int | None = None
    score: int | None = None
    batsman_out: str = ""


@dataclass
class Bowl:
    name: str = ""
    overs: float | None = None
    maidens: int | None = None
    runs: int | None = None
    wickets: int | None = None
    wides: int | None = None
    no_balls: int | None = None
    econ: float | None = None


@dataclass
class Ball:
    over: int | None = None
    ball: int | None = None
    innings_number: int | None = None
    batter: str = ""
    bowler: str = ""
    runs: int | None = None
    extras: int | None = None
    extras_type: str = ""
    dismissed: str = ""
    desc: str = ""
    # Raw ids kept as a fallback: youth feeds sometimes use match-local
    # placeholder ids in PlayerPerfs that don't resolve to ball-feed ids.
    batter_id: int | None = None
    bowler_id: int | None = None


@dataclass
class Innings:
    team: str = ""
    total_runs: int | None = None
    wickets: int | None = None
    overs: float | None = None
    extras: Extras = field(default_factory=Extras)
    batting: list = field(default_factory=list)
    fall_of_wickets: list = field(default_factory=list)
    bowling: list = field(default_factory=list)
    # True for pairs/net-score (youth) formats where 'total_runs' is a net
    # score and batters retire rather than being dismissed -- the standard
    # sum(batting)+extras==total reconciliation does not apply.
    net_score_format: bool = False
    balls: list = field(default_factory=list)


@dataclass
class Teams:
    home: str = ""
    away: str = ""


@dataclass
class Match:
    match_id: str = ""
    competition_grade: str = ""
    date: str = ""
    ground: str = ""
    status: str = ""
    result: str = ""
    toss: str = ""
    teams: Teams = field(default_factory=Teams)


@dataclass
class Document:
    match: Match
    innings: list
    meta: dict


# --------------------------------------------------------------------------- #
# Small helpers
# --------------------------------------------------------------------------- #
def txt(node) -> str:
    """Whitespace-normalised text of a selectolax node (or '')."""
    if node is None:
        return ""
    return re.sub(r"\s+", " ", node.text(deep=True, separator=" ")).strip()


def _num(s, cast=int):
    if s is None:
        return None
    s = str(s).strip().replace(",", "")
    if s == "" or s == "-":
        return None
    m = re.search(r"-?\d+(?:\.\d+)?", s)
    if not m:
        return None
    try:
        return cast(m.group(0))
    except ValueError:
        return None


def matchid_from_url(url: str) -> str:
    qs = parse_qs(urlparse(url).query)
    for key in ("matchid", "match_id", "id"):
        if key in qs and qs[key]:
            return qs[key][0]
    return hashlib.sha1(url.encode()).hexdigest()[:10]


def api_ids_from_url(url: str):
    """Return (entityid, matchid) for ResultsVault gateway URLs, else (None, None).

    The JSON API needs both the ResultsVault ``matchid`` and the ``entityid``
    site context, which the gateway URL carries directly -- so we can hit the
    structured feed without even following the redirect.
    """
    qs = parse_qs(urlparse(url).query)
    entity = (qs.get("entityid") or qs.get("entity_id") or [None])[0]
    matchid = (qs.get("matchid") or qs.get("match_id") or [None])[0]
    if entity and matchid:
        return entity, matchid
    return None, None


def _parse_rv_date(s):
    """'/Date(1782030600000+0100)/' -> ISO 8601 string, or the raw input."""
    if not s:
        return ""
    m = re.search(r"/Date\((\d+)([+-]\d{4})?\)/", s)
    if not m:
        return str(s)
    ms = int(m.group(1))
    off = m.group(2) or "+0000"
    sign = 1 if off[0] == "+" else -1
    offmin = sign * (int(off[1:3]) * 60 + int(off[3:5]))
    tz = timezone(__import__("datetime").timedelta(minutes=offmin))
    return datetime.fromtimestamp(ms / 1000, tz).isoformat()


# --------------------------------------------------------------------------- #
# Fetching (cache + retries + polite delay)
# --------------------------------------------------------------------------- #
def _cache_path(url: str) -> str:
    h = hashlib.sha1(url.encode()).hexdigest()[:16]
    return os.path.join(RAW_DIR, f"{h}.html")


def fetch_api_json(entityid, matchid, session, force=False, with_balls=False):
    """Fetch (and cache) the ResultsVault JSON match doc + optional balls."""
    mpath = os.path.join(RAW_DIR, f"api_{matchid}.json")
    bpath = os.path.join(RAW_DIR, f"api_{matchid}_balls.json")
    if not force and os.path.exists(mpath) and os.path.getsize(mpath) > 0:
        log.info("api cache hit  match %s", matchid)
        with open(mpath, encoding="utf-8") as fh:
            data = json.load(fh)
    else:
        data = rv_api.fetch_match(entityid, matchid, session)
        with open(mpath, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False)
        time.sleep(POLITE_DELAY)
    balls = []
    if with_balls:
        if not force and os.path.exists(bpath) and os.path.getsize(bpath) > 0:
            with open(bpath, encoding="utf-8") as fh:
                balls = json.load(fh)
        else:
            balls = rv_api.fetch_balls(entityid, matchid, session)
            with open(bpath, "w", encoding="utf-8") as fh:
                json.dump(balls, fh, ensure_ascii=False)
            time.sleep(POLITE_DELAY)
    return data, balls


def fetch(url: str, session: requests.Session, force: bool = False) -> str:
    """Return HTML for ``url``, following the gateway redirect. Cached on disk."""
    cache = _cache_path(url)
    if not force and os.path.exists(cache) and os.path.getsize(cache) > 0:
        log.info("cache hit  %s", url)
        with open(cache, encoding="utf-8") as fh:
            return fh.read()

    backoff = 2
    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            log.info("GET (%d/%d) %s", attempt, MAX_RETRIES, url)
            resp = session.get(
                url, headers=HEADERS, timeout=TIMEOUT, allow_redirects=True
            )
            ctype = resp.headers.get("Content-Type", "")
            log.info("  -> %s %s (%d bytes) final=%s",
                     resp.status_code, ctype, len(resp.content), resp.url)
            resp.raise_for_status()
            html = resp.text
            with open(cache, "w", encoding="utf-8") as fh:
                fh.write(html)
            # Save a labelled copy too, for human inspection.
            mid = matchid_from_url(url)
            with open(os.path.join(RAW_DIR, f"match_{mid}.html"), "w",
                      encoding="utf-8") as fh:
                fh.write(html)
            time.sleep(POLITE_DELAY)
            return html
        except requests.RequestException as exc:
            last_err = exc
            log.warning("  request failed: %s", exc)
            if attempt < MAX_RETRIES:
                time.sleep(backoff)
                backoff *= 2
    raise RuntimeError(f"failed to fetch {url}: {last_err}")


# --------------------------------------------------------------------------- #
# Parsing -- label/CSS-hook keyed, never positional on the page as a whole
# --------------------------------------------------------------------------- #
def _header_index(table) -> dict:
    """Map normalised header label -> column index for a scorecard table.

    Header cells embed a long label (RUNS/BALLS/...) and a short one (R/B/...);
    we key off the long label so column shuffles don't break extraction.
    """
    head = table.css_first("tr")
    idx = {}
    if not head:
        return idx
    for i, th in enumerate(head.css("th, td")):
        label = txt(th).lower()
        if not label:
            continue
        # NOTE: order matters -- 'NO BALLS' contains 'ball', and 'MAIDENS'/
        # 'WIDES' must be matched before the generic columns. Check the
        # specific bowling columns first.
        if "no ball" in label or label == "nb" or label.endswith(" nb"):
            idx["no_balls"] = i
        elif "maiden" in label:
            idx["maidens"] = i
        elif "wide" in label or label == "wd" or label.endswith(" wd"):
            idx["wides"] = i
        elif "wicket" in label:
            idx["wickets"] = i
        elif "econ" in label:
            idx["econ"] = i
        elif "over" in label:
            idx["overs"] = i
        elif "run" in label:
            idx["runs"] = i
        elif "ball" in label:
            idx["balls"] = i
        elif label in ("4s", "fours"):
            idx["fours"] = i
        elif label in ("6s", "sixes"):
            idx["sixes"] = i
        elif label == "sr" or "strike" in label:
            idx["sr"] = i
    return idx


def _parse_dismissal(cells, problems):
    """Derive (how_out, fielder, bowler) from the two dismissal cells.

    The dismissal columns are the two unlabelled cells between BATTER and RUNS:
      cell[1]: <span class="bhct">c</span><a>fielder</a>     (mode + fielder)
      cell[2]: <span class="batsman-info-1">b</span><a>bowler</a>
    Bowled has an empty cell[1] and a 'b <bowler>' cell[2].
    """
    how_out = fielder = bowler = ""
    c1 = cells[1] if len(cells) > 1 else None
    c2 = cells[2] if len(cells) > 2 else None

    if c2 is not None:
        b_links = c2.css("a")
        if b_links:
            bowler = txt(b_links[-1])

    if c1 is not None:
        mode_span = c1.css_first("span")
        mode = txt(mode_span).lower() if mode_span else ""
        f_links = c1.css("a")
        if f_links:
            fielder = txt(f_links[-1])
        whole = txt(c1).lower()
        if mode == "c" or whole.startswith("c "):
            how_out = "caught"
        elif mode == "st" or whole.startswith("st"):
            how_out = "stumped"
        elif "lbw" in whole:
            how_out = "lbw"
        elif "run out" in whole:
            how_out = "run out"
            if not fielder:
                fielder = re.sub(r"(?i)run out", "", txt(c1)).strip()
        elif "retired" in whole:
            how_out = "retired not out" if "not out" in whole else "retired out"
        elif "not out" in whole:
            how_out = "not out"
        elif "did not bat" in whole:
            how_out = "did not bat"
        elif whole:
            how_out = txt(c1)

    if not how_out and bowler:
        how_out = "bowled"
    return how_out, fielder, bowler


def _parse_batting(table, problems) -> list:
    idx = _header_index(table)
    out = []
    for tr in table.css("tr")[1:]:
        cells = tr.css("td")
        if not cells:
            continue
        namecell = cells[0]
        name_node = namecell.css_first("div.bts a") or namecell.css_first("a")
        if name_node is not None:
            name = txt(name_node)
        else:
            # fall back: text before the dismissal phrase
            name = re.split(
                r"(?i)\b(c |b |lbw|run out|not out|did not bat|retired|st )",
                txt(namecell), 1)[0].strip()
        if not name:
            continue
        how_out, fielder, bowler = _parse_dismissal(cells, problems)
        b = Bat(name=name, how_out=how_out, bowler=bowler, fielder=fielder)
        if "runs" in idx and idx["runs"] < len(cells):
            b.runs = _num(txt(cells[idx["runs"]]))
        if "balls" in idx and idx["balls"] < len(cells):
            b.balls = _num(txt(cells[idx["balls"]]))
        if "fours" in idx and idx["fours"] < len(cells):
            b.fours = _num(txt(cells[idx["fours"]]))
        if "sixes" in idx and idx["sixes"] < len(cells):
            b.sixes = _num(txt(cells[idx["sixes"]]))
        if "sr" in idx and idx["sr"] < len(cells):
            b.sr = _num(txt(cells[idx["sr"]]), float)
        out.append(b)
    return out


def _parse_bowling(table, problems) -> list:
    idx = _header_index(table)
    out = []
    for tr in table.css("tr")[1:]:
        cells = tr.css("td")
        if not cells:
            continue
        name_node = cells[0].css_first("a") or cells[0]
        name = txt(name_node)
        if not name:
            continue
        bw = Bowl(name=name)
        for key, cast in (("overs", float), ("maidens", int), ("runs", int),
                          ("wickets", int), ("wides", int), ("no_balls", int),
                          ("econ", float)):
            if key in idx and idx[key] < len(cells):
                setattr(bw, key, _num(txt(cells[idx[key]]), cast))
        out.append(bw)
    return out


def _parse_extras(footer_table) -> Extras:
    """Parse 'EXTRAS: 33 (14b, 3lb, 14w, 2nb )'. Keyed off the b/lb/w/nb tags."""
    ex = Extras()
    t = txt(footer_table)
    m = re.search(r"EXTRAS:\s*(\d+)", t, re.I)
    if m:
        ex.total = int(m.group(1))
    for val, tag in re.findall(r"(\d+)\s*(lb|nb|wd|w|b)\b", t, re.I):
        tag = tag.lower()
        val = int(val)
        if tag == "b":
            ex.byes = val
        elif tag == "lb":
            ex.leg_byes = val
        elif tag in ("w", "wd"):
            ex.wides = val
        elif tag == "nb":
            ex.no_balls = val
    return ex


def _parse_fow_block(block) -> list:
    """Parse one 'Fall of Wickets' block.

    Markup: ``<strong>12-1</strong>&nbsp; <a ...>Martin Rutherford</a>
    (<a ...>partner</a>-7*); <strong>54-2</strong> ...``
    We can't split on ';' (it also appears inside ``&nbsp;``), so we walk the
    ``<strong>score-wicket</strong>`` markers and read the *first* anchor that
    follows each (the dismissed batsman; the parenthesised anchor is the
    not-out partner).
    """
    body = block.css_first("p.font-3") or block
    html = body.html or ""
    markers = list(re.finditer(r"<strong>\s*(\d+)\s*-\s*(\d+)\s*</strong>", html))
    out = []
    for i, m in enumerate(markers):
        score, wno = int(m.group(1)), int(m.group(2))
        end = markers[i + 1].start() if i + 1 < len(markers) else len(html)
        chunk = html[m.end():end]
        nm = re.search(r"<a\b[^>]*>([^<]+)</a>", chunk)
        batsman = re.sub(r"\s+", " ", nm.group(1)).strip() if nm else ""
        out.append(Fow(wicket_no=wno, score=score, batsman_out=batsman))
    return out


def _team_score(info_node):
    """From a team-info-2 node -> (total, wickets, overs).

    Seen formats: '190 / 6 (35)', '119 / All out (31.1)', '190 (35)'.
    'All out' (or a missing wickets count) maps to 10.
    """
    t = txt(info_node)
    # '<runs> / <wkts|All out> (<overs>)'
    m = re.search(r"(\d+)\s*/\s*(All out|\d+)\s*\(\s*([\d.]+)\s*\)", t, re.I)
    if m:
        wkts = 10 if m.group(2).lower() == "all out" else int(m.group(2))
        return int(m.group(1)), wkts, float(m.group(3))
    # '<runs> (<overs>)' -> all out
    m = re.search(r"(\d+)\s*\(\s*([\d.]+)\s*\)", t)
    if m:
        return int(m.group(1)), 10, float(m.group(2))
    return None, None, None


def parse_match(html: str, url: str, problems: list) -> Document:
    tree = HTMLParser(html)
    mid = matchid_from_url(url)
    match = Match(match_id=mid)
    match.teams = Teams()

    # --- header meta -------------------------------------------------------
    grade = tree.css_first("div.leaguedetail-left")
    if grade:
        match.competition_grade = txt(grade)

    right = tree.css_first("div.leaguedetail-right")
    if right:
        loc = right.css_first("span.location")
        match.ground = txt(loc.css_first("a") or loc) if loc else ""
        # date is the text before the location span
        rtext = txt(right)
        if loc:
            rtext = rtext.split(txt(loc))[0]
        match.date = rtext.replace("|", "").strip(" |@").strip()

    title = tree.css_first("p.match-ttl")
    status = tree.css_first("div.match-status")
    if status:
        match.status = txt(status)
        match.result = txt(status)
    if title and not match.result:
        match.result = txt(title)

    # team names (responsive layout duplicates them -> de-dupe, keep order)
    names = []
    for n in tree.css("p.team-name"):
        v = txt(n)
        if v and v not in names:
            names.append(v)
    if len(names) >= 2:
        match.teams.home, match.teams.away = names[0], names[1]
    elif names:
        match.teams.home = names[0]

    # toss
    for n in tree.css("p.team-info-3"):
        v = txt(n)
        if v:
            match.toss = v
            break

    # innings team -> (total, wkts, overs) from the main header block
    score_map = {}
    # team-info-2 nodes carry "<team-info-1> NNN / W (O)"; pair with team-name
    info2 = tree.css("p.team-info-2")
    seen = []
    for node in info2:
        # find sibling team-name within the same <td>
        parent = node.parent
        tn = parent.css_first("p.team-name") if parent else None
        team = txt(tn) if tn else ""
        tot, wkt, ov = _team_score(node)
        if team and team not in seen and tot is not None:
            score_map[team] = (tot, wkt, ov)
            seen.append(team)

    # --- innings (batting / extras / bowling tables in document order) -----
    innings = []
    bat_tables = tree.css("table.standm")
    bowl_tables = tree.css("table.bowler-detail")
    foot_tables = tree.css("table.table-scorecard-footer")
    fow_blocks = tree.css("div.fall-of-wickets")

    # Each innings: batting table i pairs with footer i and bowling table i
    # (bowling table lists the *opponent* bowlers for that innings).
    used_teams = set()
    for i, bt in enumerate(bat_tables):
        inn = Innings()
        inn.batting = _parse_batting(bt, problems)
        if i < len(foot_tables):
            inn.extras = _parse_extras(foot_tables[i])
        if i < len(bowl_tables):
            inn.bowling = _parse_bowling(bowl_tables[i], problems)
        # Identify the batting side. Batting-table order is *batting* order
        # (team that batted first), which need NOT match the header's team
        # order, so match this innings to a team by reconstructed total
        # (sum(batting) + extras) rather than by index.
        recon = sum(b.runs or 0 for b in inn.batting) + (inn.extras.total or 0)
        chosen = None
        for team in seen:
            if team in used_teams:
                continue
            if score_map[team][0] == recon:
                chosen = team
                break
        if chosen is None:  # fall back to positional order
            for team in seen:
                if team not in used_teams:
                    chosen = team
                    break
        if chosen is not None:
            used_teams.add(chosen)
            inn.team = chosen
            inn.total_runs, inn.wickets, inn.overs = score_map[chosen]
        innings.append(inn)

    # Fall of wickets: a page may carry fewer FoW blocks than innings, and
    # block order need not match batting-table order. Assign each block to the
    # innings whose batsmen best match the dismissed names (label/content
    # keyed, not positional).
    used_inn = set()
    for block in fow_blocks:
        entries = _parse_fow_block(block)
        if not entries:
            continue
        fow_names = {e.batsman_out for e in entries if e.batsman_out}
        best, best_score = None, -1
        for j, inn in enumerate(innings):
            if j in used_inn:
                continue
            bat_names = {b.name for b in inn.batting}
            overlap = len(fow_names & bat_names)
            if overlap > best_score:
                best, best_score = j, overlap
        if best is None:  # no innings left; attach to first unused by order
            continue
        used_inn.add(best)
        innings[best].fall_of_wickets = entries

    meta = {
        "source_url": url,
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
    }
    return Document(match=match, innings=innings, meta=meta)


# --------------------------------------------------------------------------- #
# JSON API -> Document mapping
# --------------------------------------------------------------------------- #
# ResultsVault dismissal codes (dismissal_text) -> normalised how_out.
_DISMISSAL = {
    "no": "not out", "rtno": "retired not out", "rt": "retired out",
    "rto": "retired out", "c": "caught", "ct": "caught", "b": "bowled",
    "lbw": "lbw", "st": "stumped", "ro": "run out", "rout": "run out",
    "hw": "hit wicket", "hb": "handled ball", "obs": "obstructing",
    "to": "timed out", "dnb": "did not bat", "absent": "absent",
}


def _is_batting_perf(p):
    return "balls" in p  # batting perfs carry balls faced


def _is_bowling_perf(p):
    return "overs" in p and "balls" not in p  # bowling perfs carry overs


def map_api_to_document(data: dict, balls: list, url: str, matchid: str,
                        problems: list) -> Document:
    """Map the ResultsVault JSON match document into our schema."""
    match = Match(match_id=str(matchid))
    match.competition_grade = (data.get("grade_name") or "").strip()
    match.date = _parse_rv_date(data.get("date1"))
    match.ground = (data.get("venue_name") or "").strip()
    match.status = (data.get("score_text") or "").strip()
    match.result = match.status
    toss = (data.get("toss_won_by") or "").strip()
    match.toss = f"{toss} won the toss" if toss else ""
    match.teams = Teams(home=(data.get("home_name") or "").strip(),
                        away=(data.get("away_name") or "").strip())

    teams = data.get("MatchTeams") or []

    # Global player id -> name map (both teams) for dismisser/ball resolution.
    # Index by both player_id and external_id since the ball feed and the perf
    # feed don't always agree on which id they use.
    id2name = {}
    for t in teams:
        for inn in (t.get("Innings") or []):
            for p in (inn.get("PlayerPerfs") or []):
                nm = (p.get("player_name") or "").strip()
                if not nm:
                    continue
                for key in (p.get("player_id"), p.get("external_id")):
                    if key is not None:
                        id2name[key] = nm
                        try:
                            id2name[int(key)] = nm
                        except (ValueError, TypeError):
                            pass

    def name_of(pid):
        return id2name.get(pid, "")

    innings = []
    for t in teams:
        team_name = (t.get("team_name") or "").strip()
        for inn in (t.get("Innings") or []):
            o = Innings(team=team_name)
            o.total_runs = inn.get("runs")
            o.wickets = inn.get("wickets")
            ov = inn.get("overs_bowled")
            o.overs = float(ov) if ov is not None else None
            o.extras = Extras(
                byes=inn.get("byes") or 0,
                leg_byes=inn.get("leg_byes") or 0,
                wides=inn.get("wides") or 0,
                no_balls=inn.get("no_balls") or 0,
                total=inn.get("extras") or 0,
            )
            perfs = inn.get("PlayerPerfs") or []
            # batting
            for p in perfs:
                if not _is_batting_perf(p):
                    continue
                runs = p.get("runs")
                balls_faced = p.get("balls")
                code = (p.get("dismissal_text") or "").strip().lower()
                how = _DISMISSAL.get(code, p.get("dismissal_text") or "")
                bowler = fielder = ""
                if how in ("caught", "bowled", "lbw", "stumped", "hit wicket"):
                    bowler = name_of(p.get("dismisser1_id"))
                    if how in ("caught", "stumped"):
                        fielder = name_of(p.get("dismisser2_id"))
                elif how == "run out":
                    fielder = (name_of(p.get("dismisser1_id"))
                               or name_of(p.get("dismisser2_id")))
                sr = (round(runs / balls_faced * 100, 2)
                      if runs is not None and balls_faced else None)
                o.batting.append(Bat(
                    name=(p.get("player_name") or "").strip(),
                    how_out=how, bowler=bowler, fielder=fielder,
                    runs=runs, balls=balls_faced,
                    fours=p.get("fours"), sixes=p.get("sixes"), sr=sr))
                if runs is not None and runs < 0:
                    o.net_score_format = True
            # bowling
            for p in perfs:
                if not _is_bowling_perf(p):
                    continue
                overs = p.get("overs")
                runs = p.get("runs")
                econ = (round(runs / overs, 2)
                        if runs is not None and overs else None)
                o.bowling.append(Bowl(
                    name=(p.get("player_name") or "").strip(),
                    overs=float(overs) if overs is not None else None,
                    maidens=p.get("maidens"), runs=runs,
                    wickets=p.get("wickets"), wides=p.get("wides"),
                    no_balls=p.get("no_balls"), econ=econ))
            # fall of wickets (perfs that recorded a fall score)
            fows = [p for p in perfs
                    if _is_batting_perf(p) and p.get("fow") is not None]
            fows.sort(key=lambda p: p.get("fow_order") or 0)
            for p in fows:
                o.fall_of_wickets.append(Fow(
                    wicket_no=p.get("fow_order"), score=p.get("fow"),
                    batsman_out=(p.get("player_name") or "").strip()))
            innings.append(o)

    # ball-by-ball (optional)
    if balls:
        by_innings = {}
        for b in balls:
            o = Ball(
                over=b.get("over_no"), ball=b.get("ball_no_disp"),
                innings_number=b.get("innings_number"),
                batter=name_of(b.get("batter_id")),
                bowler=name_of(b.get("bowler_id")),
                runs=b.get("runs_bat"), extras=b.get("runs_extra"),
                extras_type=str(b.get("extras_type") or ""),
                dismissed=name_of(b.get("dismissed_batter_id")),
                desc=(b.get("l_desc") or b.get("s_desc") or "").strip(),
                batter_id=b.get("batter_id"), bowler_id=b.get("bowler_id"))
            by_innings.setdefault(b.get("innings_number"), []).append(o)
        # attach by innings_number order to innings in document order
        for idx, num in enumerate(sorted(by_innings)):
            if idx < len(innings):
                innings[idx].balls = by_innings[num]

    meta = {
        "source_url": url,
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "source": "resultsvault-json-api",
    }
    return Document(match=match, innings=innings, meta=meta)


# --------------------------------------------------------------------------- #
# Reconciliation
# --------------------------------------------------------------------------- #
def reconcile(doc: Document):
    for inn in doc.innings:
        if inn.net_score_format:
            # Pairs/net-score: total is a net figure and batters retire rather
            # than being dismissed; the standard identities don't hold.
            log.info("RECON %s/%s: net-score format, skipping run/wicket "
                     "reconciliation", doc.match.match_id, inn.team)
            continue
        bat_runs = sum(b.runs or 0 for b in inn.batting)
        expected = bat_runs + (inn.extras.total or 0)
        if inn.total_runs is not None and expected != inn.total_runs:
            log.warning(
                "RECON %s/%s: sum(batting)=%d + extras=%d = %d != total=%s",
                doc.match.match_id, inn.team, bat_runs, inn.extras.total,
                expected, inn.total_runs)
        dismissed = sum(
            1 for b in inn.batting
            if b.how_out and b.how_out not in ("not out", "retired not out",
                                               "did not bat", "")
        )
        if inn.wickets is not None and dismissed != inn.wickets:
            log.warning(
                "RECON %s/%s: dismissed batsmen=%d != wickets=%s",
                doc.match.match_id, inn.team, dismissed, inn.wickets)


# --------------------------------------------------------------------------- #
# Output
# --------------------------------------------------------------------------- #
def doc_to_dict(doc: Document) -> dict:
    d = {
        "match": asdict(doc.match),
        "innings": [asdict(i) for i in doc.innings],
        "meta": doc.meta,
    }
    return d


def print_summary(doc: Document):
    m = doc.match
    print("\n" + "=" * 68)
    print(f"Match {m.match_id} | {m.competition_grade or '-'} | {m.date or '-'}")
    print(f"  {m.teams.home}  vs  {m.teams.away}")
    print(f"  Ground: {m.ground or '-'}   Result: {m.result or '-'}")
    if m.toss:
        print(f"  Toss:   {m.toss}")
    print("-" * 68)
    if not doc.innings:
        print("  (no innings/scorecard data on page)")
        return
    print(f"  {'Innings':28s} {'Score':>10s} {'Overs':>7s} {'Extras':>7s}")
    for inn in doc.innings:
        score = (f"{inn.total_runs}/{inn.wickets}"
                 if inn.total_runs is not None else "-")
        tag = " [net score]" if inn.net_score_format else ""
        balls = f"  bxb={len(inn.balls)}" if inn.balls else ""
        print(f"  {inn.team[:28]:28s} {score:>10s} "
              f"{str(inn.overs or '-'):>7s} {str(inn.extras.total):>7s}{tag}{balls}")
        top = sorted((b for b in inn.batting if b.runs is not None),
                     key=lambda b: b.runs, reverse=True)[:3]
        for b in top:
            dismissal = b.how_out + (f" b {b.bowler}" if b.bowler else "")
            print(f"      {b.name[:24]:24s} {b.runs:>4} "
                  f"({b.balls if b.balls is not None else '-'})  {dismissal}")


# --------------------------------------------------------------------------- #
# Driver
# --------------------------------------------------------------------------- #
def load_urls(args) -> list:
    urls = []
    if args.urls and os.path.exists(args.urls):
        with open(args.urls) as fh:
            raw = fh.read()
    elif args.url_args:
        return args.url_args
    else:
        raw = DEFAULT_URLS
    for line in raw.splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            urls.append(line)
    return urls


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("url_args", nargs="*", help="URLs to scrape")
    ap.add_argument("--urls", help="file with one URL per line")
    ap.add_argument("--force", action="store_true",
                    help="ignore raw cache and re-fetch")
    ap.add_argument("--balls", action="store_true",
                    help="also fetch ball-by-ball (JSON API only)")
    ap.add_argument("--html-only", action="store_true",
                    help="skip the JSON API and parse the HTML scorecard")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args(argv)

    logging.basicConfig(
        level=logging.INFO if args.verbose else logging.INFO,
        format="%(levelname)s %(message)s",
    )

    os.makedirs(RAW_DIR, exist_ok=True)
    os.makedirs(OUT_DIR, exist_ok=True)

    urls = load_urls(args)
    if not urls:
        log.error("no URLs to process")
        return 1

    session = requests.Session()
    combined = []
    for url in urls:
        problems = []
        doc = None

        # Preferred path: the structured JSON API (needs entityid + matchid,
        # which ResultsVault gateway URLs carry). Gives full batting/bowling/
        # fielding perfs and optional ball-by-ball, incl. formats the HTML
        # pages don't render. Falls back to HTML on any failure.
        entityid, api_matchid = api_ids_from_url(url)
        if entityid and api_matchid and not args.html_only:
            try:
                data, balls = fetch_api_json(
                    entityid, api_matchid, session,
                    force=args.force, with_balls=args.balls)
                doc = map_api_to_document(
                    data, balls, url, api_matchid, problems)
            except Exception as exc:
                log.warning("JSON API failed for %s (%s); falling back to HTML",
                            url, exc)

        if doc is None:  # HTML fallback
            try:
                html = fetch(url, session, force=args.force)
            except Exception as exc:  # one match failing shouldn't kill the batch
                log.error("skip %s: %s", url, exc)
                continue
            try:
                doc = parse_match(html, url, problems)
            except Exception as exc:
                log.exception("parse failed for %s: %s", url, exc)
                continue

        reconcile(doc)
        d = doc_to_dict(doc)
        if problems:
            d["meta"]["parse_warnings"] = problems
        mid = doc.match.match_id
        with open(os.path.join(OUT_DIR, f"{mid}.json"), "w") as fh:
            json.dump(d, fh, indent=2, ensure_ascii=False)
        combined.append(d)
        print_summary(doc)

    with open(os.path.join(OUT_DIR, "matches.json"), "w") as fh:
        json.dump(combined, fh, indent=2, ensure_ascii=False)
    print(f"\nWrote {len(combined)} match file(s) to {OUT_DIR}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
