// DTensor sharding model for the game. Placements apply left to right, one per mesh dim, each
// to the indices the rank holds so far along its tensor dim (as _compute_local_shape_and_global_offset does).
//   Shard(d):              torch.chunk the current indices into mesh_size pieces, keep piece coord.
//   _StridedShard(d, sf):  torch.chunk into sf groups, chunk each group into mesh_size pieces,
//                          keep piece coord of every group, concatenated (as _StridedShard._split_tensor).
//   Replicate:             no change.

function range(n) {
  return Array.from({ length: n }, (_, i) => i);
}

// torch.chunk semantics, padded with empty pieces to k (as Shard._split_tensor does).
function chunk(list, k) {
  const n = list.length;
  const size = Math.ceil(n / k);
  const out = [];
  for (let i = 0; i < k; i++) out.push(list.slice(Math.min(i * size, n), Math.min((i + 1) * size, n)));
  return out;
}

function coordOf(rank, mesh) {
  const c = [];
  for (let m = mesh.length - 1; m >= 0; m--) {
    c.unshift(rank % mesh[m]);
    rank = Math.floor(rank / mesh[m]);
  }
  return c;
}

function rankOf(coord, mesh) {
  return coord.reduce((r, c, m) => r * mesh[m] + c, 0);
}

// The global indices a rank holds along each tensor dim, in local order.
function shard(shape, mesh, placements, rank) {
  const coord = coordOf(rank, mesh);
  const idx = shape.map(range);
  placements.forEach((p, m) => {
    if (p.kind === "S") idx[p.dim] = chunk(idx[p.dim], mesh[m])[coord[m]];
    else if (p.kind === "SS") idx[p.dim] = chunk(idx[p.dim], p.sf).flatMap((g) => chunk(g, mesh[m])[coord[m]]);
  });
  return idx;
}

function placementName(p) {
  if (p.kind === "S") return `Shard(${p.dim})`;
  if (p.kind === "SS") return `_StridedShard(${p.dim}, split_factor=${p.sf})`;
  return "Replicate()";
}

if (typeof module !== "undefined") {
  module.exports = { range, chunk, coordOf, rankOf, shard, placementName };
}
