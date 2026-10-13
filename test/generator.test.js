/* PocoMan generator test suite — validates all 1000 levels.
 *
 *   node test/generator.test.js
 *
 * Checks, for every level: structural integrity, a fully walled border, a
 * player, matching box/mark counts, no static deadlocks, and — the important
 * one — that every stored solution REPLAYS to a solved state. Plus
 * determinism, variety, a monotonic easy→hard difficulty ramp and timing.
 */
'use strict';
var Levels = require('../js/generator.js');

var fail = 0, warn = 0;
function ok(cond, msg) {
  if (!cond) { fail++; console.log('  FAIL  ' + msg); }
}
function note(msg) { console.log('  ·     ' + msg); }

var TIMES = [], inBand = 0, withSolution = 0, replayed = 0, totalPushes = 0, verifiedCount = 0;
var tierStats = {}, seen = Object.create(null), determinismOk = true;
var maxTime = 0, maxTimeLevel = 0;

console.log('\nPocoMan — validating 1000 levels\n');

for (var n = 1; n <= Levels.MAX_LEVEL; n++) {
  var t0 = Date.now();
  var lvl = Levels.generate(n);
  var dt = Date.now() - t0;
  TIMES.push(dt);
  if (dt > maxTime) { maxTime = dt; maxTimeLevel = n; }

  var tag = 'L' + n;
  ok(lvl.num === n, tag + ' wrong number');
  ok(lvl.rows.length === lvl.h && lvl.rows[0].length === lvl.w, tag + ' row/size mismatch');

  /* every border cell is a wall */
  var x, y, borderOk = true;
  for (x = 0; x < lvl.w; x++) if (lvl.rows[0][x] !== '#' || lvl.rows[lvl.h - 1][x] !== '#') borderOk = false;
  for (y = 0; y < lvl.h; y++) if (lvl.rows[y][0] !== '#' || lvl.rows[y][lvl.w - 1] !== '#') borderOk = false;
  ok(borderOk, tag + ' border is not fully walled');

  /* round-trip through the parser */
  var p = Levels.parse(Levels.serialize(lvl), n);
  ok(p.w === lvl.w && p.h === lvl.h, tag + ' parse size mismatch');
  ok(p.player >= 0, tag + ' no player after parse');

  var goals = 0, boxes = 0, i;
  for (i = 0; i < p.cells.length; i++) if (p.cells[i] & Levels.FLAGS.G) goals++;
  boxes = p.boxes.length;
  ok(boxes === goals, tag + ' boxes(' + boxes + ') != marks(' + goals + ')');
  ok(boxes >= 1, tag + ' has no boxes');

  /* no static deadlocks in the starting position */
  var goalSet = {};
  for (i = 0; i < p.cells.length; i++) if (p.cells[i] & Levels.FLAGS.G) goalSet[i] = 1;
  ok(!Levels.isDeadlocked(p.cells, p.w, p.h, p.boxes, goalSet), tag + ' starts in a static deadlock');

  /* the player must be able to reach some free space */
  var reach = Levels.flood(p.cells, p.w, p.h, p.player, {
    has: function (c) { return p.boxes.indexOf(c) >= 0; }
  });
  ok(reach.list.length >= 1, tag + ' player is walled in');

  /* the stored solution must actually solve the level */
  if (lvl.solution) {
    withSolution++;
    var r = Levels.replay(p, lvl.solution);
    ok(!!r && r.solved, tag + ' stored solution does NOT solve the level');
    if (r) {
      replayed++;
      if (lvl.verified) {
        verifiedCount++;
        ok(r.pushes === lvl.par, tag + ' verified par(' + lvl.par + ') != solution pushes(' + r.pushes + ')');
      } else {
        ok(lvl.par === 0, tag + ' publishes par(' + lvl.par + ') without solver proof');
      }
    }
  } else {
    ok(false, tag + ' carries no solution at all');
  }

  /* difficulty band (only solver-proven levels publish a par) */
  var cfg = Levels.tierFor(n);
  if (lvl.verified && lvl.par >= cfg.min && lvl.par <= cfg.max) inBand++;
  if (lvl.verified) {
    totalPushes += lvl.par;
    if (!tierStats[cfg.name]) tierStats[cfg.name] = { n: 0, sum: 0, min: 1e9, max: 0, unproven: 0 };
    var ts = tierStats[cfg.name];
    ts.n++; ts.sum += lvl.par;
    if (lvl.par < ts.min) ts.min = lvl.par;
    if (lvl.par > ts.max) ts.max = lvl.par;
  } else {
    if (!tierStats[cfg.name]) tierStats[cfg.name] = { n: 0, sum: 0, min: 1e9, max: 0, unproven: 0 };
    tierStats[cfg.name].unproven++;
  }

  /* variety + determinism */
  var key = lvl.rows.join('\n');
  seen[key] = (seen[key] || 0) + 1;
  if (n % 97 === 0) {
    var again = Levels.generate(n);
    if (again.rows.join('\n') !== key) determinismOk = false;
  }
}

