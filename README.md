# PocoMan · 1000 Levels

A complete, zero-dependency Sokoban-style puzzle game with **1000 playable levels**,
built in plain HTML5 canvas + JavaScript. Every level is procedurally generated and
**provably solvable** — each one ships with a real solution the game verified by
replaying it, so you can never hit an impossible board. Levels are deterministic
(level 37 always looks the same) and distinct across the whole run.

## Run it

**Option A — just double-click** `index.html` (works from `file://`, no server needed).

**Option B — local server:**

```
node serve.js          # then open http://localhost:8080
```

**Option C — any static server** (`python -m http.server`, `npx serve`, …).

## How to play

| Control | Action |
| --- | --- |
| ← ↑ → ↓ / W A S D | Move / push |
| Z | Undo last move |
| R | Restart level |
| F | Solve (auto-play the stored solution) |
| P | Pause / resume |
| Esc | Back / pause |
| Enter | Start / next level |
| Touch | Swipe on the board or use the on-screen pad |

- Push every **treasure box** onto a glowing **mark** to clear the level.
- You can **push** but never **pull** — and only one box per push. Plan ahead.
- A box shoved into a corner is usually lost. **Undo (Z)** is your best friend;
  **Restart (R)** when a puzzle is truly dead.
- **Par** is the fewest pushes possible. It is shown only when the solver proved it —
  otherwise the HUD reads "–" rather than a guess.
- Clear level 1000 to win.

## The 1000 levels

- **9 difficulty tiers** from Easy to Master, ramping board size, box count and
  layout complexity:

  | Tier | Levels | Grid | Boxes | Style | Typical par |
  | --- | --- | --- | --- | --- | --- |
  | Easy | 1–40 | 5–6 | 1 | open room | ~1 |
  | Easy | 41–120 | 6–7 | 1–2 | open room | ~3 |
  | Easy | 121–250 | 7–8 | 1–2 | open + maze | ~6 |
  | Medium | 251–420 | 8–9 | 2 | open + maze | ~9 |
  | Medium | 421–600 | 9–10 | 2–3 | open + chamber | ~19 |
  | Hard | 601–760 | 10–11 | 3 | chamber | ~24 |
  | Hard | 761–890 | 11–12 | 3–4 | chamber | ~26 |
  | Expert | 891–970 | 13–15 | 3–4 | chamber | ~28 |
  | Master | 971–1000 | 16–17 | 3–4 | chamber | ~32 |

- **Three layout families**: open rooms (room to think), braided mazes (corridors and
  dead ends) and packed chambers (tight doorways that make every push count). Hard
  tiers cluster the marks into one corner, so stray boxes sit 15–20 pushes from home.
- **Generation**: build a solved board, then drag boxes *backwards* out of it with a
  legal pull-chain. Reversing that chain is a genuine forward solution — that is what
  makes every level solvable by construction. A search-based **solver** then measures
  the true minimum push count ("par") and stores the exact solution for the in-game
  Solve button.
- **Level Select** pages 100 levels at a time (10 pages, arrows ‹ ›); it stars every
  level you have cleared. **Continue** on the menu jumps to your furthest level.
- Progress persists in `localStorage`.

## Verify the levels (dev)

```
node test/generator.test.js
```

Checks all 1000 levels for: matching box/mark counts, no starting static deadlock,
a reachable player, a stored solution that **actually replays to a solved state**,
verified par equal to the solution's push count (or par hidden when unproven),
distinct boards, and per-tier difficulty bands. Also asserts determinism (generating a
level twice yields identical output).

## Code layout

```
index.html        shell, HUD, overlays, level-select pager
style.css         arcade look, responsive layout, touch pad
serve.js          zero-dependency local static server
js/rng.js         seeded RNG (deterministic levels)
js/generator.js   layout builders + pull-scrambler + A* solver (par + solution)
js/render.js      canvas renderer (walls, marks, boxes, player) with per-tier palettes
js/game.js        play state: moves, push rules, undo, reset, auto-solve
js/main.js        UI, input, lazy level generation + progress save
test/             node test suite
```
