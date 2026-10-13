// Drive POCO.Game against generated levels: solve() must always reach WON.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sandbox = { console, Math, Date, performance: { now: () => Date.now() } };
sandbox.global = sandbox;
vm.createContext(sandbox);
for (const f of ['rng.js', 'generator.js', 'game.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), sandbox, { filename: f });
}
const POCO = sandbox.POCO;
const Levels = POCO.Levels;

let fail = 0, checked = 0;
for (let n = 1; n <= 1000; n += 11) {
  const gen = Levels.generate(n);
  const parsed = Levels.parse(Levels.serialize(gen), n);
  parsed.solution = gen.solution; parsed.verified = gen.verified; parsed.par = gen.par; parsed.tier = gen.tier;
  const game = new POCO.Game();
  game.load(parsed);
  game.state = POCO.State.PLAY;
  const applied = game.solve();
  checked++;
  if (!game.won || game.state !== POCO.State.WON) {
    fail++;
    console.log(`L${n} (${parsed.tier}, par=${parsed.par}): solve applied=${applied} solLen=${(gen.solution||'').length} won=${game.won} state=${game.state} offGoals=${game.offGoals()}`);
    if (fail > 8) break;
  }
}
console.log(`\nchecked ${checked}, failures ${fail}`);
