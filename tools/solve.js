// Brute-force every placements list (Replicate, Shard(d), _StridedShard(d, k) for k = 2..4) that
// produces a target layout. Used to pick levels whose answers are unique and to check level claims.
const path = require("path");
const G = require(path.join(__dirname, "../js/garden.js"));

function candidates(ndim) {
  const out = [{ kind: "R" }];
  for (let d = 0; d < ndim; d++) {
    out.push({ kind: "S", dim: d });
    for (const sf of [2, 3, 4]) out.push({ kind: "SS", dim: d, sf });
  }
  return out;
}

function solutions(shape, mesh, target, fixed = {}) {
  const C = candidates(shape.length);
  const found = [];
  const rec = (prefix) => {
    if (prefix.length === mesh.length) {
      if (G.sameLayout(G.layout(shape, mesh, prefix), target)) found.push(prefix.map(G.placementName));
      return;
    }
    const pinned = fixed[prefix.length];
    for (const p of pinned ? [pinned] : C) rec(prefix.concat([p]));
  };
  rec([]);
  return found;
}

module.exports = { solutions, candidates };

if (require.main === module) {
  // node tools/solve.js '[8]' '[2,2]' '_StridedShard(0, split_factor=2), Shard(0)'
  const shape = JSON.parse(process.argv[2]);
  const mesh = JSON.parse(process.argv[3]);
  const parsed = G.parsePlacements(process.argv[4], shape.length, mesh.length);
  if (parsed.error) throw new Error(parsed.error);
  const target = G.layout(shape, mesh, parsed.placements);
  target.forEach((cells, r) => console.log(`rank ${r}: ${cells.join(" ")}`));
  const sols = solutions(shape, mesh, target);
  console.log(`${sols.length} solution(s):`);
  for (const s of sols) console.log("  " + s.join(", "));
}