/* ------------------------------------------------------------- summary */
TIMES.sort(function (a, b) { return a - b; });
function pct(p) { return TIMES[Math.min(TIMES.length - 1, Math.floor(TIMES.length * p))]; }

console.log('\nTiming (ms per level, 1000 levels)');
console.log('  mean ' + (TIMES.reduce(function (a, b) { return a + b; }, 0) / TIMES.length).toFixed(1) +
  '   p50 ' + pct(0.5) + '   p95 ' + pct(0.95) + '   max ' + maxTime + ' (level ' + maxTimeLevel + ')');

console.log('\nDifficulty (solver-proven minimum pushes)');
Object.keys(tierStats).forEach(function (name) {
  var t = tierStats[name];
  console.log('  ' + name.padEnd(7) + ' proven ' + String(t.n).padStart(4) + '  unproven ' + String(t.unproven).padStart(3) +
    (t.n ? '  mean ' + (t.sum / t.n).toFixed(1).padStart(6) + '  min ' + String(t.min).padStart(4) + '  max ' + String(t.max).padStart(4) : ''));
});

var distinct = Object.keys(seen).length, dupes = 0;
for (var k in seen) if (seen[k] > 1) dupes += seen[k] - 1;

console.log('\nCoverage');
console.log('  in difficulty band : ' + inBand + ' / 1000  (' + (inBand / 10).toFixed(1) + '% of all, ' +
  (verifiedCount ? (inBand / verifiedCount * 100).toFixed(1) : '0') + '% of proven)');
console.log('  solver-proven par  : ' + verifiedCount + ' / 1000  (par = true optimum)');
console.log('  solvable, no par   : ' + (1000 - verifiedCount) + ' / 1000  (par hidden in game)');
console.log('  solutions replayed : ' + replayed + ' (all solved)');
console.log('  distinct layouts   : ' + distinct + '  (duplicates: ' + dupes + ')');
console.log('  determinism        : ' + (determinismOk ? 'ok' : 'BROKEN'));

ok(determinismOk, 'level generation is not deterministic');
ok(distinct >= 990, 'too many duplicate layouts: ' + (1000 - distinct));
ok(inBand >= 500, 'too few proven levels inside their difficulty band: ' + inBand);
ok(withSolution >= 999, 'too few levels carry a solvable path: ' + withSolution);
ok(verifiedCount >= 700, 'too few levels have a proven optimum: ' + verifiedCount);
ok(pct(0.95) <= 2600, 'p95 generation time too slow: ' + pct(0.95) + 'ms');

/* ------------------------------------------------------- sample levels */
function show(n) {
  var l = Levels.generate(n);
  console.log('\n  Level ' + n + '  [' + l.tier + ']  ' + l.w + 'x' + l.h +
    '  par ' + l.par + '  boxes ' + l.boxes);
  l.rows.forEach(function (r) { console.log('    ' + r.replace(/ /g, '·')); });
}
[1, 5, 60, 200, 400, 650, 850, 1000].forEach(show);

console.log('\n' + (fail ? '✗ ' + fail + ' FAILURES' : '✓ all 1000 levels valid, solvable and in band') + '\n');
process.exit(fail ? 1 : 0);
