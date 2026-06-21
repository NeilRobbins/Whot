# ResultsVault cricket scorecard scraper

A small, robust scraper/extractor for cricket match data behind ResultsVault
`go.aspx` gateway URLs. It prefers the **structured JSON API** (full
batting/bowling/fielding + optional ball-by-ball) and falls back to parsing the
rendered HTML scorecard. Each match is normalised into a stable JSON schema with
per-innings reconciliation checks.

```
python3 scrape_resultsvault.py                         # uses urls.txt / built-in seed
python3 scrape_resultsvault.py URL [URL ...]           # explicit URLs
python3 scrape_resultsvault.py --urls urls.txt         # URL list file
python3 scrape_resultsvault.py --balls URL             # also fetch ball-by-ball
python3 scrape_resultsvault.py --html-only URL         # skip the JSON API
python3 scrape_resultsvault.py --force URL             # ignore the raw cache
```

Install deps: `pip3 install -r requirements.txt`
(`requests` + `selectolax` + `pycryptodome`).

## What the response format actually is (probe results)

The task asked to look for a structured feed *before* scraping HTML. There is
one — it just isn't advertised.

**Finding 1 — `go.aspx` is just a redirector.** Regardless of `ofl=0/1/2/3`,
adding `fl=1`, `type=json`, or an `Accept: application/json` header, the gateway
always 302s to `https://play-cricket.com/live_app/scorecard?id=<pcid>`. `ofl`
never unlocks JSON. `id=MATCH` is the view code; `matchid`/`entityid` are the
ResultsVault fixture id and site context.

**Finding 2 — the `live_app` page renders client-side.** Its scorecard HTML is
empty for some formats (e.g. youth **pairs / net-score** cricket): the detail is
drawn by InteractSport's *match-centre* JS bundle
(`embed.interactsport.com/match-centre`), which doesn't read the HTML — it calls
a JSON API.

**Finding 3 — the structured feed (PRIMARY source).** The match-centre app
fetches:

```
GET https://api.resultsvault.co.uk/rv/<entityid>/matches/<matchid>/?apiid=1003&strmflg=3
GET (same)/?apiid=1003&action=getballs&sportid=1          # ball-by-ball
Content-Type: application/json   ->  200 application/json
```

This returns the **complete** scorecard: `MatchTeams[].Innings[]` with
`PlayerPerfs` (batting rows with runs/balls/4s/6s/dismissal, bowling rows with
overs/maidens/runs/wickets/wides/no-balls, and fielding rows), innings totals
and `extras`, plus optional `CBalls` (ball-by-ball: batter/bowler/runs/extras/
dismissal/commentary).

The endpoint is gated by a lightweight **anti-bot request signature** (not user
auth, no credentials, no private data) sent as a header:

```
X-IAS-API-REQUEST: base64( 3DES-ECB( <unix-timestamp-string>, apiSharedSecret ) )
```

The 24-byte `apiSharedSecret` and `apiid` are public constants shipped in the
app bundle; the server only checks the timestamp is recent (~30 min window).
`rv_api.py` reproduces exactly what the official web app does (see
`make_signature`). This is the same mechanism the public match-centre uses to
read public match data; the script keeps the app's polite delays and caching.

> The token-gated ECB `play-cricket.com/api/v2/*.json` endpoint (HTTP 401
> without an API token) is a *different*, excluded API and is **not** used.

**Conclusion: the JSON API is the source of truth** and the scraper uses it
whenever the URL carries `entityid` + `matchid` (i.e. ResultsVault gateway
URLs). For a bare `live_app/scorecard?id=…` URL (no entityid) it falls back to
the HTML parser below.

### Raw responses saved (`./raw/`)

| File | What it is |
|------|------------|
| `api_<matchid>.json`       | cached JSON match document (drives idempotent re-runs) |
| `api_<matchid>_balls.json` | cached ball-by-ball (with `--balls`) |
| `<sha16>.html` / `match_<matchid>.html` | cached HTML (fallback path only) |

## HTML structure the fallback parser keys off

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
                                "wides", "no_balls", "econ" } ],
                 "net_score_format",          // true for pairs/net-score cricket
                 "balls": [ { "over", "ball", "innings_number",
                              "batter", "bowler", "runs", "extras",
                              "extras_type", "dismissed", "desc",
                              "batter_id", "bowler_id" } ] } ],  // with --balls
  "meta": { "source_url", "retrieved_at", "source" }
}
```

### Example 1 — full JSON-API scorecard (verified, your seed match 7443828)

A U9 **pairs / net-score** game — invisible on the HTML page, fully available
from the JSON API, exactly matching the Play-Cricket app:

```
Match 7443828 | South U9 Div 2 | 2026-06-21T09:30:00+01:00
  Hampton Wick Royal CC U9  vs  Hampton Hill CC Under 9 B
  Result: Hampton Wick Royal CC U9 261 def. Hampton Hill CC Under 9 B 228
  Hampton Wick Royal CC U9   261/7 (20.0) extras 41 [net score]  bxb=240
  Hampton Hill CC Under 9 B  228/11 (20.0) extras 32 [net score]
      A Shanmugasivam 11 (10)  4s=2  SR 110.00
      G Metcalfe      -1 (8)   SR -12.50      # negative runs = wicket penalty
```

Per-batter, per-bowler and 240 ball-by-ball deliveries are all captured.

### Example 2 — full HTML-fallback scorecard (verified, match 7262345)

```
Downsiders CC      277/3  (35.0)  extras 33   Freddie Alden 86  caught b Tahir Butt
Hampton Hill CC    190/6  (35.0)  extras 22   Shaan Sohail 111  bowled b Cam Allen
```

Both innings reconcile: `244 batting + 33 extras = 277`, `168 + 22 = 190`;
dismissed-batsman counts match the wicket totals.

## Robustness & etiquette

- Realistic browser `User-Agent`; 30s timeouts; up to 4 retries with
  exponential backoff (2/4/8/16s); ~1.5s polite delay between network requests.
- **Raw responses are cached** (`./raw/`); re-runs are idempotent and hit the
  cache unless `--force` is passed.
- **Per-innings reconciliation**: `sum(batting runs) + extras.total ==
  total_runs` and `count(dismissed) == wickets`. Mismatches are **logged**
  (`RECON …`), never silently dropped. For pairs/**net-score** formats (totals
  are net figures, batters retire rather than getting out) these identities
  don't apply and the check is skipped with an INFO note.
- Fields that can't be parsed are logged/left null rather than failing the whole
  match; a network/API failure on one URL skips that match, not the batch; an
  API failure on a given match falls back to the HTML path.

## Notes / limitations

- **Pairs/net-score (youth) matches**: `total_runs` is the *net* score (each
  team starts from a base, ~200), batters show net runs (often negative) and
  retire instead of being dismissed, so wicket/run reconciliation is skipped.
  `net_score_format: true` flags these innings.
- **Ball-by-ball name resolution**: youth feeds sometimes use match-local
  placeholder player ids in `PlayerPerfs` that don't match the ball-feed ids, so
  a minority of deliveries (typically extras) can't resolve a batter name. The
  raw `batter_id`/`bowler_id` and the source `desc` string are always kept.
- `api.resultsvault.co.uk` / `play-cricket.com` must be reachable. In
  network-restricted sandboxes these hosts may be blocked.
```
