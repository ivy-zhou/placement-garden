// Every level: its solution parses and solves it, an empty or Replicate-everywhere garden doesn't,
// and the concrete claims in its instructions match the engine.
const path = require("path");
const G = require(path.join(__dirname, "../js/garden.js"));
const { LEVELS } = require(path.join(__dirname, "../js/levels.js"));

let fails = 0;
const fail = (msg) => { fails++; console.log("FAIL", msg); };
const held = (level, rank) => G.targetOf(level)[rank];

LEVELS.forEach((lv, i) => {
  const name = `level ${i + 1} (${lv.title})`;
  const nd = lv.shape.length;
  const { before, after } = G.fixedCounts(lv);
  const editable = lv.solution.slice(before, lv.solution.length - after).join(", ");
  const parsed = G.parsePlacements(editable, nd, lv.mesh.length - before - after);
  if (parsed.error) return fail(`${name}: solution doesn't parse: ${parsed.error}`);
  const got = G.layout(lv.shape, lv.mesh, G.fullPlacements(lv, parsed.placements));
  if (!G.sameLayout(got, G.targetOf(lv))) fail(`${name}: solution doesn't solve it`);
  if (lv.solution.length !== lv.mesh.length) fail(`${name}: solution has ${lv.solution.length} entries for a ${lv.mesh.length}-D mesh`);
  // The level must need some thought: all-Replicate (where editable) must not already solve it.
  const lazy = G.parsePlacements(Array(lv.mesh.length - before - after).fill("Replicate()").join(", "), nd, lv.mesh.length - before - after);
  const lazyGot = G.layout(lv.shape, lv.mesh, G.fullPlacements(lv, lazy.placements));
  if (G.sameLayout(lazyGot, G.targetOf(lv)) && lv.solution.some((s) => s !== "Replicate()")) fail(`${name}: all-Replicate already solves it`);
  if (lv.shape.reduce((a, b) => a * b, 1) > 40) fail(`${name}: too many seeds to draw`);
});

// Claims made in the instruction and hint text.
const { solutions } = require(path.join(__dirname, "../tools/solve.js"));
const L = (title) => {
  const lv = LEVELS.find((l) => l.title === title);
  if (!lv) throw new Error(`no level "${title}"`);
  return lv;
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const rows = (cells) => [...new Set(cells.map((c) => +c.split(",")[0]))];
const cols = (cells) => [...new Set(cells.map((c) => +c.split(",")[1]))];
const bitrev3 = (r) => ((r & 1) << 2) | (r & 2) | ((r & 4) >> 2);
const claims = [
  ["Who goes hungry?", () => eq([0, 1, 2, 3].map((r) => held(L("Who goes hungry?"), r).length), [2, 2, 1, 0])],
  ["Blocks", () => eq(rows(held(L("Blocks"), 1)), [2, 3]) && eq(cols(held(L("Blocks"), 1)), [0, 1])],
  ["One row each", () => [0, 1, 2, 3].every((r) => eq(rows(held(L("One row each"), r)), [r]))],
  ["Strided seeds", () => eq(held(L("Strided seeds"), 0), ["0", "1", "4", "5"])],
  ["Lopsided groups", () => eq(held(L("Lopsided groups"), 0), ["0", "1", "4", "5"]) && eq(held(L("Lopsided groups"), 1), ["2", "3", "6"])],
  ["Finish the layout", () => eq(held(L("Finish the layout"), 0).concat(held(L("Finish the layout"), 1)).sort(), ["0", "1", "2", "3"])],
  ["Mesh dim 1 goes first", () => +held(L("Mesh dim 1 goes first"), 1)[0] === 4 && +held(L("Mesh dim 1 goes first"), 2)[0] === 2],
  ["Work backwards", () => eq(held(L("Work backwards"), 0).concat(held(L("Work backwards"), 1)).sort(), ["0", "2", "4", "6"])],
  ["Replicas outside", () => [0, 1, 2, 3].every((r) => eq(held(L("Replicas outside"), r), held(L("Replicas outside"), r + 4)))],
  ["Bit reversal", () => [0, 1, 2, 3, 4, 5, 6, 7].every((r) => eq(held(L("Bit reversal"), r), [String(bitrev3(r))]))],
];
for (const [title, ok] of claims) if (!ok()) fail(`instruction claim for "${title}" doesn't match the engine`);

// A strided level must actually need _StridedShard: no plain Shard/Replicate list may solve it.
let stridedLevels = 0;
for (const lv of LEVELS) {
  if (!lv.solution.some((s) => s.includes("Strided"))) continue;
  stridedLevels++;
  const plain = solutions(lv.shape, lv.mesh, G.targetOf(lv)).filter((s) => s.every((x) => !x.includes("Strided")));
  if (plain.length) fail(`${lv.title}: plain placements also solve it (${plain[0].join(", ")})`);
}

// Parser behavior.
const P = (t, nd, n) => G.parsePlacements(t, nd, n);
const parserCases = [
  [P("Shard(0)", 1, 1).placements, [{ kind: "S", dim: 0 }]],
  [P("Shard(dim=1), Replicate()", 2, 2).placements, [{ kind: "S", dim: 1 }, { kind: "R" }]],
  [P(" _StridedShard( 0 , split_factor = 2 ) ,", 1, 1).placements, [{ kind: "SS", dim: 0, sf: 2 }]],
  [P("StridedShard(0, 4)", 1, 1).placements, [{ kind: "SS", dim: 0, sf: 4 }]],
  [!!P("Shard(1)", 1, 1).error, true],
  [!!P("Shrd(0)", 1, 1).error, true],
  [!!P("Shard(0)", 1, 2).error, true],
  [!!P("", 1, 1).error, true],
  [!!P("Partial()", 1, 1).error, true],
  [P("Shard(0)  # comment", 1, 1).placements, [{ kind: "S", dim: 0 }]],
];
parserCases.forEach(([got, want], i) => { if (!eq(got, want)) fail(`parser case ${i}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); });

console.log(fails ? `${fails} failures` : `all ${LEVELS.length} levels, ${claims.length} instruction claims, ${stridedLevels} strided levels needing _StridedShard and ${parserCases.length} parser cases pass`);
process.exit(fails ? 1 : 0);
