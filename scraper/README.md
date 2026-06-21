# ResultsVault cricket scorecard scraper

A small, robust scraper/extractor for cricket match data behind ResultsVault
`go.aspx` gateway URLs. It normalises each match into a stable JSON schema and
runs sanity (reconciliation) checks per innings.

```
python3 scrape_resultsvault.py                         # uses urls.txt / built-in seed
python3 scrape_resultsvault.py URL [URL ...]           # explicit URLs
python3 scrape_resultsvault.py --urls urls.txt         # URL list file
python3 scrape_resultsvault.py --force URL             # ignore the raw cache
```

Install deps: `pip3 install -r requirements.txt` (`requests` + `selectolax`).

## What the response format actually is (probe results)

The task asked to look for a structured feed *before* scraping HTML. I probed
one sample URL
(`.../go.aspx?matchid=7443828&ofl=0&id=MATCH&entityid=108595`) every way that
plausibly toggles output format and recorded the `Content-Type` of each
response. Every raw response is saved under `./raw/` for inspection.

**Finding 1 — `go.aspx` is just a redirector.** Regardless of `ofl=0/1/2/3`,
adding `fl=1`, `type=json`, or an `Accept: application/json` header, the
gateway always answers:

```
HTTP/2 302
location: https://play-cricket.com/live_app/scorecard?id=7393599
```

`id=MATCH` is the *view code* (full scorecard); `matchid` is the ResultsVault
fixture id, which the gateway maps to an internal **Play-Cricket** scorecard
id. `entityid` is the site/club context. `ofl` had no effect on the output
format in any test — it does not unlock JSON.

**Finding 2 — no token-free structured feed exists.** The Play-Cricket data
API does expose JSON, but it is token-gated:

```
GET https://play-cricket.com/api/v2/match_detail.json?match_id=...
-> HTTP/2 401  application/json   {"error":"..."}    # needs an ECB API token
```

The task explicitly excludes the ECB Play-Cricket API, and it is unauthenticated-
inaccessible anyway. The `live_app/scorecard` page itself contains **no**
embedded JSON blob (`application/json` script, `window.__DATA__`, etc.).

**Conclusion: the usable source is rendered HTML** at
`https://play-cricket.com/live_app/scorecard?id=<id>`
(`Content-Type: text/html`). The scraper follows the gateway redirect
automatically, so you feed it the original `go.aspx` URL (or a direct
`live_app/scorecard?id=…` URL — both work).

### Raw responses saved

| File (in `./raw/`)        | What it is                                            |
|---------------------------|-------------------------------------------------------|
| `probe_ofl0/1/2.bin`, `probe_fl1.bin`, `probe_typejson.bin`, `probe_acceptjson.bin` | gateway 302 responses for each variant (all identical redirects) |
| `<sha16>.html`            | cached final HTML per source URL (drives idempotent re-runs) |
| `match_<matchid>.html`    | human-readable copy of each fetched scorecard          |

## HTML structure the parser keys off

The parser is **label/CSS-hook keyed**, never positional on the page as a
whole, so it survives column/section reordering:

- **Header meta** — `div.leaguedetail-left` (competition grade),
  `div.leaguedetail-right` (date) + `span.location > a` (ground),
  `p.match-ttl` / `div.match-status` (result), `p.team-name` (teams),
  `p.team-info-3` (toss).
- **Innings totals** — `p.team-info-2` text, e.g. `190 / 6 (35)` or
  `119 / All out (31.1)`; "All out" → 10 wickets.
- **Batting** — `table.standm`. Header row maps long labels
  (`RUNS`/`BALLS`/`4s`/`6s`/`SR`) to column indices. Batter name from
  `div.bts > a`. Dismissal is read from the two unlabelled cells: a leading
  `<span>` gives the mode (`c`, `st`, `lbw`, `run out`, `retired`, …) and the
  trailing `<a>` gives the fielder / bowler. Bowled = empty mode cell + a
  `b <bowler>` cell.
