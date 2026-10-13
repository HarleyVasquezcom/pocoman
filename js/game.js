/* Core play state: holds the live board (player + boxes) on top of the static
 * level grid, applies moves, tracks push/step counts, maintains an undo
 * history, and can auto-solve using the level's stored solution. */
(function (global) {
  'use strict';
  var POCO = global.POCO || (global.POCO = {});
  var DIRS = POCO.Levels.DIRS;
  var FLAGS = POCO.Levels.FLAGS;
  var W = FLAGS.W, G = FLAGS.G;

  var State = { MENU: 0, PLAY: 1, PAUSED: 2, WON: 3 };
  POCO.State = State;

  function idx(x, y, w) { return y * w + x; }

  function Game() {
    this.state = State.MENU;
    this.level = null;        /* parsed level (static grid + start) */
    this.cells = null;        /* Uint8Array: W and G flags */
    this.w = 0; this.h = 0;
    this.goals = {};          /* set of goal indices */
    this.startBoxes = [];
    this.startPlayer = 0;
    this.boxes = {};          /* live set */
    this.boxList = [];        /* live array for rendering */
    this.player = 0;
    this.pushes = 0;
    this.steps = 0;
    this.history = [];        /* undo stack of {dir, pushed, boxFrom, boxTo} */
    this.won = false;
    this.onEvent = null;      /* callback(name, payload) for sound/UI hooks */
  }

  /* Load a parsed level (from Levels.parse or a generated level converted). */
  Game.prototype.load = function (level) {
    this.level = level;
    this.w = level.w; this.h = level.h;
    this.cells = level.cells;
    this.goals = {};
    for (var i = 0; i < level.cells.length; i++) if (level.cells[i] & G) this.goals[i] = 1;
    this.startBoxes = level.boxes.slice();
    this.startPlayer = level.player;
    this.reset(true);
  };

  /* Reset to the level's starting position. `silent` suppresses the event so
   * load() doesn't fire a spurious sound. */
  Game.prototype.reset = function (silent) {
    this.boxes = {};
    this.boxList = [];
    for (var i = 0; i < this.startBoxes.length; i++) {
      this.boxes[this.startBoxes[i]] = true;
      this.boxList.push(this.startBoxes[i]);
    }
    this.player = this.startPlayer;
    this.pushes = 0;
    this.steps = 0;
    this.history = [];
    this.won = false;
    if (this.state !== State.MENU) this.state = State.PLAY;
    if (!silent) this._emit('reset');
  };

  Game.prototype.attempt = function (cell) { return this.cells[cell]; };

  /* Try one move in direction d (0=up,1=right,2=down,3=left).
   * Returns true if the player actually moved. */
  Game.prototype.move = function (d) {
    if (this.state !== State.PLAY || this.won) return false;
    var dx = DIRS[d].dx, dy = DIRS[d].dy;
    var px = this.player % this.w, py = (this.player / this.w) | 0;
    var nx = px + dx, ny = py + dy;
    if (nx < 0 || ny < 0 || nx >= this.w || ny >= this.h) return false;
    var ni = idx(nx, ny, this.w);
    if (this.cells[ni] & W) { this._emit('bump'); return false; }

    var rec = { dir: d, pushed: false, boxFrom: -1, boxTo: -1 };
    if (this.boxes[ni]) {
      var tx = nx + dx, ty = ny + dy;
      if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return false;
      var ti = idx(tx, ty, this.w);
      if ((this.cells[ti] & W) || this.boxes[ti]) { this._emit('bump'); return false; }
      /* push the box */
      delete this.boxes[ni];
      this.boxes[ti] = true;
      this._swapBox(ni, ti);
      rec.pushed = true; rec.boxFrom = ni; rec.boxTo = ti;
      this.pushes++;
      this._emit('push', ti);
    }
    this.player = ni;
    this.steps++;
    this.history.push(rec);
    if (this._solved()) {
      this.won = true;
      this.state = State.WON;
      this._emit('win');
    }
    return true;
  };

  /* Undo the last move (and any box it pushed). Sokoban staples. */
  Game.prototype.undo = function () {
    if (!this.history.length || this.state === State.MENU) return false;
    /* leaving a won state back into play */
    if (this.won) { this.won = false; this.state = State.PLAY; }
    var rec = this.history.pop();
    var dx = DIRS[rec.dir].dx, dy = DIRS[rec.dir].dy;
    if (rec.pushed) {
      /* move box back from boxTo to boxFrom */
      delete this.boxes[rec.boxTo];
      this.boxes[rec.boxFrom] = true;
      this._swapBox(rec.boxTo, rec.boxFrom);
      this.pushes--;
    }
    /* step player backwards */
    var px = this.player % this.w, py = (this.player / this.w) | 0;
    this.player = idx(px - dx, py - dy, this.w);
    this.steps--;
    this._emit('undo');
    return true;
  };

  /* Auto-solve by replaying the stored solution step string. Returns the
   * number of steps applied, or -1 if there is no usable solution. */
  Game.prototype.solve = function () {
    if (!this.level || !this.level.solution) return -1;
    /* start from a clean slate so the solution always applies */
    this.reset(true);
    var steps = this.level.solution;
    var applied = 0;
    for (var i = 0; i < steps.length; i++) {
      var d = +steps.charAt(i);
      if (this.move(d)) applied++;
    }
    return applied;
  };

  Game.prototype._solved = function () {
    for (var b in this.boxes) if (!this.goals[b]) return false;
    return true;
  };

  /* Keep boxList aligned with the box set for the renderer. */
  Game.prototype._swapBox = function (from, to) {
    var i = this.boxList.indexOf(from);
    if (i >= 0) this.boxList[i] = to;
  };

  Game.prototype._emit = function (name, payload) {
    if (this.onEvent) this.onEvent(name, payload);
  };

  /* Remaining boxes not yet on a mark — used by the HUD. */
  Game.prototype.offGoals = function () {
    var n = 0;
    for (var b in this.boxes) if (!this.goals[b]) n++;
    return n;
  };

  POCO.Game = Game;
})(typeof window !== 'undefined' ? window : globalThis);
