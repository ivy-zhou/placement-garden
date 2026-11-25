// Pure game logic: parse placements text, compute each rank's cells, compare with a level's target.

// One placement per regex; dims and split factors are checked after matching.
const PLACEMENT_FORMS = [
  { re: /^Shard\(\s*(?:dim\s*=\s*)?(\d+)\s*\)$/, make: (m) => ({ kind: "S", dim: +m[1] }) },
  { re: /^Replicate\(\s*\)$/, make: () => ({ kind: "R" }) },
  {
    re: /^_?StridedShard\(\s*(?:dim\s*=\s*)?(\d+)\s*,\s*(?:split_factor\s*=\s*)?(\d+)\s*\)$/,
    make: (m) => ({ kind: "SS", dim: +m[1], sf: +m[2] }),
  },
];

// Split on commas that aren't inside parentheses.
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter((p, i, all) => p !== "" || i < all.length - 1);
}

function parsePlacement(text, ndim) {
  const t = text.trim();
  if (!t) return { error: "Empty entry: is there an extra comma?" };
  for (const form of PLACEMENT_FORMS) {
    const m = form.re.exec(t);
    if (!m) continue;
    const p = form.make(m);
    if (p.kind !== "R" && p.dim >= ndim) {
      return { error: `${t}: the tensor has ${ndim} dim${ndim === 1 ? "" : "s"}, so dim must be ${ndim === 1 ? "0" : "0 or 1"}.` };
    }
    if (p.kind === "SS" && p.sf < 1) return { error: `${t}: split_factor must be at least 1.` };
    return { placement: p };
  }
  if (/^Partial/.test(t)) return { error: "Partial() holds partial sums, not seeds. Use Replicate() for data that every rank has." };
  return { error: `Don't know "${t}". Try Shard(0), Replicate() or _StridedShard(0, split_factor=2).` };
}

// Parse the editable text into placements; `expected` is how many entries the text must hold.
function parsePlacements(text, ndim, expected) {
  const cleaned = text.replace(/#[^\n]*/g, "").replace(/\s+/g, " ").trim().replace(/,\s*$/, "");
  if (!cleaned) return { error: `Type ${expected === 1 ? "a placement" : `${expected} placements, separated by commas`}.` };
  const parts = splitTopLevel(cleaned);
  const out = [];
  for (const part of parts) {
    const r = parsePlacement(part, ndim);
    if (r.error) return { error: r.error };
    out.push(r.placement);
  }
  if (out.length !== expected) {
    return { error: `This box needs ${expected} placement${expected === 1 ? "" : "s"} (one per mesh dim it covers); you wrote ${out.length}.` };
  }
  return { placements: out };
}

function nRanks(mesh) {
  return mesh.reduce((a, b) => a * b, 1);
}

// rank -> cell keys ("i" or "i,j") it holds, in the local tensor's row-major order.
function layout(shape, mesh, placements) {
  const out = [];
  for (let r = 0; r < nRanks(mesh); r++) {
    const idx = shard(shape, mesh, placements, r);
    let cells = [[]];
    for (const l of idx) cells = cells.flatMap((c) => l.map((i) => c.concat([i])));
    out.push(cells.map((c) => c.join(",")));
  }
  return out;
}

// rank -> its local tensor's shape.
function localShapes(shape, mesh, placements) {
  return Array.from({ length: nRanks(mesh) }, (_, r) => shard(shape, mesh, placements, r).map((l) => l.length));
}

function parseLevelSolution(level) {
  return level.solution.map((t) => parsePlacement(t, level.shape.length).placement);
}

function targetOf(level) {
  return layout(level.shape, level.mesh, parseLevelSolution(level));
}

function sameLayout(a, b) {
  return a.length === b.length && a.every((cells, r) => {
    const s = new Set(cells);
    return s.size === new Set(b[r]).size && b[r].every((c) => s.has(c));
  });
}

// How many placements are fixed before/after the editable box.
function fixedCounts(level) {
  const f = level.fixed || {};
  return { before: f.before || 0, after: f.after || 0 };
}

// Combine fixed placements and the parsed editable ones into the full list.
function fullPlacements(level, editable) {
  const sol = parseLevelSolution(level);
  const { before, after } = fixedCounts(level);
  return sol.slice(0, before).concat(editable, sol.slice(sol.length - after));
}

if (typeof module !== "undefined") {
  const E = require("./engine.js");
  Object.assign(global, E);
  module.exports = { localShapes, parsePlacements, parsePlacement, layout, targetOf, sameLayout, fixedCounts, fullPlacements, parseLevelSolution, nRanks, placementName: E.placementName, splitTopLevel };
}
