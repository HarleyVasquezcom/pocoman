/* Bootstrap: overlays, lazy level generation (with spinner), input, loop.
 * Levels are generated on demand and memoized — generating all 1000 up front
 * would freeze the tab, so we build one when the player asks for it. */
(function () {
  'use strict';
  var POCO = window.POCO;
  var Levels = POCO.Levels;
  var State = POCO.State;
  var MAX = Levels.MAX_LEVEL;

  var canvas = document.getElementById('game');
  var renderer = new POCO.Render(canvas);
  var game = new POCO.Game();

  function el(id) { return document.getElementById(id); }

  /* ---------- persistence ---------- */
  var SAVE_KEY = 'pocoman.progress.v1';
  var progress = { max: 1, done: {} };
  function loadProgress() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        var p = JSON.parse(raw);
        if (p && typeof p.max === 'number') { progress.max = p.max; progress.done = p.done || {}; }
      }
    } catch (e) { /* private mode / file:// — progress just won't persist */ }
  }
  function saveProgress() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(progress)); } catch (e) {}
  }
  function markDone(n) { progress.done[n] = 1; if (n >= progress.max && n < MAX) progress.max = n + 1; saveProgress(); }

  /* ---------- level cache ---------- */
  var cache = {};
  function getLevel(n) {
    if (cache[n]) return cache[n];
    var gen = Levels.generate(n);
    /* generate() returns rows/par/solution; parse() turns it into the live
     * cells/boxes/player structure the Game can actually run. */
    var parsed = Levels.parse(Levels.serialize(gen), n);
    parsed.solution = gen.solution;
    parsed.verified = gen.verified;
    parsed.par = gen.par;
    parsed.tier = gen.tier;
    cache[n] = parsed;
    return parsed;
  }

  /* ---------- overlays ---------- */
  var OVERLAYS = ['menu', 'levels', 'help', 'pause', 'win', 'loading'];
  function show(name) {
    OVERLAYS.forEach(function (o) {
      var node = el('screen-' + o);
      if (node) node.classList.toggle('active', o === name);
    });
    UI.current = name;
  }

  var UI = { current: 'menu' };

  /* ---------- HUD ---------- */
  function syncHud(n) {
    var lvl = game.level;
    el('hud-level').textContent = n;
    el('hud-tier').textContent = lvl ? lvl.tier : '–';
    el('hud-par').textContent = (lvl && lvl.par) ? lvl.par : '–';
    el('hud-pushes').textContent = game.pushes;
    el('hud-left').textContent = game.offGoals();
  }

  /* ---------- rendering ---------- */
  var currentNum = 1;
  var needsFit = true;
  function render() {
    if (!game.level) return;
    if (needsFit) { renderer.fit(game.w, game.h); needsFit = false; }
    renderer.draw(game.level, game.boxList, game.player, POCO.themeFor(game.level.tier));
  }

  /* ---------- level flow ---------- */
  function startLevel(n) {
    n = Math.max(1, Math.min(MAX, n | 0));
    currentNum = n;
    show('loading');
    /* yield one frame so the spinner actually paints before we block */
    setTimeout(function () {
      var lvl = getLevel(n);
      game.load(lvl);
      game.state = State.PLAY;
      needsFit = true;
      syncHud(n);
      show(null);
      render();
    }, 30);
  }

  function nextLevel() {
    if (currentNum < MAX) startLevel(currentNum + 1);
    else toMenu();
  }

  function toMenu() {
    game.state = State.MENU;
    syncContinue();
    show('menu');
    /* draw a idle board behind the menu if we have one */
    if (game.level) render();
  }

  /* ---------- win ---------- */
  game.onEvent = function (name) {
    if (name === 'win') {
      markDone(currentNum);
      el('win-pushes').textContent = 'PUSHES ' + game.pushes;
      var lvl = game.level;
      var parTxt = lvl.par ? String(lvl.par) : '–';
      var rank = '';
      if (lvl.par) {
        if (game.pushes <= lvl.par) rank = 'PERFECT — at par!';
        else if (game.pushes <= lvl.par * 1.3) rank = 'Great solve!';
      }
      el('win-par').textContent = 'PAR ' + parTxt;
      el('win-rank').textContent = rank;
      show('win');
    }
  };

  /* ---------- level select ---------- */
  var grid = el('level-grid');
  var PAGE = 100;
  var PAGES = Math.ceil(MAX / PAGE);
  var page = 0;

  function buildPage() {
    var first = page * PAGE + 1;
    var last = Math.min(MAX, page * PAGE + PAGE);
    grid.textContent = '';
    for (var n = first; n <= last; n++) {
      var btn = document.createElement('button');
      btn.className = 'lvl';
      btn.textContent = String(n);
      btn.setAttribute('data-level', String(n));
      var cfg = Levels.tierFor(n);
      btn.style.color = POCO.themeFor(cfg.name).wallTop;
      btn.style.borderColor = POCO.themeFor(cfg.name).wall + '55';
      grid.appendChild(btn);
    }
    el('pg-label').textContent = first + ' – ' + last + ' / ' + MAX;
    el('pg-prev').disabled = page === 0;
    el('pg-next').disabled = page === PAGES - 1;
    refreshGrid();
  }

  function refreshGrid() {
    var kids = grid.children;
    for (var i = 0; i < kids.length; i++) {
      var n = +kids[i].getAttribute('data-level');
      kids[i].classList.toggle('done', !!progress.done[n]);
      kids[i].classList.toggle('cur', n === currentNum);
    }
  }

  grid.addEventListener('click', function (e) {
    var t = e.target;
    if (t && t.getAttribute && t.getAttribute('data-level')) startLevel(+t.getAttribute('data-level'));
  });
  el('pg-prev').addEventListener('click', function () { if (page > 0) { page--; buildPage(); } });
  el('pg-next').addEventListener('click', function () { if (page < PAGES - 1) { page++; buildPage(); } });

  function syncContinue() {
    var btn = el('btn-continue');
    if (progress.max > 1 || Object.keys(progress.done).length) {
      btn.classList.remove('hidden');
      btn.textContent = 'CONTINUE · L' + Math.min(progress.max, MAX);
    } else {
      btn.classList.add('hidden');
    }
  }

  /* ---------- buttons ---------- */
  el('btn-start').addEventListener('click', function () { startLevel(1); });
  el('btn-continue').addEventListener('click', function () { startLevel(progress.max); });
  el('btn-levels').addEventListener('click', function () { buildPage(); show('levels'); });
  el('btn-levels-back').addEventListener('click', function () { toMenu(); });
  el('btn-help').addEventListener('click', function () { show('help'); });
  el('btn-help-back').addEventListener('click', function () { toMenu(); });
  el('btn-resume').addEventListener('click', function () { resume(); });
  el('btn-restart').addEventListener('click', function () { doReset(); });
  el('btn-quit').addEventListener('click', function () { toMenu(); });
  el('btn-next').addEventListener('click', function () { nextLevel(); });
  el('btn-win-menu').addEventListener('click', function () { toMenu(); });

  /* ---------- actions ---------- */
  function togglePause() {
    if (game.state === State.PLAY) { game.state = State.PAUSED; show('pause'); }
    else if (game.state === State.PAUSED) resume();
  }
  function resume() { if (game.state === State.PAUSED) { game.state = State.PLAY; show(null); } }
  function doReset() { game.reset(); syncHud(currentNum); show(null); render(); }
  function doUndo() { if (game.undo()) { syncHud(currentNum); render(); } }
  function doSolve() {
    var applied = game.solve();
    if (applied >= 0) { syncHud(currentNum); render(); }
  }

  function moveDir(d) {
    if (game.state !== State.PLAY) return;
    if (game.move(d)) { syncHud(currentNum); render(); }
  }

  /* ---------- keyboard ---------- */
  var KEYMAP = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3, w: 0, d: 1, s: 2, a: 3, W: 0, D: 1, S: 2, A: 3 };
  document.addEventListener('keydown', function (e) {
    var k = e.key;
    if (k in KEYMAP) { e.preventDefault(); moveDir(KEYMAP[k]); return; }
    var low = k.toLowerCase();
    if (low === 'z') { e.preventDefault(); doUndo(); }
    else if (low === 'r') { e.preventDefault(); if (game.level) doReset(); }
    else if (low === 'f') { e.preventDefault(); if (game.level) doSolve(); }
    else if (low === 'p') { e.preventDefault(); togglePause(); }
    else if (low === 'm') { e.preventDefault(); }
    else if (k === 'Escape') { e.preventDefault(); back(); }
    else if (k === 'Enter') { e.preventDefault(); handleEnter(); }
  });

  function back() {
    if (UI.current === 'levels' || UI.current === 'help') { toMenu(); return; }
    if (UI.current === 'win') { toMenu(); return; }
    if (UI.current === 'pause') { resume(); return; }
    if (game.state === State.PLAY) togglePause();
    else if (UI.current === null || UI.current === undefined) toMenu();
  }

  function handleEnter() {
    if (UI.current === 'win') nextLevel();
    else if (UI.current === 'menu') startLevel(1);
  }

  /* ---------- touch ---------- */
  var tbtns = document.querySelectorAll('.tbtn');
  for (var i = 0; i < tbtns.length; i++) {
    tbtns[i].addEventListener('click', function (e) {
      var d = e.currentTarget.getAttribute('data-dir');
      var act = e.currentTarget.getAttribute('data-act');
      if (d !== null) { moveDir(+d); return; }
      if (act === 'undo') doUndo();
      else if (act === 'reset') doReset();
      else if (act === 'pause') togglePause();
    });
  }

  /* swipe support on the canvas */
  var sw = null;
  canvas.addEventListener('touchstart', function (e) {
    var t = e.changedTouches[0]; sw = { x: t.clientX, y: t.clientY };
  }, { passive: true });
  canvas.addEventListener('touchend', function (e) {
    if (!sw) return;
    var t = e.changedTouches[0];
    var dx = t.clientX - sw.x, dy = t.clientY - sw.y;
    sw = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) return;
    if (Math.abs(dx) > Math.abs(dy)) moveDir(dx > 0 ? 1 : 3);
    else moveDir(dy > 0 ? 2 : 0);
  }, { passive: true });

  /* ---------- resize ---------- */
  window.addEventListener('resize', function () { if (game.level) { needsFit = true; render(); } });

  /* ---------- boot ---------- */
  loadProgress();
  syncContinue();
  buildPage();
  show('menu');
})();
