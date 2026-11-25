// Each level is defined by an intended solution; the target layout is computed from it, and any
// placements that produce the same layout solve the level. `fixed: {before: N, after: M}` shows the
// first N / last M placements in the code but doesn't let the player edit them. `plantInstructions`, if
// set, replaces `instructions` in Place seeds mode, where every placement is given.
// `node tools/solve.js` lists every answer for a layout; test/torch_check.py checks targets against torch.

const LEVELS = [
  // ---------------------------------------------------------------- Shard and Replicate
  {
    title: "First planting",
    shape: [4],
    mesh: [2],
    solution: ["Shard(0)"],
    instructions: `
      <p>Welcome to the Placement Garden. The <b>global tensor</b> <code>x</code> holds one seed per element, lettered in order. Each <b>plot</b> is a rank. The tensor's <code>placements</code> decide which seeds get planted in which plot, with one entry per mesh dim.</p>
      <p><code>Shard(dim)</code> cuts tensor dim <code>dim</code> into one piece per rank, in rank order.</p>`,
    hint: "This tensor only has dim 0.",
  },
  {
    title: "A copy for everyone",
    shape: [4],
    mesh: [2],
    solution: ["Replicate()"],
    instructions: `
      <p><code>Replicate()</code> gives every rank along a mesh dim its own full copy of what it holds so far.</p>`,
    hint: "No cutting at all.",
  },
  {
    title: "Who goes hungry?",
    shape: [5],
    mesh: [4],
    solution: ["Shard(0)"],
    instructions: `
      <p><code>Shard</code> cuts like <code>torch.chunk</code>: every piece gets ⌈n / ranks⌉ seeds until the seeds run out. With 5 seeds and 4 plots that leaves one plot with an <b>empty shard</b>, a local tensor of size 0.</p>`,
    hint: "⌈5 / 4⌉ = 2 seeds per piece: 2, 2, 1, and then nothing.",
  },
  {
    title: "Lettered seeds",
    shape: [3, 4],
    mesh: [2],
    solution: ["Shard(1)"],
    instructions: `
      <p>A 2-D tensor. Its seeds are still lettered in order, row by row, and the small numbers along the edges are row and column indices.</p>`,
    hint: "Which tensor dim changes as you move along a row?",
  },

  // ---------------------------------------------------------------- two mesh dims
  {
    title: "Two mesh dims",
    shape: [4, 2],
    mesh: [2, 2],
    solution: ["Shard(0)", "Replicate()"],
    instructions: `
      <p>A 2 × 2 mesh has two mesh dims, so <code>placements</code> has two entries. Ranks fill the mesh row by row: mesh dim 0 goes down the board, mesh dim 1 goes across.</p>
      <p>Entry 0 says what changes as you move down the mesh, and entry 1 what changes as you move across.</p>`,
    hint: "Moving down, the rows change. Moving across, nothing changes.",
  },
  {
    title: "Across, not down",
    shape: [4, 2],
    mesh: [2, 2],
    solution: ["Replicate()", "Shard(0)"],
    instructions: ``,
    hint: "Now the rows change as you move across the mesh.",
  },
  {
    title: "Blocks",
    shape: [4, 4],
    mesh: [2, 2],
    solution: ["Shard(1)", "Shard(0)"],
    instructions: `
      <p>Every plot wants its own block. Check which block goes to rank 1 before you start.</p>`,
    hint: "Moving down the mesh (rank 0 → rank 2) changes the columns.",
  },
  {
    title: "One row each",
    shape: [4, 4],
    mesh: [2, 2],
    solution: ["Shard(0)", "Shard(0)"],
    instructions: `
      <p>Placements apply <b>left to right</b>: each entry cuts whatever the rank holds after the entries before it.</p>`,
    hint: "Both mesh dims cut the rows: first into halves, then each half into rows.",
  },
  {
    title: "A wide mesh",
    shape: [5, 4],
    mesh: [2, 3],
    solution: ["Shard(1)", "Shard(0)"],
    instructions: `
      <p>Meshes don't have to be square: this one has 2 positions down and 3 across.</p>`,
    hint: "Count how many rows and columns rank 0 gets, then which mesh dim has enough positions to make each cut.",
  },

  // ---------------------------------------------------------------- _StridedShard
  {
    title: "Strided seeds",
    shape: [8],
    mesh: [2],
    solution: ["_StridedShard(0, split_factor=2)"],
    instructions: `
      <p>Rank 0 wants seeds a, b, e, f: two separate runs. No <code>Shard</code> can do that.</p>
      <p><code>_StridedShard(dim, split_factor=k)</code> also cuts tensor dim <code>dim</code> (here dim 0 of the global tensor <code>x</code>), but in two steps: first it splits that dim into <code>k</code> groups, then it cuts <i>each group</i> into one piece per rank. Every rank keeps its piece of every group.</p>`,
    plantInstructions: `
      <p><code>_StridedShard(dim, split_factor=k)</code> cuts tensor dim <code>dim</code> (here dim 0 of the global tensor <code>x</code>) in two steps: first it splits that dim into <code>k</code> groups, then it cuts <i>each group</i> into one piece per rank. Every rank keeps its piece of every group.</p>`,
    hint: "Two groups: a–d and e–h.",
  },
  {
    title: "Four plots",
    shape: [8],
    mesh: [4],
    solution: ["_StridedShard(0, split_factor=2)"],
    instructions: ``,
    hint: "How many runs does rank 0 hold? That's the number of groups.",
  },
  {
    title: "Three runs",
    shape: [12],
    mesh: [2],
    solution: ["_StridedShard(0, split_factor=3)"],
    instructions: ``,
    hint: "Rank 0 holds three separate runs.",
  },
  {
    title: "Lopsided groups",
    shape: [7],
    mesh: [2],
    solution: ["_StridedShard(0, split_factor=2)"],
    instructions: `
      <p>The groups are cut with <code>torch.chunk</code> too, and then each group is chunked again across the ranks.</p>`,
    hint: "Two groups of 4 and 3, each split across 2 ranks.",
  },
  {
    title: "Strided columns",
    shape: [3, 6],
    mesh: [3],
    solution: ["_StridedShard(1, split_factor=2)"],
    instructions: ``,
    hint: "Look at which columns rank 0 holds.",
  },
  {
    title: "Polka dots",
    shape: [4, 4],
    mesh: [2, 2],
    solution: ["_StridedShard(0, split_factor=2)", "_StridedShard(1, split_factor=2)"],
    instructions: ``,
    hint: "Rank 0 takes every other row and every other column.",
  },
  {
    title: "The motivating example",
    shape: [4, 2],
    mesh: [2, 2],
    solution: ["_StridedShard(0, split_factor=2)", "Replicate()"],
    instructions: `
      <p>One starting offset can't describe what rank 0 holds here, because its two rows aren't next to each other.</p>`,
    hint: "Strided rows going down the mesh, nothing changing across.",
  },
  {
    title: "Finish the layout",
    shape: [8],
    mesh: [2, 2],
    solution: ["Shard(0)", "_StridedShard(0, split_factor=2)"],
    fixed: { before: 1 },
    instructions: `
      <p>The first placement is fixed. Choose the second.</p>`,
    plantInstructions: ``,
    hint: "After Shard(0), the top mesh row holds a–d. Rank 0 wants every other one of those.",
  },
  {
    title: "Mesh dim 1 goes first",
    shape: [8],
    mesh: [2, 2],
    solution: ["_StridedShard(0, split_factor=2)", "Shard(0)"],
    instructions: `
      <p>With plain <code>Shard</code>s, mesh dim 0 always makes the big cut. Here moving <i>across</i> jumps by half the tensor and moving <i>down</i> jumps by a quarter, as if mesh dim 1 cut first. This is what <code>_StridedShard</code> is for.</p>`,
    hint: "Mesh dim 0 has to leave room for mesh dim 1's halves, so give it a piece of every half.",
  },
  {
    title: "Three across",
    shape: [12],
    mesh: [2, 3],
    solution: ["_StridedShard(0, split_factor=3)", "Shard(0)"],
    instructions: ``,
    hint: "Moving across jumps by a third of the tensor. What does mesh dim 0 have to hold for that to work?",
  },
  {
    title: "Work backwards",
    shape: [8],
    mesh: [2, 2],
    solution: ["_StridedShard(0, split_factor=4)", "Shard(0)"],
    fixed: { after: 1 },
    instructions: `
      <p>This time the <i>second</i> placement is fixed. Work out what the top row of plots must hold between them before <code>Shard(0)</code> cuts it.</p>`,
    plantInstructions: ``,
    hint: "Ranks 0 and 1 together hold a, c, e, g.",
  },
  {
    title: "Ragged",
    shape: [6],
    mesh: [2, 2],
    solution: ["_StridedShard(0, split_factor=2)", "Shard(0)"],
    instructions: ``,
    hint: "Same idea as \"Mesh dim 1 goes first\", but the pieces don't divide evenly.",
  },
  {
    title: "Rows strided, columns halved",
    shape: [8, 4],
    mesh: [2, 2],
    solution: ["_StridedShard(0, split_factor=2)", "Shard(1)"],
    instructions: ``,
    hint: "Take the rows and the columns separately: which mesh dim changes each one?",
  },

  // ---------------------------------------------------------------- three mesh dims
  {
    title: "Three mesh dims",
    shape: [4, 4],
    mesh: [2, 2, 2],
    solution: ["Shard(0)", "Shard(1)", "Replicate()"],
    instructions: `
      <p>A 2 × 2 × 2 mesh, drawn as two boards: mesh dim 0 picks the board, then mesh dim 1 goes down and mesh dim 2 goes across within it. <code>placements</code> now has three entries.</p>`,
    hint: "Each board holds half the rows. Within a board, the columns change going down and nothing changes going across.",
  },
  {
    title: "Replicas outside",
    shape: [8, 2],
    mesh: [2, 2, 2],
    solution: ["Replicate()", "_StridedShard(0, split_factor=2)", "Shard(0)"],
    instructions: `
      <p>Both boards are identical, like the replica groups in HSDP.</p>`,
    hint: "Within each board, this is \"Mesh dim 1 goes first\" on rows.",
  },
  {
    title: "Columns outside",
    shape: [8, 4],
    mesh: [2, 2, 2],
    solution: ["Shard(1)", "_StridedShard(0, split_factor=2)", "Shard(0)"],
    instructions: ``,
    hint: "The two boards differ only in columns. Within a board, moving across jumps by half the rows.",
  },
  {
    title: "Bit reversal",
    shape: [8],
    mesh: [2, 2, 2],
    solution: ["_StridedShard(0, split_factor=4)", "_StridedShard(0, split_factor=2)", "Shard(0)"],
    instructions: `
      <p>Each rank wants one seed: the one at the index you get by reversing the rank's bits. Rank 1 (binary 001) wants seed e (index 4, binary 100). Moving along mesh dim 2 jumps 4 seeds, along mesh dim 1 jumps 2, and along mesh dim 0 jumps 1.</p>`,
    plantInstructions: `
      <p>Each rank ends up with a single seed. Apply the placements one at a time, each to what the rank holds so far.</p>`,
    hint: "Work from the last mesh dim to the first, as in \"Work backwards\": what must each board hold, and then each row of plots?",
  },
];

if (typeof module !== "undefined") module.exports = { LEVELS };
