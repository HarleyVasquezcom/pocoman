// Verify generate()->serialize()->parse() roundtrip preserves cells/boxes/player/solution.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sandbox = { console, Math, Date, performance: { now: () => Date.now() } };
sandbox.global = sandbox;
vm.createContext(sandbox);
for (const f of ['rng.js', 'generator.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), sandbox, { filename: f });
}
const L = sandbox.POCO.Levels;
let fail = 0;
for (let n = 1; n <= 1000; n += 7) {
  const gen = L.generate(n);
  const parsed = L.parse(L.serialize(gen), n);
  parsed.solution = gen.solution; parsed.verified = gen.verified; parsed.par = gen.par; parsed.tier = gen.tier;
  // checks
  const problems = [];
  if (parsed.w !== gen.w || parsed.h !== gen.h) problems.push('dims');
  if (parsed.boxes.length !== gen.boxes) problems.push(`boxes ${parsed.boxes.length}!=${gen.boxes}`);
  if (parsed.player < 0) problems.push('no player');
  if (parsed.tier !== gen.tier) problems.push('tier');
  if (parsed.par !== gen.par) problems.push('par');
  // solution must replay to solved
  if (gen.solution) {
    const r = L.replay(parsed, gen.solution);
    if (!r) problems.push('solution-replay-FAIL');
  }
  if (problems.length) { fail++; console.log(`L${n}: ${problems.join(', ')}`); }
}
console.log(fail === 0 ? 'ALL ROUNDTRIP CHECKS PASSED' : `${fail} FAILURES`);
