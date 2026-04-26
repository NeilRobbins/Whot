# Whot!

Browser-based, peer-to-peer multiplayer Whot! card game. Mobile-first UI for
iOS and Android browsers. No central game server — gameplay runs over WebRTC
data channels with a signed, hash-chained event log per the project RFC.

## Quick start

```bash
npm install
npm run dev          # local dev server (http://localhost:5173)
npm run build        # production static bundle in dist/
npm test             # run Vitest unit tests
```

To play across devices, deploy `dist/` to any static host (Cloudflare Pages,
GitHub Pages, Netlify, Vercel, S3 + CloudFront). Open the deployed URL on the
host device, tap **Host a Whot! Game**, share the invite link via WhatsApp /
SMS / AirDrop. Everyone hits **I'm Ready**, host taps **Lock Roster & Start**.

## Architecture

The codebase is organised as a single Vite app with internal packages under
`src/packages/`, mirroring the module map in the RFC:

| Module | Responsibility |
|---|---|
| `protocol-core` | Canonical JSON, SHA-256 hashing, base event types |
| `trust-core` | Ed25519 identity & signing, event verification |
| `game-log` | Hash-chained signed event log, fork detection |
| `whot-rules` | Deterministic reducer, validator, deck, rules config |
| `lobby` | Lobby state machine: join / ready / lock |
| `transport` | WebRTC peer mesh (untrusted public-tracker signalling via Trystero) |
| `endgame` | Outcome summary + local leaderboard (browser storage) |

The single React app under `src/app/` glues these together and renders the
mobile-friendly UI.

### Trust model summary

- The host controls the lobby (admit / remove / lock roster) but has **no**
  gameplay authority after roster lock.
- Every event is signed with an ephemeral per-game Ed25519 key.
- Each event references the previous event's hash, forming an append-only
  chain. Invalid moves are rejected by the deterministic reducer; conflicting
  events at the same chain position are flagged as fork evidence.
- Dealer-mode shuffle is used in this MVP: the deck order is derived from a
  shared seed published in the `GAME_INITIALISED` event. The `FairDeck`
  interface in the RFC is the next-phase upgrade path to a Byzantine-fair
  mental-poker protocol.

### Why Trystero?

`trystero/torrent` uses public BitTorrent trackers as untrusted signalling and
sets up WebRTC data channels between browsers. The signalling layer is
treated as untrusted transport — nothing in the protocol depends on it for
correctness because every authoritative event is signed and hash-chained. Any
other untrusted signalling backend (Cloudflare Worker + Durable Object,
Firebase, MQTT, Nostr) can be swapped in via the same package boundary.

## Whot! rules implemented

- 54-card standard deck (5 Whot! cards).
- Initial hand size: 6.
- Special cards (configurable): `1` Hold-on, `2` Pick Two (stackable), `5`
  Pick Three (stackable), `8` Suspend, `14` General Market, `20` Whot
  (call shape).
- Last-card declaration with penalty if missed.
- Deterministic reshuffle of discard when the draw pile empties.
- Stalemate detection when no legal moves remain.

The reducer in `src/packages/whot-rules/reducer.ts` is pure: given the same
event sequence, every browser converges to the same state.

## Testing

```bash
npm test            # 29 unit tests over deck, reducer, event log, lobby, canonical JSON
```

## Repository layout

```
src/
  app/              React app (screens, store, session glue)
    components/
    screens/
  packages/
    protocol-core/
    trust-core/
    game-log/
    whot-rules/
    lobby/
    transport/
    endgame/
  styles/
public/
index.html
vite.config.ts
```

## Roadmap

- [x] Phase 1 MVP — dealer-mode social-trust game.
- [ ] Phase 2 — full all-player ACK / replay + dispute bundle export.
- [ ] Phase 3 — friend-group leaderboard backend (Cloudflare D1).
- [ ] Phase 4 — Byzantine-fair deck via reviewed mental-poker protocol.