- **Extras** — `table.table-scorecard-footer`, e.g.
  `EXTRAS: 33 (14b, 3lb, 14w, 2nb)`, parsed by the `b/lb/w/nb` tags.
- **Bowling** — `table.bowler-detail`. Header maps
  `OVERS/MAIDENS/RUNS/WICKETS/WIDES/NO BALLS/ECON`. (Note: "NO BALLS" contains
  the substring "ball", so the no-ball column is matched *before* the generic
  balls rule.)
- **Fall of wickets** — `div.fall-of-wickets > p.font-3`, markers like
  `<strong>12-1</strong> <a>Martin Rutherford</a> (...partner-7*);`. We walk
  the `<strong>score-wicket</strong>` markers (you can't split on `;` — it also
  appears inside `&nbsp;`) and take the dismissed batsman as the first anchor
  after each marker.

### Order-independence

Batting-table order is *batting* order (team that batted first), which need not
match the header's team order, and a page may carry fewer FoW blocks than
innings. So:

- each innings is matched to a team by its **reconstructed total**
  (`sum(batting) + extras`) against the header score map, not by index;
- each FoW block is matched to the innings whose **batsmen names** overlap it.

## Output

- `./out/<matchid>.json` — one document per match.
- `./out/matches.json` — combined array.
- A human-readable summary table is printed to stdout per match.

Schema (per match):

```jsonc
{
  "match": { "match_id", "competition_grade", "date", "ground",
             "status", "result", "toss",
             "teams": { "home", "away" } },
  "innings": [ { "team", "total_runs", "wickets", "overs",
                 "extras": { "byes", "leg_byes", "wides", "no_balls", "total" },
                 "batting": [ { "name", "how_out", "bowler", "fielder",
                                "runs", "balls", "fours", "sixes", "sr" } ],
                 "fall_of_wickets": [ { "wicket_no", "score", "batsman_out" } ],
                 "bowling": [ { "name", "overs", "maidens", "runs", "wickets",
                                "wides", "no_balls", "econ" } ] } ],
  "meta": { "source_url", "retrieved_at" }
}
```

### Example (verified, match 7262345)

```
Match 7262345 | FRIENDLY | 10 MAY 2026 @ 13:00
  Hampton Hill CC  vs  Downsiders CC
  Ground: Bushy Park   Result: WON BY 87 RUNS
  Downsiders CC      277/3  (35.0)  extras 33
  Hampton Hill CC    190/6  (35.0)  extras 22
```

Both innings reconcile: `244 batting + 33 extras = 277`, `168 + 22 = 190`;
dismissed-batsman counts match the wicket totals.

## Robustness & etiquette

- Realistic browser `User-Agent`; 30s timeouts; up to 4 retries with
  exponential backoff (2/4/8/16s); ~1.5s polite delay between network requests.
- **Raw responses are cached** (`./raw/<sha>.html`); re-runs are idempotent and
  hit the cache unless `--force` is passed.
- **Per-innings reconciliation**: `sum(batting runs) + extras.total ==
  total_runs` and `count(dismissed) == wickets`. Mismatches are **logged**
  (`RECON …`), never silently dropped.
- Fields that can't be parsed are logged/left null rather than failing the whole
  match; a network failure on one URL skips that match, not the batch.

## Notes / limitations

- Youth/junior fixtures (e.g. the seed `matchid=7443828`, a U9 game) often have
  **no detailed scorecard** on Play-Cricket — only points. The scraper extracts
  the header (teams, date, ground, result, toss) and reports
  "no innings/scorecard data on page" rather than inventing rows.
- The live page markup can vary slightly between fetches (responsive blocks are
  duplicated and de-duplicated in code); the label-keyed approach handles this.
- `play-cricket.com` must be reachable. In network-restricted sandboxes the
  redirect target may be blocked even though the gateway host resolves.
```
