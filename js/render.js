/* Canvas renderer: draws the Sokoban grid — walls, marks, boxes, player.
 * Cell size adapts to the board so a 6x6 tutorial and a 17x17 master puzzle
 * both fill the stage cleanly. */
(function (global) {
  'use strict';
  var POCO = global.POCO || (global.POCO = {});
  var FLAGS = POCO.Levels.FLAGS;
  var W = FLAGS.W, G = FLAGS.G;

  /* One palette per difficulty tier, keyed by tier name. */
  var THEMES = {
    Easy:   { wall: '#3d6bd6', wallTop: '#6f97ff', floor: '#0a1030', mark: '#2fd6a8', box: '#ffcf4d', boxTop: '#fff2b0', player: '#4fc3ff' },
    Medium: { wall: '#7a5bd6', wallTop: '#a98cff', floor: '#120c30', mark: '#4fe0b0', box: '#ffb84d', boxTop: '#ffe0a0', player: '#5bd6ff' },
    Hard:   { wall: '#c04d7a', wallTop: '#ff7aa8', floor: '#1a0820', mark: '#6ff0c0', box: '#ff9d4d', boxTop: '#ffd0a0', player: '#6fd6ff' },
    Expert: { wall: '#d64d4d', wallTop: '#ff7a7a', floor: '#1f0707', mark: '#8fffcf', box: '#ffe14d', boxTop: '#fff6b8', player: '#7ae6ff' },
    Master: { wall: '#c9a227', wallTop: '#ffe14d', floor: '#141002', mark: '#9fffd6', box: '#ff6b6b', boxTop: '#ffb3b3', player: '#8ff0ff' }
  };
  function themeFor(tier) { return THEMES[tier] || THEMES.Easy; }

  function Render(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  /* Fit the canvas to the board while keeping crisp integer-ish pixels and a
   * sensible max so big boards don't overflow the viewport. */
  Render.prototype.fit = function (w, h) {
    var stage = this.canvas.parentElement;
    var availW = (stage ? stage.clientWidth : 640) - 8;
    var availH = (stage ? stage.clientHeight : 640) - 8;
    var maxCell = 46;
    var cell = Math.floor(Math.min(availW / w, availH / h, maxCell));
    if (cell < 8) cell = 8;
    this.cell = cell;
    var pad = 2;
    this.canvas.width = w * cell + pad * 2;
    this.canvas.height = h * cell + pad * 2;
    this.canvas.style.width = this.canvas.width + 'px';
    this.canvas.style.height = this.canvas.height + 'px';
    this.pad = pad;
  };

  /* Draw a whole frame. `anim` optionally carries a smooth player/box slide
   * (t in 0..1) so moves don't feel like teleporting. */
  Render.prototype.draw = function (level, boxes, player, theme, anim) {
    var ctx = this.ctx, cell = this.cell, pad = this.pad;
    var w = level.w, h = level.h, cells = level.cells;
    theme = theme || themeFor(level.tier);

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = '#04060f';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    /* floor + walls */
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var at = y * w + x, c = cells[at];
        var px = pad + x * cell, py = pad + y * cell;
        if (c & W) {
          this._wall(px, py, cell, theme);
        } else {
          ctx.fillStyle = theme.floor;
          ctx.fillRect(px, py, cell, cell);
          /* subtle grid line */
          ctx.strokeStyle = 'rgba(255,255,255,0.04)';
          ctx.lineWidth = 1;
          ctx.strokeRect(px + 0.5, py + 0.5, cell - 1, cell - 1);
          if (c & G) this._mark(px, py, cell, theme);
        }
      }
    }

    /* boxes */
    for (var i = 0; i < boxes.length; i++) {
      var bx = boxes[i] % w, by = (boxes[i] / w) | 0;
      var onMark = !!(cells[boxes[i]] & G);
      this._box(pad + bx * cell, pad + by * cell, cell, theme, onMark);
    }

    /* player (with optional slide offset from `anim`) */
    var pxp = pad + (player % w) * cell, pyp = pad + ((player / w) | 0) * cell;
    if (anim && anim.dx !== undefined) {
      pxp -= anim.dx * cell * (1 - anim.t);
      pyp -= anim.dy * cell * (1 - anim.t);
    }
    this._player(pxp, pyp, cell, theme);
  };

  Render.prototype._wall = function (px, py, s, theme) {
    var ctx = this.ctx;
    ctx.fillStyle = theme.wall;
    ctx.fillRect(px, py, s, s);
    /* lit top edge for a beveled brick look */
    ctx.fillStyle = theme.wallTop;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(px, py, s, Math.max(2, s * 0.18));
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, s - 1, s - 1);
  };

  Render.prototype._mark = function (px, py, s, theme) {
    var ctx = this.ctx, cx = px + s / 2, cy = py + s / 2, r = s * 0.22;
    ctx.save();
    ctx.strokeStyle = theme.mark;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = Math.max(1.5, s * 0.07);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = theme.mark;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  Render.prototype._box = function (px, py, s, theme, onMark) {
    var ctx = this.ctx;
    var m = s * 0.12, r = s * 0.14;
    var x = px + m, y = py + m, sz = s - m * 2;
    ctx.save();
    /* drop shadow */
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    this._round(x + s * 0.05, y + s * 0.06, sz, sz, r);
    ctx.fill();
    /* body */
    var grad = ctx.createLinearGradient(x, y, x, y + sz);
    grad.addColorStop(0, onMark ? '#eafff5' : theme.boxTop);
    grad.addColorStop(1, onMark ? theme.mark : theme.box);
    ctx.fillStyle = grad;
    this._round(x, y, sz, sz, r);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 1;
    this._round(x, y, sz, sz, r);
    ctx.stroke();
    /* center gem to read as "treasure" */
    ctx.fillStyle = onMark ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.arc(px + s / 2, py + s / 2, s * 0.14, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  Render.prototype._player = function (px, py, s, theme) {
    var ctx = this.ctx, cx = px + s / 2, cy = py + s / 2, r = s * 0.34;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.arc(cx + s * 0.04, cy + s * 0.05, r, 0, Math.PI * 2);
    ctx.fill();
    var grad = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.2, cx, cy, r);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.4, theme.player);
    grad.addColorStop(1, theme.player);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  };

  Render.prototype._round = function (x, y, w, h, r) {
    var ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  POCO.Render = Render;
  POCO.themeFor = themeFor;
})(typeof window !== 'undefined' ? window : globalThis);
