# Placement Garden

A [Grid Garden](https://cssgridgarden.com/)–style game for DTensor placements. The global tensor `x` holds one seed per element, and each plot is a rank. There are two modes, switched globally:

- **Place seeds (the default):** the placements are given. Each rank's plot is an allotment the size of the global tensor; till land to the local tensor's shape (what `dtensor.to_local()` holds): click empty ground to add land up to there and click a square of land to remove just that square (the land counts once it fills a rectangle), then drag seeds from the global tensor into the right positions. Click a seed and then a slot also works; drag a planted square to move it (land and seed), onto another seed to swap them, or back to the global tensor to dig it up. Each rank's row and column handles (⠿) move a whole row or column of its land the same way.
- **Write placements:** each rank's plot is its local tensor, with marked spots showing which seed `to_local()` holds where. Type the `placements` that plant every marked spot with its seed; a seed in the wrong spot comes up as a weed.

Write placements is checked live. In Place seeds you can drag single seeds, whole rows or columns (by their ⠿ handles), or a whole plot onto another rank; Clear all empties every plot, and Snap to offset 0 packs each rank's land into its top-left corner, closing up the gaps. Place seeds is checked when you press Check (or Enter): wrong seeds turn into red weeds and each plot gets a green or red border. When the garden is right the board turns gold, the carrots ripen and Next (or Enter) moves on. Seeds are lettered in flat order. The 26 levels go from `Shard` and `Replicate` through two mesh dims, `_StridedShard` (uneven groups, `split_factor=3`, a fixed-second-entry level you solve backwards) and 3-D meshes, ending with a bit-reversal layout. The ✱ entry in the level menu opens a sandbox with no plan.

Placement Garden is MIT licensed (`LICENSE`). The art (`images/`), page layout, styles and harvest flow come from Grid Garden by Thomas Park, also MIT licensed (`third_party/gridgarden/LICENSE`). The tada, pulse, shake and bounce keyframes come from Animate.css (MIT). Fonts are the system's.

## Run

```
cd ~/local/placement-garden && python3 -m http.server 8000
```

Then open `http://localhost:8000/`, or open `index.html` directly. Progress is saved in localStorage.

`python3 build.py` writes a self-contained `dist/placement-garden.html` (CSS, scripts and images inlined) that works on its own.

## Layout

- `js/engine.js`: the placement model (`Shard` uses `torch.chunk` semantics; `_StridedShard` splits into `split_factor` groups and chunks each one).
- `js/garden.js`: placement parser, per-rank layouts in local order, local shapes, comparison with a level's target.
- `js/levels.js`: the levels. Each has a `shape`, a `mesh`, a reference `solution`, instructions, a hint, and optionally `fixed: {before: N, after: M}` to lock placements.
- `js/game.js`: the UI.
- `tools/solve.js`: lists every placements list that produces a layout, e.g. `node tools/solve.js '[8]' '[2,2]' '_StridedShard(0, split_factor=2), Shard(0)'`. Use it to check a new level's answer is unique enough.

## Tests

- `node test/check_levels.js`: every solution solves its level, all-`Replicate` doesn't, the concrete claims in the instructions and hints match the engine, no strided level has a plain `Shard`/`Replicate` answer, plus parser cases.
- `node test/export_levels.js > /tmp/levels.json && <python with torch> test/torch_check.py /tmp/levels.json`: every rank of every level matches real `distribute_tensor(...).to_local()` on a fake process group, element order and local shape included.
