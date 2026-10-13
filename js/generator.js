/* =========================================================================
 * PocoMan — level generator & solver.
 *
 * Every one of the 1000 levels is generated on demand from a deterministic
 * seed, and every level is GUARANTEED solvable:
 *
 *   1. Carve a layout (open room, braided maze or maze + chambers).
 *   2. Put boxes on the goals — a solved state.
 *   3. Scramble by pulling boxes *backwards* through the level. A pull is the
 *      exact inverse of a push, and the player may only "walk" between pulls
 *      through genuinely reachable cells. Reversing the pull list is therefore
 *      a valid forward solution, whatever else happens.
 *   4. Reject any scramble that lands a box in a static deadlock (corner /
 *      wall line with no goal) — those are provably unsolvable.
 *   5. Run a push-based BFS solver to get the TRUE minimum push count, and keep
 *      only candidates whose difficulty lands inside the level's target band.
 *
 * Cell flags:  W wall · G goal · B box · P player.
 * Directions:  0 up · 1 right · 2 down · 3 left (used for stored solutions).
 * ========================================================================= */
(function (root) {
  'use strict';
  var POCO = (root.POCO = root.POCO || {});
  if (!POCO.RNG && typeof require === 'function') POCO.RNG = require('./rng.js').RNG;
  var RNG = POCO.RNG;

  var W = 1, G = 2, B = 4, P = 8;
  var DIRS = [{ dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }];
  var MAX_LEVEL = 1000;

  function now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  /* ---------------------------------------------------------------- tiers */
  /* upTo      levels up to and including this number
   * styles    layout families to draw from
   * size      [min,max] grid width/height in tiles
   * boxes     [min,max] treasure count
   * pulls     scramble budget (1 pull === 1 push on the way back)
   * min/max   target band for the solver's minimum push count ("par")       */
  var TIERS = [
    { upTo: 40,   name: 'Easy',   styles: ['open'],            size: [5, 6],   obstacles: 0.05, braid: 0.00, innerWalls: 0.30, chambers: 0, boxes: [1, 1], pulls: 40,  min: 1,   max: 6,   sep: 0, cluster: false, attempts: 14 },
    { upTo: 120,  name: 'Easy',   styles: ['open'],            size: [6, 7],   obstacles: 0.06, braid: 0.00, innerWalls: 0.40, chambers: 0, boxes: [1, 2], pulls: 70,  min: 3,   max: 12,  sep: 3, cluster: false, attempts: 14 },
    { upTo: 250,  name: 'Easy',   styles: ['open', 'maze'],    size: [7, 8],   obstacles: 0.08, braid: 0.60, innerWalls: 0.40, chambers: 1, boxes: [1, 2], pulls: 100, min: 5,   max: 16,  sep: 3, cluster: false, attempts: 14 },
    { upTo: 420,  name: 'Medium', styles: ['open', 'maze'],    size: [8, 9],   obstacles: 0.10, braid: 0.55, innerWalls: 0.45, chambers: 2, boxes: [2, 2], pulls: 130, min: 8,   max: 20,  sep: 3, cluster: false, attempts: 14 },
    { upTo: 600,  name: 'Medium', styles: ['open', 'chamber'], size: [9, 10],  obstacles: 0.10, braid: 0.55, innerWalls: 0.45, chambers: 3, boxes: [2, 3], pulls: 165, min: 15,  max: 34,  sep: 3, cluster: true,  attempts: 14 },
    { upTo: 760,  name: 'Hard',   styles: ['chamber'],         size: [10, 11], obstacles: 0.00, braid: 0.65, innerWalls: 0.00, chambers: 4, boxes: [3, 3], pulls: 200, min: 20,  max: 44,  sep: 2, cluster: true,  attempts: 16 },
    { upTo: 890,  name: 'Hard',   styles: ['chamber'],         size: [11, 12], obstacles: 0.00, braid: 0.65, innerWalls: 0.00, chambers: 5, boxes: [3, 4], pulls: 250, min: 24,  max: 50,  sep: 2, cluster: true,  attempts: 16 },
    { upTo: 970,  name: 'Expert', styles: ['chamber'],         size: [13, 15], obstacles: 0.00, braid: 0.70, innerWalls: 0.00, chambers: 6, boxes: [3, 4], pulls: 340, min: 26,  max: 52,  sep: 2, cluster: true,  attempts: 18 },
    { upTo: 1000, name: 'Master', styles: ['chamber'],         size: [16, 17], obstacles: 0.00, braid: 0.70, innerWalls: 0.00, chambers: 7, boxes: [3, 4], pulls: 420, min: 30,  max: 60,  sep: 2, cluster: true,  attempts: 20 }
  ];

  function tierFor(num) {
    num = Math.max(1, Math.min(MAX_LEVEL, num | 0));
    for (var i = 0; i < TIERS.length; i++) {
      if (num <= TIERS[i].upTo) {
        var t = {};
        for (var k in TIERS[i]) t[k] = TIERS[i][k];
        t.index = i;
        t.solverNodes = 60000 + i * 16000;
        t.solverMs = 140 + i * 55;
        return t;
      }
    }
    return TIERS[TIERS.length - 1];
  }

  /* -------------------------------------------------------- grid helpers */
  function idx(x, y, w) { return y * w + x; }

  function openNeighbours(cells, w, h, x, y) {
    var n = 0;
    for (var d = 0; d < 4; d++) {
      var nx = x + DIRS[d].dx, ny = y + DIRS[d].dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (!(cells[ny * w + nx] & W)) n++;
    }
    return n;
  }

  function floorCount(cells) {
    var n = 0;
    for (var i = 0; i < cells.length; i++) if (!(cells[i] & W)) n++;
    return n;
  }

  /* Flood fill every floor cell reachable from `start` (blocking boxes).
   * Returns the list plus a predecessor map so walking paths are free.     */
  function flood(cells, w, h, start, boxSet) {
    var seen = new Uint8Array(cells.length);
    var pred = new Int32Array(cells.length);
    var list = [];
    pred[start] = -1;
    if (cells[start] & W) return { list: list, seen: seen, pred: pred };
    seen[start] = 1;
    list.push(start);
    for (var head = 0; head < list.length; head++) {
      var c = list[head], cx = c % w, cy = (c / w) | 0;
      for (var d = 0; d < 4; d++) {
        var nx = cx + DIRS[d].dx, ny = cy + DIRS[d].dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        var ni = ny * w + nx;
        if (seen[ni] || (cells[ni] & W) || (boxSet && boxSet.has(ni))) continue;
        seen[ni] = 1;
        pred[ni] = c;
        list.push(ni);
      }
    }
    return { list: list, seen: seen, pred: pred };
  }

  function isConnected(cells, w, h) {
    var total = floorCount(cells);
    if (!total) return false;
    var start = -1;
    for (var i = 0; i < cells.length; i++) if (!(cells[i] & W)) { start = i; break; }
    return flood(cells, w, h, start, null).list.length === total;
  }

  /* Walk path (list of directions) from `start` to `target` using the
   * predecessor map produced by a flood that started at `start`.            */
  function walkPath(pred, w, start, target) {
    var path = [], cur = target, guard = 0;
    while (cur !== start) {
      if (++guard > 4096) return null;
      var p = pred[cur];
      if (p < 0 || p === undefined) return null;
      var dx = (cur % w) - (p % w), dy = ((cur / w) | 0) - ((p / w) | 0);
      for (var d = 0; d < 4; d++) if (DIRS[d].dx === dx && DIRS[d].dy === dy) { path.push(d); break; }
      cur = p;
    }
    path.reverse();
    return path;
  }

  /* ------------------------------------------------------------- layouts */
  function makeLayout(rng, cfg, style) {
    var w = rng.range(cfg.size[0], cfg.size[1] + 0.999) | 0;
    var h = rng.range(cfg.size[0], cfg.size[1] + 0.999) | 0;
    if (style !== 'open') { w |= 1; h |= 1; }   /* mazes want odd dimensions */
    var cells = new Uint8Array(w * h);
    cells.fill(W);

    if (style === 'open') {
      carveRoom(cells, w, h, rng, cfg);
    } else {
      carveMaze(cells, w, h, rng);
      braid(cells, w, h, rng, cfg.braid);
      /* Chambers matter: a pull needs the player plus two free cells in line
       * behind the box, which a bare 1-wide corridor can never offer. The
       * open pockets are what let the scramble actually tangle the boxes. */
      var chambers = style === 'chamber' ? cfg.chambers : Math.max(1, (cfg.chambers / 2) | 0);
      var side = style === 'chamber' ? 4 : 3;
      for (var i = 0; i < chambers; i++) carveChamber(cells, w, h, rng, side);
    }
    if (!isConnected(cells, w, h)) return null;
    return { cells: cells, w: w, h: h };
  }

  function carveRoom(cells, w, h, rng, cfg) {
    var x, y;
    for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) cells[idx(x, y, w)] = 0;

    /* Split the room with a partial wall — it creates doorways, corridors and
     * the corners that make Sokoban interesting. */
    if (cfg.innerWalls && rng.chance(cfg.innerWalls) && Math.min(w, h) >= 6) addInnerWall(cells, w, h, rng);

    if (!cfg.obstacles) return;
    /* Drop a few pillars, one at a time, keeping the room walkable. */
    var tries = Math.round(cfg.obstacles * (w - 2) * (h - 2)) + 2;
    for (var i = 0; i < tries; i++) {
      for (var t = 0; t < 14; t++) {
        var px = 1 + rng.int(w - 2), py = 1 + rng.int(h - 2);
        var pi = idx(px, py, w);
        if (cells[pi] & W) continue;
        if (openNeighbours(cells, w, h, px, py) < 3) continue;  /* no tight pockets */
        cells[pi] = W;
        if (isConnected(cells, w, h)) break;
        cells[pi] = 0;
      }
    }
  }

  /* Wall a run of cells across part of an interior line, leaving a doorway. */
  function addInnerWall(cells, w, h, rng) {
    var vertical = rng.chance(0.5);
    var line = vertical ? w : h;            /* extent along the wall  */
    var at = 1 + rng.int(line - 2);         /* which interior line    */
    if (at >= (vertical ? w : h) - 1) return;
    var maxRun = ((line - 2) * 0.6) | 0;
    if (maxRun < 2) return;
    var run = 2 + rng.int(maxRun - 1);
    var start = 1 + rng.int(line - 1 - run);
    var changed = [];
    for (var s = start; s < start + run; s++) {
      var i = vertical ? idx(at, s, w) : idx(s, at, w);
      changed.push(i);
      cells[i] = W;
    }
    if (!isConnected(cells, w, h)) {
      for (var c = 0; c < changed.length; c++) cells[changed[c]] = 0;
    }
  }

  /* Recursive-backtracker maze over odd cells. */
  function carveMaze(cells, w, h, rng) {
    var stack = [[1, 1]];
    var seen = {};
    seen['1,1'] = 1;
    cells[idx(1, 1, w)] = 0;
    while (stack.length) {
      var top = stack[stack.length - 1];
      var cx = top[0], cy = top[1];
      var order = rng.shuffle([0, 1, 2, 3]);
      var moved = false;
      for (var i = 0; i < 4; i++) {
        var d = DIRS[order[i]];
        var nx = cx + d.dx * 2, ny = cy + d.dy * 2;
        if (nx < 1 || ny < 1 || nx > w - 2 || ny > h - 2) continue;
        if (seen[nx + ',' + ny]) continue;
        cells[idx(cx + d.dx, cy + d.dy, w)] = 0;      /* knock through */
        cells[idx(nx, ny, w)] = 0;
        seen[nx + ',' + ny] = 1;
        stack.push([nx, ny]);
        moved = true;
        break;
      }
      if (!moved) stack.pop();
    }
  }

  /* Braid: knock out walls near dead ends so corridors loop back on
   * themselves. Loops give the player the room a pull-scramble needs.      */
  function braid(cells, w, h, rng, prob) {
    if (!prob) return;
    for (var i = 0; i < cells.length; i++) {
      if (cells[i] & W) continue;
      var x = i % w, y = (i / w) | 0;
      if (openNeighbours(cells, w, h, x, y) !== 1) continue;
      if (!rng.chance(prob)) continue;
      var opts = [];
      for (var d = 0; d < 4; d++) {
        var wx = x + DIRS[d].dx, wy = y + DIRS[d].dy;
        var ex = x + DIRS[d].dx * 2, ey = y + DIRS[d].dy * 2;
        if (ex < 1 || ey < 1 || ex > w - 2 || ey > h - 2) continue;
        var wi = idx(wx, wy, w);
        if ((cells[wi] & W) && !(cells[idx(ex, ey, w)] & W)) opts.push(wi);
      }
      if (opts.length) cells[rng.pick(opts)] = 0;
    }
  }

  /* Open up a small chamber — breathing space inside a maze. */
  function carveChamber(cells, w, h, rng, maxSide) {
    var cw = 2 + rng.int(maxSide - 1), ch = 2 + rng.int(maxSide - 1);
    if (cw > w - 2) cw = w - 2;
    if (ch > h - 2) ch = h - 2;
    if (cw < 2 || ch < 2) return;
    var x0 = 1 + rng.int(w - 1 - cw), y0 = 1 + rng.int(h - 1 - ch);
    for (var y = y0; y < y0 + ch; y++) for (var x = x0; x < x0 + cw; x++) cells[idx(x, y, w)] &= ~W;
  }

  /* Goals packed into one corner region instead of spread across the board.
   * A box on the far side of a 15x15 grid then sits ~20 pushes from the
   * nearest mark rather than ~6, which is what lifts the achievable par on
   * the hard tiers — measured 8 -> 12 median, 19 -> 25 max on Expert.      */
  function clusterGoals(cells, w, h, rng, k, corner) {
    var floor = [], i, x, y;
    for (i = 0; i < cells.length; i++) if (!(cells[i] & W)) floor.push(i);
    if (floor.length < k * 3 + 5) return null;
    var sx = corner & 1 ? w - 2 : 1, sy = corner & 2 ? h - 2 : 1;
    var chosen = [];
    for (var r = 0; r < Math.max(w, h) && chosen.length < k; r++) {
      var cand = [];
      for (var ci = 0; ci < floor.length; ci++) {
        var c = floor[ci];
        if (chosen.indexOf(c) >= 0) continue;
        x = c % w; y = (c / w) | 0;
        if (Math.abs(x - sx) <= r && Math.abs(y - sy) <= r) cand.push(c);
      }
      while (cand.length && chosen.length < k) chosen.push(cand.splice(rng.int(cand.length), 1)[0]);
    }
    return chosen.length === k ? chosen : null;
  }

  /* --------------------------------------------------------------- goals */
  function pickGoals(cells, w, h, rng, k, cfg) {
    var floor = [], i, x, y;
    for (i = 0; i < cells.length; i++) if (!(cells[i] & W)) floor.push(i);
    if (floor.length < k * 3 + 5) return null;

    if (cfg.cluster) return clusterGoals(cells, w, h, rng, k, rng.int(4));

    var sep = cfg.sep;
    while (sep >= 0) {
      var pool = floor.filter(function (c) {
        x = c % w; y = (c / w) | 0;
        return openNeighbours(cells, w, h, x, y) >= (cfg.styles[0] === 'open' ? 2 : 1);
      });
      if (pool.length < k) { sep--; continue; }
      for (var attempt = 0; attempt < 300; attempt++) {
        var chosen = [], ok = true;
        for (var n = 0; n < k; n++) {
          var c = pool[rng.int(pool.length)];
          if (chosen.indexOf(c) >= 0) { ok = false; break; }
          for (var m = 0; m < chosen.length; m++) {
            var ax = Math.abs((c % w) - (chosen[m] % w));
            var ay = Math.abs(((c / w) | 0) - ((chosen[m] / w) | 0));
            if (Math.max(ax, ay) < sep) { ok = false; break; }
          }
          if (!ok) break;
          chosen.push(c);
        }
        if (ok && chosen.length === k) return chosen;
      }
      sep--;
    }
    return null;
  }

  /* ----------------------------------------------------------- scrambling */
  /* Pull boxes backwards out of the solved state. Only pulls the player can
   * genuinely reach are considered, and no pull may leave a box in a static
   * trap, so reversing the pull list is always a real, walkable, valid
   * forward solution.
   *
   * Pass `state` (a previous result) to keep pulling from where that left off
   * — the generator uses this to harden a level until it reaches its band.  */
  function scramble(rng, cfg, layout, goals, kBoxes, goalSet, state, budget) {
    var c2, w, h, boxes, player, pulls, walks, visit, i, d;
    var boxSet = {};

    if (state) {
      c2 = state.cells.slice();
      w = state.w; h = state.h;
      boxes = state.boxes.slice();
      player = state.player;
      /* Copy rather than share: keep() truncates these back to the best
       * snapshot, and the caller's arrays must survive untouched.          */
      pulls = state.pulls.slice(); walks = state.walks.slice();
      visit = {};
      for (var vk in state.visit) visit[vk] = state.visit[vk];
      for (i = 0; i < boxes.length; i++) boxSet[boxes[i]] = 1;
    } else {
      c2 = layout.cells.slice();
      w = layout.w; h = layout.h;
      boxes = goals.slice();
      for (i = 0; i < boxes.length; i++) { c2[boxes[i]] |= B; boxSet[boxes[i]] = 1; }
      var floor = [];
      for (i = 0; i < c2.length; i++) if (!(c2[i] & W) && !boxSet[i]) floor.push(i);
      if (!floor.length) return null;
      player = rng.pick(floor);
      c2[player] |= P;
      pulls = []; walks = []; visit = {};
    }

    var rounds = budget || cfg.pulls;
    function isBox(ci) { return !!boxSet[ci]; }
    /* box occupancy as it would be *after* a candidate pull: the box has moved
     * out of `box` and into the cell the player was standing on.            */
    function isBox2(cand) {
      return function (ci) { return ci === cand.box ? false : (ci === cand.from ? true : !!boxSet[ci]); };
    }
    var last = null;

    /* A long chain usually drifts back towards its marks near the end, so the
     * last position is rarely the hardest one — measured trails peak halfway
     * and then sag. Every prefix of a pull chain is itself a legal reverse
     * solution, so we simply remember the toughest snapshot seen and hand that
     * back instead of the final state.                                      */
    function scoreOf(list) {
      var s = 0;
      for (var j = 0; j < list.length; j++) s += goalDist(list[j], goals, w);
      return s;
    }
    function countOff(list) {
      var n = 0;
      for (var j = 0; j < list.length; j++) if (!(c2[list[j]] & G)) n++;
      return n;
    }
    var bestScore = -1, best = null;
    function keep() {
      var off = countOff(boxes);
      if (off < 1) return;                       /* an all-solved board is no level */
      var sc = scoreOf(boxes);
      if (sc <= bestScore) return;
      var v = {};
      for (var kk in visit) v[kk] = visit[kk];
      bestScore = sc;
      best = { cells: c2.slice(), boxes: boxes.slice(), player: player,
               pulls: pulls.slice(), walks: walks.slice(), visit: v, score: sc };
    }
    keep();   /* the state we were handed is the floor to beat */

    for (var r = 0; r < rounds; r++) {
      var step = pulls.length;                 /* monotonic across resumes */
      var reach = flood(c2, w, h, player, { has: isBox });
      var cand = [], weights = [], total = 0;
      for (var li = 0; li < reach.list.length; li++) {
        var p = reach.list[li];
        var px = p % w, py = (p / w) | 0;
        for (d = 0; d < 4; d++) {
          var dx = DIRS[d].dx, dy = DIRS[d].dy;
          var bx = px - dx, by = py - dy;
          if (bx < 0 || by < 0 || bx >= w || by >= h) continue;
          var b = idx(bx, by, w);
          if (!boxSet[b]) continue;
          /* Never immediately push a box back where it just came from. Note the
           * undo is the OPPOSITE direction to the pull that put it here; the
           * same direction is a legitimate continuation of a straight drag.  */
          if (last && (last.dir + 2) % 4 === d && last.from === b) continue;
          var cx = px + dx, cy = py + dy;
          if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
          var cc = idx(cx, cy, w);
          if (c2[cc] & (W | B)) continue;   /* the player needs somewhere to land */
          /* The pull drags the box into the cell the player is standing on (p),
           * so it is p — not cc, which is only where the player ends up — that
           * must be checked for a trap, weighted for gain and de-duplicated. */
          if (boxDeadlocked(c2, w, h, p, goalSet)) continue;  /* never park a box in a trap */

          /* Bias hard towards dragging boxes away from their marks, and away
           * from cells a box has only just occupied — that is what turns a
           * lazy wander into a genuinely tangled start position.            */
          var gain = goalDist(p, goals, w) - goalDist(b, goals, w);
          var wt = gain > 0 ? 2 + gain * 5 : 0.15;
          var lv = visit[p];
          if (lv !== undefined && step - lv < 24) wt *= 0.10;
          wt += rng.float() * 0.4;
          cand.push({ from: p, box: b, to: cc, dir: d });
          weights.push(wt);
          total += wt;
        }
      }
      if (!cand.length) break;

      /* A pull can wall the puller into a pocket — after which the chain is
       * stone dead (measured: chains stall at 35-84 of a 200+ budget once the
       * player is down to one reachable cell). So test the chosen move, and
       * any that strands the player is discarded for the next-best one.      */
      var pick = null, guard;
      for (guard = 0; guard < 8 && cand.length; guard++) {
        var rr = rng.float() * total, acc = 0, mi = cand.length - 1;
        for (i = 0; i < weights.length; i++) { acc += weights[i]; if (rr <= acc) { mi = i; break; } }
        var candMi = cand[mi];
        /* simulate the pull and see how much room the player keeps */
        var savedP = c2[candMi.from], savedBox = c2[candMi.box], savedTo = c2[candMi.to];
        c2[candMi.from] = (c2[candMi.from] & ~P) | B;
        c2[candMi.box] &= ~B;
        c2[candMi.to] = (c2[candMi.to] & ~B) | P;
        var room = flood(c2, w, h, candMi.to, { has: isBox2(candMi) }).list.length;
        c2[candMi.from] = savedP; c2[candMi.box] = savedBox; c2[candMi.to] = savedTo;
        /* Keep at least 60% of the room we had (floored at 4): a pull that
         * whittles the player down to a pocket ends the chain, and one such
         * move at pull 20 of a 420 budget costs more difficulty than any
         * single drag could ever add. */
        var need = Math.max(4, (reach.list.length * 0.6) | 0);
        if (room >= need) { pick = candMi; break; }
        cand.splice(mi, 1); weights.splice(mi, 1);
        total = 0;
        for (i = 0; i < weights.length; i++) total += weights[i];
        if (!cand.length) break;
      }
      if (!pick) break;

      /* the reverse-player walks from here to pick.from, then pulls */
      var walk = walkPath(reach.pred, w, player, pick.from);
      walks.push(walk || []);
      visit[pick.from] = step;

      delete boxSet[pick.box];
      boxSet[pick.from] = 1;
      c2[player] &= ~P;             /* player walks to pick.from, leaving  */
      c2[pick.box] &= ~B;           /* box leaves its cell                  */
      c2[pick.from] |= B;           /* box arrives where the player stood   */
      c2[pick.to] |= P;             /* player arrives                       */
      player = pick.to;
      pulls.push(pick.dir);          /* forward push is the opposite dir */
      last = pick;
      keep();                        /* remember this position if it is tougher */
    }

    /* Hand back the hardest position seen rather than the last one. The
     * recorded pull chain is truncated to match, so the reverse solution
     * still lands exactly on this state.                                    */
    if (best && best.score > scoreOf(boxes)) {
      c2 = best.cells; boxes = best.boxes; player = best.player;
      pulls = best.pulls; walks = best.walks; visit = best.visit;
      boxSet = {};
      for (i = 0; i < boxes.length; i++) boxSet[boxes[i]] = 1;
    }

    var out = [], offGoals = 0;
    for (i = 0; i < c2.length; i++) if (boxSet[i]) {
      out.push(i);
      if (!(c2[i] & G)) offGoals++;
    }
    return { cells: c2, w: w, h: h, player: player, boxes: out, pulls: pulls, walks: walks, visit: visit, offGoals: offGoals };
  }

  /* Reverse the recorded pull chain into a forward step string. Every pull is
   * a legal inverse push and every recorded walk was genuinely reachable, so
   * this always solves the level — it is the safety net used when the BFS
   * solver runs out of budget on a monster level.                            */
  function pullSolution(pulls, walks) {
    var fwd = [];
    for (var i = pulls.length - 1; i >= 0; i--) {
      fwd.push((pulls[i] + 2) % 4);                       /* the push itself */
      var wpath = walks[i] || [];
      for (var j = wpath.length - 1; j >= 0; j--) fwd.push((wpath[j] + 2) % 4);
    }
    return fwd.join('');
  }

  /* Manhattan distance to the nearest mark. Pushes move a box one cell at a
   * time, so this — not Chebyshev — is the quantity that becomes par.       */
  function goalDist(ci, goals, w) {
    var x = ci % w, y = (ci / w) | 0, best = 999;
    for (var i = 0; i < goals.length; i++) {
      var d = Math.abs((goals[i] % w) - x) + Math.abs(((goals[i] / w) | 0) - y);
      if (d < best) best = d;
    }
    return best;
  }

  /* ------------------------------------------------- static deadlock test */
  /* A box that is not on its mark can never be freed if:
   *   · it sits in a corner (walls on two perpendicular sides), or
   *   · it lies against a wall line with no mark AND no way off that line
   *     anywhere along it — the wall has to span the whole open segment
   *     before the box is truly trapped (it can slide to where the wall ends
   *     and be pushed away there).                                           */
  function boxDeadlocked(cells, w, h, b, goalSet) {
    if (goalSet[b]) return false;
    var x = b % w, y = (b / w) | 0, c;
    var up = y === 0 || !!(cells[b - w] & W);
    var down = y === h - 1 || !!(cells[b + w] & W);
    var left = x === 0 || !!(cells[b - 1] & W);
    var right = x === w - 1 || !!(cells[b + 1] & W);
    if ((up || down) && (left || right)) return true;             /* corner   */

    /* Is there a column (or row) along this line where the box can be pushed
     * off the line? It needs floor on both perpendicular sides. */
    function canLeaveVertically(cx) {
      return cx > 0 && cx < w - 1 && y > 0 && y < h - 1 &&
        !(cells[idx(cx, y - 1, w)] & W) && !(cells[idx(cx, y + 1, w)] & W);
    }
    function canLeaveHorizontally(cy) {
      return cy > 0 && cy < h - 1 && x > 0 && x < w - 1 &&
        !(cells[idx(x - 1, cy, w)] & W) && !(cells[idx(x + 1, cy, w)] & W);
    }

    if (up || down) {                                             /* wall line */
      var lx = x, rx = x, safe = false;
      while (lx > 0 && !(cells[idx(lx - 1, y, w)] & W)) {
        lx--; c = idx(lx, y, w);
        if (goalSet[c] || canLeaveVertically(lx)) safe = true;
      }
      while (rx < w - 1 && !(cells[idx(rx + 1, y, w)] & W)) {
        rx++; c = idx(rx, y, w);
        if (goalSet[c] || canLeaveVertically(rx)) safe = true;
      }
      if (!safe) return true;
    }
    if (left || right) {
      var ty = y, byy = y;
      safe = false;
      while (ty > 0 && !(cells[idx(x, ty - 1, w)] & W)) {
        ty--; c = idx(x, ty, w);
        if (goalSet[c] || canLeaveHorizontally(ty)) safe = true;
      }
      while (byy < h - 1 && !(cells[idx(x, byy + 1, w)] & W)) {
        byy++; c = idx(x, byy, w);
        if (goalSet[c] || canLeaveHorizontally(byy)) safe = true;
      }
      if (!safe) return true;
    }
    return false;
  }

  function isDeadlocked(cells, w, h, boxes, goalSet) {
    for (var i = 0; i < boxes.length; i++) {
      if (boxDeadlocked(cells, w, h, boxes[i], goalSet)) return true;
    }
    return false;
  }

  /* ------------------------------------------------------------ the solver */
  /* A* over *push* states, so the answer is the minimum number of pushes. The
   * heuristic sums each box's Manhattan distance to its nearest mark: it
   * ignores walls and box-box conflict, which keeps it admissible (never
   * overestimates) and consistent (each push moves it by at most 1), so the
   * first time a state is generated it is already on an optimal path. Against
   * plain breadth-first that is the difference between proving a 30-push
   * optimum and running out of budget at 10.
   *
   * Each node keeps the walk it took to reach the push, giving a full
   * step-by-step solution for the in-game Solve button.                     */
  function solve(cells, w, h, player, boxes, opts) {
    opts = opts || {};
    var nodeCap = opts.nodeCap || 60000;
    var timeCap = opts.timeCap || 250;
    var t0 = now();

    var goalSet = {};
    var goals = [];
    var i;
    for (i = 0; i < cells.length; i++) if (cells[i] & G) { goalSet[i] = 1; goals.push(i); }
    var allGoals = goals.length;

    function solved(list) {
      for (var j = 0; j < list.length; j++) if (!goalSet[list[j]]) return false;
      return true;
    }

    function heuristic(boxList) {
      var s = 0, j, q, b, bx, by, best, d;
      for (j = 0; j < boxList.length; j++) {
        b = boxList[j]; bx = b % w; by = (b / w) | 0; best = 1e9;
        for (q = 0; q < goals.length; q++) {
          d = Math.abs((goals[q] % w) - bx) + Math.abs(((goals[q] / w) | 0) - by);
          if (d < best) best = d;
        }
        s += best;
      }
      return s;
    }

    /* binary heap keyed on (f, insertion order) — the order tie-break keeps
     * generation deterministic, which the test suite asserts.               */
    var hF = [], hI = [], hS = [], seq = 0;
    function less(a, b) { return hF[a] < hF[b] || (hF[a] === hF[b] && hS[a] < hS[b]); }
    function swap(a, b) {
      var tf = hF[a]; hF[a] = hF[b]; hF[b] = tf;
      var ti = hI[a]; hI[a] = hI[b]; hI[b] = ti;
      var ts = hS[a]; hS[a] = hS[b]; hS[b] = ts;
    }
    function hPush(f, idx) {
      hF.push(f); hI.push(idx); hS.push(seq++);
      var c = hF.length - 1;
      while (c > 0) {
        var p = (c - 1) >> 1;
        if (less(c, p)) { swap(c, p); c = p; } else break;
      }
    }
    function hPop() {
      var top = hI[0];
      var li = hI.pop(), lf = hF.pop(), ls = hS.pop();
      if (hI.length) {
        hI[0] = li; hF[0] = lf; hS[0] = ls;
        var c = 0;
        for (;;) {
          var l = c * 2 + 1, r = l + 1, m = c;
          if (l < hI.length && less(l, m)) m = l;
          if (r < hI.length && less(r, m)) m = r;
          if (m === c) break;
          swap(m, c); c = m;
        }
      }
      return top;
    }

    var startBoxes = boxes.slice().sort(function (a, b) { return a - b; });
    if (startBoxes.length === allGoals && solved(startBoxes)) {
      return { pushes: 0, steps: [], explored: 0 };
    }
    var startH = heuristic(startBoxes);
    var nodes = [{ boxes: startBoxes, player: player, parent: -1, push: -1,
                   walk: null, g: 0, h: startH }];
    var seen = {};
    seen[keyOf(startBoxes, player)] = 1;
    hPush(startH, 0);
    var found = -1, expanded = 0;

    while (hI.length) {
      if (nodes.length >= nodeCap) break;
      if ((expanded & 31) === 0 && now() - t0 > timeCap) break;
      var ci = hPop();
      var n = nodes[ci];
      expanded++;
      if (n.boxes.length === allGoals && solved(n.boxes)) { found = ci; break; }

      var boxSet = {};
      for (i = 0; i < n.boxes.length; i++) boxSet[n.boxes[i]] = 1;
      var reach = flood(cells, w, h, n.player, { has: function (c) { return !!boxSet[c]; } });

      for (var bi = 0; bi < n.boxes.length; bi++) {
        var b = n.boxes[bi], bx = b % w, by = (b / w) | 0;
        for (var d = 0; d < 4; d++) {
          var fx = bx - DIRS[d].dx, fy = by - DIRS[d].dy;
          if (fx < 0 || fy < 0 || fx >= w || fy >= h) continue;
          var from = idx(fx, fy, w);
          if (!reach.seen[from]) continue;
          var tx = bx + DIRS[d].dx, ty = by + DIRS[d].dy;
          if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
          var to = idx(tx, ty, w);
          if ((cells[to] & W) || boxSet[to]) continue;

          var nb = n.boxes.slice();
          nb[bi] = to;
          nb.sort(function (a, c) { return a - c; });
          var k = keyOf(nb, b);   /* the pusher ends where the box was */
          if (seen[k] !== undefined) continue;
          if (!goalSet[to] && boxDeadlocked(cells, w, h, to, goalSet)) continue;

          var walk = walkPath(reach.pred, w, n.player, from);
          if (!walk) continue;
          seen[k] = 1;
          var g2 = n.g + 1, h2 = heuristic(nb);
          nodes.push({ boxes: nb, player: b, parent: ci, push: d,
                       walk: walk, g: g2, h: h2 });
          hPush(g2 + h2, nodes.length - 1);
        }
      }
    }

    if (found < 0) return null;

    var steps = [], pushes = 0, cur = found;
    /* Built back-to-front, so each edge contributes push-then-reversed-walk;
     * the final reverse() turns the whole thing into a forward solution.   */
    while (cur > 0) {
      var nd = nodes[cur];
      pushes++;
      steps.push(nd.push);
      if (nd.walk) for (var q = nd.walk.length - 1; q >= 0; q--) steps.push(nd.walk[q]);
      cur = nd.parent;
    }
    steps.reverse();
    return { pushes: pushes, steps: steps, explored: nodes.length };
  }

  function keyOf(boxes, player) {
    var s = '';
    for (var i = 0; i < boxes.length; i++) s += boxes[i] + ',';
    return s + ';' + player;
  }

  /* ------------------------------------------------------- level assembly */
  function toRows(data) {
    var rows = [];
    for (var y = 0; y < data.h; y++) {
      var row = '';
      for (var x = 0; x < data.w; x++) {
        var c = data.cells[idx(x, y, data.w)];
        if (c & W) row += '#';
        else if (c & B) row += (c & G ? '*' : '$');
        else if (c & P) row += (c & G ? '+' : '@');
        else if (c & G) row += '.';
        else row += ' ';
      }
      rows.push(row);
    }
    return rows;
  }

  function buildLevel(num, cfg, data, sol) {
    var board = { w: data.w, h: data.h, cells: data.cells, boxes: data.boxes, player: data.player };
    var steps = sol ? sol.steps.join('') : '';
    var verified = false;

    /* Belt and braces: never ship a solution that does not actually solve the
     * board it ships with. The solver path is checked first, then the
     * reverse-pull chain, which is built to be valid by construction. */
    if (steps && replay(board, steps)) {
      verified = true;
    } else {
      steps = data.pulls.length ? pullSolution(data.pulls, data.walks) : '';
      sol = null;
      if (!steps || !replay(board, steps)) steps = '';
    }

    var level = {
      num: num,
      tier: cfg.name,
      w: data.w,
      h: data.h,
      rows: toRows(data),
      /* par is only published when the BFS proved it is the true optimum;
       * otherwise the game simply shows no par rather than a guess. */
      par: verified ? sol.pushes : 0,
      verified: verified,
      solution: steps,
      boxes: data.boxes.length,
      /* a level that starts with every box already on its mark is no level */
      valid: !!steps && data.offGoals >= 1
    };
    return level;
  }

  /* ---------------------------------------------------------- generation */
  function generate(num) {
    var cfg = tierFor(num);
    /* Higher tiers need a bigger slice: a 15x16 board with 5 boxes can burn
     * the whole solver budget on one attempt, and the harden loop — which is
     * what actually raises par — never gets its rounds in. */
    var deadline = now() + 1300 + cfg.index * 130;
    var best = null;

    for (var attempt = 0; attempt < cfg.attempts; attempt++) {
      if (now() > deadline) break;
      var rng = new RNG(num * 7919 + attempt * 104729 + 1013);
      var style = cfg.styles[rng.int(cfg.styles.length)];
      var layout = makeLayout(rng, cfg, style);
      if (!layout) continue;
      if (floorCount(layout.cells) < cfg.boxes[1] * 3 + 5) continue;

      var kBoxes = cfg.boxes[0] + rng.int(cfg.boxes[1] - cfg.boxes[0] + 1);
      var goals = pickGoals(layout.cells, layout.w, layout.h, rng, kBoxes, cfg);
      if (!goals) continue;
      for (var gi = 0; gi < goals.length; gi++) layout.cells[goals[gi]] |= G;

      var goalSet = {};
      for (var gi2 = 0; gi2 < goals.length; gi2++) goalSet[goals[gi2]] = 1;

      var scr = scramble(rng, cfg, layout, goals, kBoxes, goalSet, null, cfg.pulls);
      if (!scr || scr.boxes.length !== kBoxes) continue;

      /* Harden: ask the solver what this start position really costs, and if
       * it is too gentle, keep pulling until it is not. Every exit must leave
       * `sol` matching `scr`, so the deadline is checked straight after a
       * solve and never after `scr` has been swapped out. */
      var sol = null, pushes = 0;
      for (var round = 0; round < 4; round++) {
        if (now() > deadline) break;
        sol = solve(scr.cells, scr.w, scr.h, scr.player, scr.boxes, {
          nodeCap: cfg.solverNodes,
          timeCap: cfg.solverMs
        });
        pushes = sol ? sol.pushes : scr.pulls.length;
        /* Never leave the loop having swapped `scr` without re-solving it:
         * that would pair a solution with the wrong board. */
        if (pushes >= cfg.min || round === 3 ||
            scr.pulls.length >= cfg.pulls * 3) break;
        var more = scramble(rng, cfg, layout, goals, kBoxes, goalSet, scr, Math.max(24, (cfg.pulls * 0.45) | 0));
        if (!more || more.boxes.length !== kBoxes || more.offGoals < 1) break;
        scr = more;
      }
      if (!sol) {
        /* No proof of the true optimum — still a perfectly good, solvable
         * level (the reverse-pull chain proves it), just without a published
         * par. Only keep one if nothing better has turned up. */
        var lvl0 = buildLevel(num, cfg, scr, null);
        if (lvl0.valid && !best) {
          best = { level: lvl0, quality: -100000, inBand: false, verified: false };
        }
        if (now() > deadline) break;
        continue;
      }

      var level = buildLevel(num, cfg, scr, sol);
      if (!level.valid) continue;

      var inBand = level.par >= cfg.min && level.par <= cfg.max;
      var mid = (cfg.min + cfg.max) / 2;
      var quality = inBand
        ? 1000 - Math.abs(level.par - mid)
        : (level.par < cfg.min ? -(cfg.min - level.par) * 8 : -(level.par - cfg.max));

      if (!best || quality > best.quality) {
        best = { level: level, quality: quality, inBand: inBand, verified: true };
      }
      if (inBand) break;
      if (now() > deadline) break;
    }

    if (!best) {
      /* Vanishingly rare: relax the band entirely rather than fail. */
      var cfg2 = {};
      for (var kk in cfg) cfg2[kk] = cfg[kk];
      cfg2.min = 1; cfg2.max = 9999; cfg2.attempts = 12; cfg2.pulls = Math.max(cfg.pulls, 30);
      return generateWith(num, cfg2);
    }
    return best.level;
  }

  function generateWith(num, cfg) {
    for (var attempt = 0; attempt < cfg.attempts; attempt++) {
      var rng = new RNG(num * 7919 + attempt * 104729 + 1013);
      var style = cfg.styles[rng.int(cfg.styles.length)];
      var layout = makeLayout(rng, cfg, style);
      if (!layout) continue;
      var kBoxes = cfg.boxes[0] + rng.int(cfg.boxes[1] - cfg.boxes[0] + 1);
      var goals = pickGoals(layout.cells, layout.w, layout.h, rng, kBoxes, cfg);
      if (!goals) continue;
      for (var gi = 0; gi < goals.length; gi++) layout.cells[goals[gi]] |= G;
      var goalSet = {};
      for (var gj = 0; gj < goals.length; gj++) goalSet[goals[gj]] = 1;
      var scr = scramble(rng, cfg, layout, goals, kBoxes, goalSet, null, cfg.pulls);
      if (!scr || scr.boxes.length !== kBoxes) continue;
      if (scr.offGoals < 1) continue;
      var sol = solve(scr.cells, scr.w, scr.h, scr.player, scr.boxes, { nodeCap: 90000, timeCap: 500 });
      var lvl = buildLevel(num, cfg, scr, sol);
      if (lvl.valid) return lvl;
    }
    return lastResort(num, cfg);
  }

  /* Absolute fallback: a hand-placed two-push puzzle. Never reached in
   * practice, but it means generate() can never throw.                     */
  function lastResort(num, cfg) {
    var w = Math.max(6, cfg.size[1]), h = Math.max(6, cfg.size[1]);
    var cells = new Uint8Array(w * h);
    cells.fill(W);
    var x, y;
    for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) cells[idx(x, y, w)] = 0;
    var goal = idx(1, 2, w), box = idx(3, 2, w), player = idx(4, 2, w);
    cells[goal] |= G;
    cells[box] |= B;
    cells[player] |= P;
    /* Reverse chain: two rightwards pulls out of the solved state, so the
     * forward solution is two left pushes — box 3,2 -> 2,2 -> 1,2 (the mark). */
    var data = {
      cells: cells, w: w, h: h, player: player, boxes: [box],
      pulls: [1, 1], walks: [[], []], offGoals: 1
    };
    return buildLevel(num, cfg, data, null);
  }

  /* ------------------------------------------------------ (de)serialisation */
  function serialize(level) {
    return level.rows.join('\n') + '\n@' + level.par + (level.verified ? 'v' : '') + '\n@' + level.tier + '\n@' + (level.solution || '');
  }

  function parse(text, num) {
    var parts = text.split('\n@');
    var rows = parts[0].split('\n');
    var h = rows.length;
    var w = rows[0].length;
    var cells = new Uint8Array(w * h);
    var boxes = [], player = -1, i, x, y, ch, at;

    for (y = 0; y < h; y++) {
      var row = rows[y];
      for (x = 0; x < w; x++) {
        ch = x < row.length ? row[x] : ' ';
        at = idx(x, y, w);
        if (ch === '#') cells[at] |= W;
        if (ch === '.' || ch === '*' || ch === '+') cells[at] |= G;
        if (ch === '$' || ch === '*') boxes.push(at);
        if (ch === '@' || ch === '+') player = at;
      }
    }
    return {
      num: num,
      tier: parts[2] || tierFor(num).name,
      w: w, h: h, rows: rows,
      cells: cells,
      boxes: boxes,
      player: player,
      par: parseInt(parts[1], 10) || 0,
      verified: /\dv$/.test(parts[1] || ''),
      solution: parts[3] || ''
    };
  }

  /* Replay a step string from a parsed level; used by the test suite to prove
   * every stored solution actually works.                                   */
  function replay(level, steps) {
    var w = level.w, h = level.h;
    var cells = level.cells;
    var boxes = {};
    var i;
    for (i = 0; i < level.boxes.length; i++) boxes[level.boxes[i]] = 1;
    var player = level.player;
    var pushes = 0;

    for (i = 0; i < steps.length; i++) {
      var d = +steps.charAt(i);
      if (!(d >= 0 && d < 4)) return null;
      var dx = DIRS[d].dx, dy = DIRS[d].dy;
      var nx = (player % w) + dx, ny = ((player / w) | 0) + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) return null;
      var ni = idx(nx, ny, w);
      if (cells[ni] & W) return null;
      if (boxes[ni]) {
        var tx = nx + dx, ty = ny + dy;
        if (tx < 0 || ty < 0 || tx >= w || ty >= h) return null;
        var ti = idx(tx, ty, w);
        if ((cells[ti] & W) || boxes[ti]) return null;
        delete boxes[ni];
        boxes[ti] = 1;
        pushes++;
      }
      player = ni;
    }
    var goalSet = {};
    for (var c = 0; c < cells.length; c++) if (cells[c] & G) goalSet[c] = 1;
    for (var b in boxes) if (!goalSet[b]) return null;
    return { pushes: pushes, solved: true };
  }

  POCO.Levels = {
    MAX_LEVEL: MAX_LEVEL,
    TIERS: TIERS,
    DIRS: DIRS,
    FLAGS: { W: W, G: G, B: B, P: P },
    tierFor: tierFor,
    generate: generate,
    serialize: serialize,
    parse: parse,
    solve: solve,
    replay: replay,
    isDeadlocked: isDeadlocked,
    boxDeadlocked: boxDeadlocked,
    flood: flood,
    makeLayout: makeLayout,
    pickGoals: pickGoals,
    scramble: scramble,
    lastResort: lastResort
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = POCO.Levels;
  }
})(typeof window !== 'undefined' ? window : globalThis);
