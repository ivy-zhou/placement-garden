// Placement Garden UI, following Grid Garden's flow. Two global modes:
//   write: the plots show the planting plan (marked spots); the typed placements plant seeds, and
//          seeds planted off-plan come up as weeds.
//   plant: the placements are given; till each rank's plot to its local tensor's shape and drag
//          seeds into it in to_local() order.
// Write mode is checked live. Plant mode is checked when the player presses Check (or Enter); any edit
// hides the result again. When everything is right the carrots ripen and Next (or Enter) moves on.

const STORE_KEY = "placement-garden-v3";
const SANDBOX = -1;
const MODE_HELP = {
  write: [
    "Each rank's plot is its local tensor: the marked spots show which seed <code>to_local()</code> holds where.",
    "Type the placements that plant every marked spot with its seed, and nothing else. A seed in the wrong spot comes up as a weed.",
    "When every plot is right, press Enter or Next.",
  ],
  plant: [
    "The placements are given.",
    "Give each rank's plot its local tensor's shape: click empty ground to add land up to there and click a square of land to remove it (and its seed). The land counts once it fills a rectangle.",
    "Drag seeds from the global tensor into the positions <code>to_local()</code> would hold them. Drag a row or column handle (⠿) to plant the whole row or column; dropping on empty ground adds the land. Drag a planted square to move it, land and seed; drop it on another seed to swap them, or on the global tensor to dig it up. A rank's row and column handles (⠿) move a whole row or column of land the same way.",
    "Drag a rank's label (⠿) onto another rank to copy its plot there. You can also click a seed (or a row or column handle) and then a slot, or press Clear all. Snap to offset 0 packs every rank's land into its top-left corner, closing up the gaps.",
    "Press Check (or Enter) to see what's right.",
  ],
};

const $ = (sel) => document.querySelector(sel);
function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) if (c != null) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}

const state = {
  mode: "plant",
  level: 0,
  inputs: {},
  plantings: {},
  solved: { write: {}, plant: {} },
  sandbox: { shape: "8, 2", mesh: "2, 2", text: "_StridedShard(0, split_factor=2), Replicate()" },
  correct: false,
  checked: false,
  selected: null,
  howToOpen: false,
};
const SAVED = ["mode", "level", "inputs", "plantings", "solved", "sandbox", "howToOpen"];

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    for (const k of SAVED) if (k in saved) state[k] = saved[k];
  } catch (e) {
    // Storage can be unavailable (sandboxed viewers); progress just won't persist.
  }
}
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(SAVED.map((k) => [k, state[k]]))));
  } catch (e) {
    // See load().
  }
}

// ---------------------------------------------------------------- drawing

function seedColor(i, n) {
  const hue = Math.round((i * 360) / Math.max(n, 1) + 20) % 360;
  return `hsl(${hue}, 75%, 82%)`;
}

function seedIndex(shape, cell) {
  const pos = cell.split(",").map(Number);
  return shape.length === 1 ? pos[0] : pos[0] * shape[1] + pos[1];
}

// Seeds are lettered in flat (row-major) order, for 1-D and 2-D tensors alike.
function seedLabel(shape, cell) {
  return "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"[seedIndex(shape, cell)];
}

const dims2 = (shape) => (shape.length === 2 ? shape : [1, shape[0]]);
const prod = (xs) => xs.reduce((a, b) => a * b, 1);
const tupleText = (xs) => "(" + xs.join(", ") + (xs.length === 1 ? "," : "") + ")";
const sameShape = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// One garden cell. look: {plant: "carrot" | "weed" | null, marker, tag (a cell key)}.
function gardenCell(shape, look, attrs = {}) {
  const n = prod(shape);
  return el("div", { ...attrs, class: "plot" + (look.marker ? " planned" : "") + (attrs.class ? " " + attrs.class : "") },
    look.marker ? el("div", { class: "marker" }) : null,
    look.plant ? el("div", { class: `plant ${look.plant}` }, el("div", { class: "bg" })) : null,
    look.tag ? el("span", { class: "tag", style: `background:${seedColor(seedIndex(shape, look.tag), n)}` }, seedLabel(shape, look.tag)) : null);
}

// A rows x cols grid of cells. numbered: true for row and column numbers, "rows" for a row header
// only. cellAt(i, j) builds each cell; headAt(axis, n), if given, gives a header's attributes and text.
function grid(rows, cols, numbered, size, cellAt, headAt) {
  const head = (axis, n) => {
    const { text = String(n), ...attrs } = headAt ? headAt(axis, n) : {};
    return el("div", { ...attrs, class: "idx" + (attrs.class ? " " + attrs.class : "") }, text);
  };
  const g = el("div", { class: "footprint", style: `--cell:${size}px; grid-template-columns: ${numbered ? "auto " : ""}repeat(${cols}, ${size}px)` });
  if (numbered === true) {
    g.append(el("div", { class: "idx" }));
    for (let j = 0; j < cols; j++) g.append(head("col", j));
  }
  for (let i = 0; i < rows; i++) {
    if (numbered) g.append(head("row", i));
    for (let j = 0; j < cols; j++) g.append(cellAt(i, j));
  }
  return g;
}

const cellKey = (shape, i, j) => (shape.length === 1 ? String(j) : `${i},${j}`);
const planting = () => state.mode === "plant" && state.level !== SANDBOX;

// A whole row or column of the global tensor, as a payload that plants along the plot's row or column.
function linePayload(shape, line) {
  const [rows, cols] = dims2(shape);
  const n = +line.slice(1);
  return line[0] === "r"
    ? { cells: range(cols).map((j) => cellKey(shape, n, j)), dir: [0, 1], line }
    : { cells: range(rows).map((i) => cellKey(shape, i, n)), dir: [1, 0], line };
}

function renderSeeds(shape) {
  const [rows, cols] = dims2(shape);
  const two = shape.length === 2;
  const draggable = planting();
  // In plant mode a 1-D tensor gets a row handle so the whole row can be dragged.
  const numbered = two ? true : draggable ? "rows" : false;
  const band = $("#seeds-band");
  const size = Math.max(18, Math.min(40, Math.floor((band.clientHeight - 44 - (two ? 18 : 0)) / rows), Math.floor((band.clientWidth - 30 - (numbered ? (two && draggable ? 26 : 18) : 0)) / cols)));
  const sel = state.selected;
  const headAt = (axis, n) => {
    if (!draggable) return {};
    const line = (axis === "row" ? "r" : "c") + n;
    return { "data-line": line, draggable: "true", class: "line" + (sel && sel.line === line ? " selected" : ""),
      title: `drag to plant the whole ${axis}`, text: [el("span", { class: "grip" }, "⠿"), two ? String(n) : null] };
  };
  $("#seeds").innerHTML = "";
  $("#seeds").append(
    el("div", { class: "seeds-title" }, "Global tensor ", el("code", {}, "x"), `, shape ${tupleText(shape)}`),
    grid(rows, cols, numbered, size, (i, j) => {
      const cell = cellKey(shape, i, j);
      const selected = !!sel && (sel.line ? sel.cells.includes(cell) : sel.cells[0] === cell);
      return gardenCell(shape, { tag: cell }, { "data-seed": cell, draggable: draggable ? "true" : false, class: selected ? "selected" : "", title: draggable ? "drag into a plot" : false });
    }, headAt));
}

const sizeCache = {};

// One plot per rank, laid out like the mesh with a header for every mesh dim index. A 3-D mesh is
// drawn as one board group per mesh dim 0 index. plotAt(rank, size) returns {node, done}.
// The cell size is the largest that fits probeAt's plots (each at its biggest) in the board, and is
// cached per level, mode and board size so nothing moves while the player edits.
function renderBoard(mesh, plotAt, probeAt, cacheKey) {
  const groups = mesh.length === 3 ? mesh[0] : 1;
  const inner = mesh.length === 3 ? mesh.slice(1) : mesh;
  const [mr, mc] = dims2(inner);
  const colDim = mesh.length - 1;
  const rowDim = inner.length === 2 ? mesh.length - 2 : null;
  const field = $("#field");
  const board = $("#board");
  const draw = (size, at) => {
    field.innerHTML = "";
    for (let g = 0; g < groups; g++) {
      const group = el("div", { class: "board-group" + (mesh.length === 3 ? " framed" : ""), style: `grid-template-columns: ${rowDim !== null ? "auto " : ""}repeat(${mc}, auto)` },
        mesh.length === 3 ? el("div", { class: "group-label" }, `mesh dim 0 = ${g}`) : null);
      if (rowDim !== null) group.append(el("div"));
      for (let j = 0; j < mc; j++) group.append(el("div", { class: "mesh-head" }, `mesh dim ${colDim} = ${j}`));
      for (let i = 0; i < mr; i++) {
        if (rowDim !== null) group.append(el("div", { class: "mesh-head row" }, `mesh dim ${rowDim}`, el("br"), `= ${i}`));
        for (let j = 0; j < mc; j++) {
          const coord = mesh.length === 3 ? [g, i, j] : mesh.length === 2 ? [i, j] : [j];
          const r = rankOf(coord, mesh);
          const { node, done, note, status, handle } = at(r, size);
          group.append(el("div", { class: "rank" + (status ? ` ${status}` : ""), "data-rank": r },
            el("div", { class: "rank-label" + (handle ? " handle" : ""), draggable: handle ? "true" : false, "data-plot": handle ? r : false,
              title: handle ? "drag onto another rank to copy this plot there" : false },
              el("div", { class: "name" }, `rank ${r}`, done ? el("span", { class: "tick" }, " ✓") : null, " ", el("span", { class: "coord" }, tupleText(coord))),
              note ? el("div", { class: "local-shape" }, handle ? el("span", { class: "grip" }, "⠿ ") : null, `local ${note}`) : null),
            node));
        }
      }
      field.append(group);
    }
  };
  const fit = () => {
    let size = 80;
    for (let attempt = 0; attempt < 10; attempt++) {
      draw(size, probeAt);
      const ratio = Math.min((board.clientWidth - 4) / field.offsetWidth, (board.clientHeight - 4) / field.offsetHeight);
      if (ratio >= 1) return { size, fits: true };
      if (size <= 16) return { size, fits: false };
      size = Math.max(16, Math.min(size - 1, Math.floor(size * ratio)));
    }
    return { size, fits: false };
  };
  const key = `${cacheKey}|${board.clientWidth}x${board.clientHeight}`;
  let best = sizeCache[key];
  if (!best) {
    // A 3-D mesh's boards can sit side by side or stacked; take whichever gives bigger cells.
    const dirs = groups > 1 ? ["row", "column"] : ["row"];
    for (const dir of dirs) {
      field.style.flexDirection = dir;
      const r = { ...fit(), dir };
      if (!best || (r.fits && !best.fits) || (r.fits === best.fits && r.size > best.size)) best = r;
    }
    sizeCache[key] = best;
  }
  field.style.flexDirection = best.dir;
  draw(best.size, plotAt);
}

function ripen() {
  document.querySelectorAll("#field .plant.carrot").forEach((p) => p.classList.add("correct"));
}

// Write mode: each plot is the rank's local tensor. The plan's land and marked spots show which seed
// to_local() should hold where; the typed placements plant their local tensor on top, and a seed that
// isn't the planned one for its spot comes up as a weed. Without a target (the sandbox) the typed
// placements just plant. Returns unfilled marked spots and weeds.
function renderWriteField(shape, mesh, planted, plantedShapes, target, targetShapes) {
  const [gr, gc] = dims2(shape);
  const at = (cells, s, i, j) => {
    const [rows, cols] = dims2(s);
    return i < rows && j < cols ? cells[i * cols + j] : undefined;
  };
  const square = (r, i, j) => ({
    want: target ? at(target[r], targetShapes[r], i, j) : undefined,
    have: planted ? at(planted[r], plantedShapes[r], i, j) : undefined,
  });
  let empty = 0;
  let weeds = 0;
  const bad = range(nRanks(mesh)).map((r) => {
    let anyWeed = false;
    for (let i = 0; i < gr; i++) {
      for (let j = 0; j < gc; j++) {
        const { want, have } = square(r, i, j);
        if (want !== undefined && have !== want) empty++;
        if (target && have !== undefined && have !== want) {
          weeds++;
          anyWeed = true;
        }
      }
    }
    return anyWeed;
  });
  const plotAt = (r, size) => {
    const node = grid(gr, gc, shape.length === 2, size, (i, j) => {
      const { want, have } = square(r, i, j);
      const weed = !!target && have !== undefined && have !== want;
      if (have !== undefined) return gardenCell(shape, { plant: weed ? "weed" : "carrot", tag: have }, weed ? { class: "wrong" } : {});
      if (want !== undefined) return gardenCell(shape, { marker: true, tag: want });
      return el("div", { class: "untilled idle" });
    });
    const done = !!target && !!planted && sameShape(plantedShapes[r], targetShapes[r]) && planted[r].every((c, k) => c === target[r][k]);
    return { node, done, note: tupleText(target ? targetShapes[r] : plantedShapes[r]), status: done ? "ok" : bad[r] ? "bad" : null };
  };
  const key = state.level === SANDBOX ? `sandbox|${shape}|${mesh}` : `write|${state.level}`;
  renderBoard(mesh, plotAt, (r, size) => ({ ...plotAt(r, size), done: true }), key);
  return { empty, weeds };
}

// Plant mode: each plot is the player's guess at the rank's local tensor, land they till and fill with
// seeds. A seed is right if it sits where to_local() puts it.
function renderPlantField(lv, target, shapes) {
  const P = plantingsFor(lv);
  const two = lv.shape.length === 2;
  const [gr, gc] = dims2(lv.shape);
  const rightAt = (r, i, j, cell) => {
    const [tr, tc] = dims2(shapes[r]);
    return !!cell && i < tr && j < tc && cell === target[r][i * tc + j];
  };
  let wrongSize = 0;
  let weeds = 0;
  let missing = 0;
  const done = P.map((plot, r) => {
    let filledRight = 0;
    plot.seeds.forEach((cell, k) => {
      if (rightAt(r, Math.floor(k / gc), k % gc, cell)) filledRight++;
      else if (cell) weeds++;
    });
    const shape = plotShape(lv, plot);
    const shapeRight = !!shape && sameShape(shape, shapes[r]);
    if (!shapeRight) wrongSize++;
    missing += target[r].length - filledRight;
    return shapeRight && filledRight === target[r].length;
  });
  const allotment = (r, size, plot) => {
    const { rows, cols } = landBox(lv, plot);
    const g = grid(gr, gc, two, size, (i, j) => {
      const pos = `${r},${i},${j}`;
      const k = i * gc + j;
      if (!plot.land[k]) return el("div", { class: "untilled", "data-pos": pos, title: i < rows && j < cols ? "add land here" : "add land up to here" });
      const cell = plot.seeds[k];
      const wrong = state.checked && !!cell && !rightAt(r, i, j, cell);
      return gardenCell(lv.shape, { plant: cell ? (wrong ? "weed" : "carrot") : null, tag: cell },
        { class: "slot" + (wrong ? " wrong" : ""), "data-pos": pos, draggable: cell ? "true" : false });
    }, (axis, n) => ({ "data-rline": `${r},${axis},${n}`, draggable: "true", class: "line" + (axis === "col" && size < 28 ? " compact" : ""),
      title: `drag to move this ${axis}`, text: [el("span", { class: "grip" }, "⠿"), String(n)] }));
    return el("div", { class: "allotment" }, g);
  };
  const note = (plot) => {
    const shape = plotShape(lv, plot);
    return shape ? tupleText(shape) : two ? "(?, ?)" : "(?,)";
  };
  const full = { land: Array(gr * gc).fill(true), seeds: [] };
  renderBoard(lv.mesh,
    (r, size) => ({ node: allotment(r, size, P[r]), done: state.checked && done[r], note: note(P[r]),
      status: state.checked ? (done[r] ? "ok" : "bad") : null, handle: true }),
    (r, size) => ({ node: allotment(r, size, full), done: true, note: tupleText(lv.shape), handle: true }),
    `plant|${state.level}`);
  return { wrongSize, weeds, missing };
}

// A plot is its rank's allotment, the size of the global tensor: land[k] says whether square k
// (row-major over the allotment) is tilled and seeds[k] what's planted there. The local tensor is the
// land's bounding box, and the land only has a shape once it fills that box.
function emptyPlot(lv) {
  const n = prod(dims2(lv.shape));
  return { land: Array(n).fill(false), seeds: Array(n).fill(null) };
}

function landBox(lv, plot) {
  const gc = dims2(lv.shape)[1];
  let rows = 0;
  let cols = 0;
  let n = 0;
  plot.land.forEach((on, k) => {
    if (!on) return;
    n++;
    rows = Math.max(rows, Math.floor(k / gc) + 1);
    cols = Math.max(cols, (k % gc) + 1);
  });
  return { rows, cols, full: n === rows * cols };
}

// The plot's local tensor shape, or null while its land isn't a rectangle.
function plotShape(lv, plot) {
  const { rows, cols, full } = landBox(lv, plot);
  if (!full) return null;
  return lv.shape.length === 2 ? [rows, cols] : [cols];
}

function plantingsFor(lv) {
  const key = String(state.level);
  const n = nRanks(lv.mesh);
  const size = prod(dims2(lv.shape));
  const P = state.plantings[key];
  const fits = P && P.length === n && P.every((p) => p.land && p.land.length === size && p.seeds && p.seeds.length === size);
  if (!fits) state.plantings[key] = Array.from({ length: n }, () => emptyPlot(lv));
  return state.plantings[key];
}

const squareIndex = (i, j) => i * dims2(LEVELS[state.level].shape)[1] + j;
const plotOf = (r) => plantingsFor(LEVELS[state.level])[r];

function setLand(plot, k, on) {
  plot.land[k] = on;
  if (!on) plot.seeds[k] = null;
}

function edited() {
  state.checked = false;
  update();
}

// Add land at (i, j): just that square inside the land's bounding box (filling a hole), or the whole
// rectangle up to it outside.
function addLand(plot, i, j) {
  const lv = LEVELS[state.level];
  const { rows, cols } = landBox(lv, plot);
  if (i < rows && j < cols) return void (plot.land[squareIndex(i, j)] = true);
  for (let a = 0; a <= Math.max(rows - 1, i); a++) for (let b = 0; b <= Math.max(cols - 1, j); b++) plot.land[squareIndex(a, b)] = true;
}

function tillTo(r, i, j) {
  addLand(plotOf(r), i, j);
  edited();
}

// Remove a square of land and its seed.
function untill(r, i, j) {
  setLand(plotOf(r), squareIndex(i, j), false);
  edited();
}

function renderLegend() {
  const legend = $("#legend");
  legend.innerHTML = "";
  if (state.level === SANDBOX) return;
  const swatch = (node) => el("div", { class: "footprint", style: "--cell:36px; grid-template-columns: 36px" }, node);
  const sample = (look, extra = {}) => swatch(gardenCell([1], look, extra));
  const rows = planting()
    ? [[swatch(el("div", { class: "untilled" })), "empty ground: click to add a plot of land; click land to remove it"],
      [sample({ plant: "carrot", tag: "0" }), "right seed, right place (after Check)"],
      [sample({ plant: "weed", tag: "0" }, { class: "wrong" }), "wrong seed or place (after Check)"]]
    : [[sample({ marker: true, tag: "0" }), "marked: should be planted here"],
      [sample({ plant: "carrot", tag: "0" }), "planted as planned"],
      [sample({ plant: "weed", tag: "0" }, { class: "wrong" }), "weed: wrong seed for this spot"]];
  for (const [icon, text] of rows) legend.append(icon, el("span", {}, text));
}

function codeLines(text) {
  return text === "" ? 0 : text.split("\n").length;
}

function updateLineNumbers() {
  const code = $("#code");
  let middle = 0;
  if (code.style.display !== "none") {
    code.style.height = "24px";
    code.style.height = code.scrollHeight + "px";
    middle = Math.max(1, Math.round(code.scrollHeight / 24));
  }
  const n = codeLines($("#before").textContent) + middle + codeLines($("#after").textContent);
  $(".line-numbers").innerHTML = Array.from({ length: Math.max(n, 6) }, (_, i) => i + 1).join("<br>");
}

// ---------------------------------------------------------------- levels

function renderCounter() {
  const sandbox = state.level === SANDBOX;
  $("#level-indicator .current").textContent = sandbox ? "✱" : String(state.level + 1);
  $("#level-indicator .total").textContent = String(LEVELS.length);
  $(".arrow.left").classList.toggle("disabled", state.level === 0);
  $(".arrow.right").classList.toggle("disabled", sandbox);
  const levels = $("#levels");
  levels.innerHTML = "";
  LEVELS.forEach((lv, i) => levels.append(el("span", {
    class: "level-marker" + (i === state.level ? " current" : "") + (state.solved[state.mode][i] ? " solved" : ""),
    title: lv.title, onclick: () => go(i),
  }, String(i + 1))));
  levels.append(el("span", { class: "level-marker" + (sandbox ? " current" : ""), title: "Sandbox: plant anything", onclick: () => go(SANDBOX) }, "✱"));
  document.querySelectorAll("#mode span").forEach((s) => s.classList.toggle("active", s.dataset.mode === state.mode));
}

function renderLevel() {
  state.correct = false;
  state.checked = false;
  state.selected = null;
  document.body.classList.toggle("plant-mode", planting());
  $("#board").classList.remove("win");
  $("#editor").style.display = "";
  $("#levelsWrapper").style.display = "none";
  $("#hint").textContent = "";
  const sandbox = state.level === SANDBOX;
  $("#hint-btn").classList.toggle("disabled", sandbox);
  $("#solution-btn").classList.toggle("disabled", sandbox);
  renderCounter();
  if (sandbox) return renderSandbox();

  const lv = LEVELS[state.level];
  const { before, after } = fixedCounts(lv);
  const sol = parseLevelSolution(lv);
  const nEdit = lv.mesh.length - before - after;
  $("#instructions").innerHTML = planting() && lv.plantInstructions !== undefined ? lv.plantInstructions : lv.instructions;
  $("#instructions").prepend(howTo());

  const lines = [
    `x = torch.arange(${prod(lv.shape)})${lv.shape.length === 2 ? `.reshape(${lv.shape.join(", ")})` : ""}`,
    `mesh = init_device_mesh("cpu", ${tupleText(lv.mesh)})`,
    "dtensor = distribute_tensor(x, mesh, placements=[",
  ];
  const pre = $("#before");
  const post = $("#after");
  pre.innerHTML = "";
  post.innerHTML = "";
  pre.append(lines.join("\n"));
  const code = $("#code");
  if (planting()) {
    sol.forEach((p) => pre.append("\n", `    ${placementName(p)},`));
    code.style.display = "none";
  } else {
    sol.slice(0, before).forEach((p) => pre.append("\n", el("span", { class: "fixed" }, `    ${placementName(p)},`), el("span", { class: "comment" }, "  # fixed")));
    sol.slice(sol.length - after).forEach((p) => post.append(el("span", { class: "fixed" }, `    ${placementName(p)},`), el("span", { class: "comment" }, "  # fixed"), "\n"));
    code.style.display = "";
    code.value = state.inputs[state.level] ?? "";
    code.placeholder = nEdit === 1 ? "one placement, e.g. Shard(0)" : `${nEdit} placements, e.g. Shard(0), Replicate()`;
  }
  post.append(planting() ? "])\nlocal = dtensor.to_local()" : "])");
  update();
  if (!planting()) code.focus();
}

// The mode's controls, in a "How to play" section that starts collapsed and remembers being opened.
function howTo() {
  const details = el("details", { class: "how-to", open: state.howToOpen ? "" : false },
    el("summary", {}, "How to play"),
    el("ul", { html: MODE_HELP[state.mode].map((step) => `<li>${step}</li>`).join("") }));
  details.addEventListener("toggle", () => {
    state.howToOpen = details.open;
    save();
  });
  return details;
}

function setNext(correct) {
  const wasCorrect = state.correct;
  state.correct = correct;
  // Plant mode's button checks the garden until it has been checked and found right.
  $("#next").textContent = planting() && !correct ? "Check" : "Next";
  if (correct) {
    state.solved[state.mode][state.level] = true;
    ripen();
  }
  $("#board").classList.toggle("solved", correct);
  const next = $("#next");
  next.classList.toggle("disabled", !correct && !planting());
  if (correct && !wasCorrect) next.classList.add("animation");
  if (!correct) next.classList.remove("animation");
}

function update() {
  updateLineNumbers();
  renderLegend();
  if (state.level === SANDBOX) return updateSandbox();
  const lv = LEVELS[state.level];
  renderSeeds(lv.shape);
  if (planting()) return updatePlant(lv);
  const { before, after } = fixedCounts(lv);
  const parsed = parsePlacements($("#code").value, lv.shape.length, lv.mesh.length - before - after);
  const full = parsed.error ? null : fullPlacements(lv, parsed.placements);
  const planted = full && layout(lv.shape, lv.mesh, full);
  const plantedShapes = full && localShapes(lv.shape, lv.mesh, full);
  const { empty, weeds } = renderWriteField(lv.shape, lv.mesh, planted, plantedShapes, targetOf(lv), localShapes(lv.shape, lv.mesh, parseLevelSolution(lv)));
  setNext(!!planted && empty === 0 && weeds === 0);
  markCode(parsed.error);
  save();
  renderCounter();
}

function updatePlant(lv) {
  const target = targetOf(lv);
  const shapes = localShapes(lv.shape, lv.mesh, parseLevelSolution(lv));
  const { wrongSize, weeds, missing } = renderPlantField(lv, target, shapes);
  setNext(state.checked && wrongSize === 0 && weeds === 0 && missing === 0);
  save();
  renderCounter();
}

// Red input with the parse error as its tooltip; green once the garden is right.
function markCode(error) {
  const code = $("#code");
  const typed = code.value.trim() !== "";
  code.classList.toggle("error", !!error && typed);
  code.classList.toggle("ok", state.correct);
  code.title = error && typed ? error : "";
}

function go(i) {
  state.level = i;
  save();
  renderLevel();
}

function shake() {
  const editor = $("#editor");
  editor.classList.remove("shake");
  void editor.offsetWidth;
  editor.classList.add("shake");
}

function advance() {
  if (state.level === SANDBOX) return;
  // In plant mode the first press only checks, so a right answer shows its result before moving on.
  if (planting() && !state.checked) {
    state.checked = true;
    state.selected = null;
    update();
    if (!state.correct) shake();
    return;
  }
  if (!state.correct) return shake();
  if (state.level >= LEVELS.length - 1) win();
  else go(state.level + 1);
}

function win() {
  $("#board").classList.add("win");
  $("#editor").style.display = "none";
  $("#hint").textContent = state.mode === "write"
    ? "You planted every garden! Try Place seeds mode, or the ✱ sandbox in the level menu."
    : "You placed every seed! Try Write placements mode, or the ✱ sandbox in the level menu.";
}

function showHint() {
  if (state.level === SANDBOX) return;
  const lv = LEVELS[state.level];
  if (!planting()) return void ($("#hint").textContent = "Hint: " + lv.hint);
  const target = targetOf(lv);
  const shapes = localShapes(lv.shape, lv.mesh, parseLevelSolution(lv));
  const P = plantingsFor(lv);
  const two = lv.shape.length === 2;
  for (let r = 0; r < shapes.length; r++) {
    const shape = plotShape(lv, P[r]);
    if (!shape || !sameShape(shape, shapes[r])) return void ($("#hint").textContent = `Hint: rank ${r}'s local tensor has shape ${tupleText(shapes[r])}.`);
  }
  for (let r = 0; r < shapes.length; r++) {
    const cols = two ? shapes[r][1] : shapes[r][0];
    for (let k = 0; k < target[r].length; k++) {
      if (P[r].seeds[squareIndex(Math.floor(k / cols), k % cols)] !== target[r][k]) {
        const pos = two ? `[${Math.floor(k / cols)}, ${k % cols}]` : `[${k}]`;
        return void ($("#hint").textContent = `Hint: rank ${r}'s local${pos} is seed ${seedLabel(lv.shape, target[r][k])}.`);
      }
    }
  }
  $("#hint").textContent = "Everything is in place.";
}

function showSolution() {
  if (state.level === SANDBOX) return;
  const lv = LEVELS[state.level];
  if (planting()) {
    const shapes = localShapes(lv.shape, lv.mesh, parseLevelSolution(lv));
    state.plantings[String(state.level)] = targetOf(lv).map((cells, r) => {
      const plot = emptyPlot(lv);
      const [tr, tc] = dims2(shapes[r]);
      for (let a = 0; a < tr; a++) {
        for (let b = 0; b < tc; b++) {
          plot.land[squareIndex(a, b)] = true;
          plot.seeds[squareIndex(a, b)] = cells[a * tc + b];
        }
      }
      return plot;
    });
  } else {
    const { before, after } = fixedCounts(lv);
    const text = lv.solution.slice(before, lv.solution.length - after).join(", ");
    $("#code").value = text;
    state.inputs[state.level] = text;
  }
  update();
}

// ---------------------------------------------------------------- planting by hand

// A payload is what gets planted: {cells, dir: [di, dj]}, with cells going into consecutive positions
// along dir. A square dragged from a plot adds from: its {r, i, j}. A row or column dragged from a plot
// adds fromLine: {r, axis, n}, and its cells are null for empty land and undefined where there's no land.
const seedPayload = (cell) => ({ cells: [cell], dir: [0, 1] });

const lineSquare = ({ axis, n }, t) => (axis === "row" ? squareIndex(n, t) : squareIndex(t, n));

function rankLinePayload(r, axis, n) {
  const plot = plotOf(r);
  const { rows, cols } = landBox(LEVELS[state.level], plot);
  const fromLine = { r, axis, n };
  const cells = range(axis === "row" ? cols : rows).map((t) => {
    const k = lineSquare(fromLine, t);
    return plot.land[k] ? plot.seeds[k] : undefined;
  });
  return cells.some((c) => c !== undefined) ? { cells, dir: axis === "row" ? [0, 1] : [1, 0], fromLine } : null;
}

function removeLine({ cells, fromLine }) {
  const src = plotOf(fromLine.r);
  cells.forEach((c, t) => {
    if (c !== undefined) setLand(src, lineSquare(fromLine, t), false);
  });
}

// The allotment positions a payload dropped at (i, j) lands on; cells past the allotment's edge are dropped.
function landing(payload, i, j) {
  const [gr, gc] = dims2(LEVELS[state.level].shape);
  const [di, dj] = payload.dir;
  return payload.cells.map((cell, t) => [i + t * di, j + t * dj, cell]).filter(([a, b, cell]) => a < gr && b < gc && cell !== undefined);
}

// Plant a payload at plot r's (i, j), adding land under it. A square dragged from a plot takes its land
// along, unless it lands on another seed, which then swaps back into the square it came from. A row or
// column dragged from a plot moves its land exactly, replacing whatever it lands on.
function plantAt(payload, r, i, j) {
  const plot = plotOf(r);
  const spots = landing(payload, i, j);
  if (payload.fromLine) {
    removeLine(payload);
    for (const [a, b, cell] of spots) {
      plot.land[squareIndex(a, b)] = true;
      plot.seeds[squareIndex(a, b)] = cell;
    }
    return edited();
  }
  for (const [a, b] of spots) if (!plot.land[squareIndex(a, b)]) addLand(plot, a, b);
  const { from } = payload;
  if (from) {
    if (from.r === r && from.i === i && from.j === j) return;
    const k = squareIndex(i, j);
    const prev = plot.seeds[k];
    plot.seeds[k] = payload.cells[0];
    const source = plotOf(from.r);
    if (prev) source.seeds[squareIndex(from.i, from.j)] = prev;
    else setLand(source, squareIndex(from.i, from.j), false);
  } else {
    for (const [a, b, cell] of spots) plot.seeds[squareIndex(a, b)] = cell;
  }
  edited();
}

function copyPlot(src, dst) {
  if (src === dst) return;
  const P = plantingsFor(LEVELS[state.level]);
  P[dst] = { land: P[src].land.slice(), seeds: P[src].seeds.slice() };
  edited();
}

// Pack each plot's land, seeds and all, into the top-left corner: rows with no land are dropped, and
// each remaining row's squares close up to the left in order.
function snapAll() {
  const lv = LEVELS[state.level];
  const [gr, gc] = dims2(lv.shape);
  plantingsFor(lv).forEach((plot, r, P) => {
    const packed = emptyPlot(lv);
    let a = 0;
    for (let i = 0; i < gr; i++) {
      const row = range(gc).map((j) => i * gc + j).filter((k) => plot.land[k]);
      if (!row.length) continue;
      row.forEach((k, b) => {
        packed.land[a * gc + b] = true;
        packed.seeds[a * gc + b] = plot.seeds[k];
      });
      a++;
    }
    P[r] = packed;
  });
  edited();
}

function clearAll() {
  delete state.plantings[String(state.level)];
  state.checked = false;
  state.selected = null;
  update();
}

function wirePlanting() {
  const posOf = (node) => {
    const p = node.closest && node.closest("[data-pos]");
    if (!p) return null;
    const [r, i, j] = p.dataset.pos.split(",").map(Number);
    return { r, i, j, slot: p.classList.contains("slot") };
  };
  // A rank's row or column header drops at the start of that row or column.
  const dropPosOf = (node) => {
    const pos = posOf(node);
    const head = node.closest && node.closest("[data-rline]");
    if (pos || !head) return pos;
    const [r, axis, n] = head.dataset.rline.split(",");
    return axis === "row" ? { r: +r, i: +n, j: 0 } : { r: +r, i: 0, j: +n };
  };
  const cellAt = ({ r, i, j }) => plotOf(r).seeds[squareIndex(i, j)];
  // What's being dragged: a payload, or {plot: r}. Kept here because drag data can't be read until the drop.
  let dragging = null;
  const unhover = () => document.querySelectorAll(".drop-hover").forEach((n) => n.classList.remove("drop-hover"));
  document.addEventListener("dragstart", (e) => {
    if (!planting()) return;
    const t = e.target;
    const shape = LEVELS[state.level].shape;
    const plot = t.closest && t.closest("[data-plot]");
    const line = t.closest && t.closest("[data-line]");
    const rline = t.closest && t.closest("[data-rline]");
    const seed = t.closest && t.closest("[data-seed]");
    const pos = posOf(t);
    dragging = null;
    if (plot) {
      dragging = { plot: +plot.dataset.plot };
      const fp = plot.closest(".rank").querySelector(".allotment .footprint");
      if (fp) e.dataTransfer.setDragImage(fp, 0, 0);
    } else if (line) dragging = linePayload(shape, line.dataset.line);
    else if (rline) {
      const [r, axis, n] = rline.dataset.rline.split(",");
      dragging = rankLinePayload(+r, axis, +n);
    }
    else if (seed) dragging = seedPayload(seed.dataset.seed);
    else if (pos && pos.slot && cellAt(pos)) dragging = { cells: [cellAt(pos)], dir: [0, 1], from: { r: pos.r, i: pos.i, j: pos.j } };
    if (!dragging) return;
    e.dataTransfer.setData("text/plain", "");
    e.dataTransfer.effectAllowed = "copyMove";
  });
  document.addEventListener("dragover", (e) => {
    if (!planting() || !dragging) return;
    unhover();
    if (dragging.plot !== undefined) {
      const rank = e.target.closest(".rank[data-rank]");
      if (rank && +rank.dataset.rank !== dragging.plot) {
        e.preventDefault();
        rank.classList.add("drop-hover");
      }
      return;
    }
    const pos = dropPosOf(e.target);
    if (pos) {
      e.preventDefault();
      // Preview every position the payload would land on.
      for (const [a, b] of landing(dragging, pos.i, pos.j)) {
        const n = document.querySelector(`[data-pos="${pos.r},${a},${b}"]`);
        if (n) n.classList.add("drop-hover");
      }
    } else if ((dragging.from || dragging.fromLine) && e.target.closest("#seeds")) e.preventDefault();
  });
  document.addEventListener("drop", (e) => {
    if (!planting() || !dragging) return;
    e.preventDefault();
    const payload = dragging;
    dragging = null;
    unhover();
    if (payload.plot !== undefined) {
      const rank = e.target.closest(".rank[data-rank]");
      if (rank) copyPlot(payload.plot, +rank.dataset.rank);
      return;
    }
    const pos = dropPosOf(e.target);
    if (pos) plantAt(payload, pos.r, pos.i, pos.j);
    else if (e.target.closest("#seeds") && payload.fromLine) {
      removeLine(payload);
      edited();
    } else if (e.target.closest("#seeds") && payload.from) untill(payload.from.r, payload.from.i, payload.from.j);
  });
  document.addEventListener("dragend", () => {
    dragging = null;
    unhover();
  });
  document.addEventListener("click", (e) => {
    if (!planting()) return;
    if (e.target.closest("#clear-all")) return clearAll();
    if (e.target.closest("#snap")) return snapAll();
    const shape = LEVELS[state.level].shape;
    const line = e.target.closest("[data-line]");
    const seed = e.target.closest("[data-seed]");
    const pos = posOf(e.target);
    const sel = state.selected;
    if (line || seed) {
      const payload = line ? linePayload(shape, line.dataset.line) : seedPayload(seed.dataset.seed);
      const same = sel && sel.line === payload.line && sel.cells[0] === payload.cells[0];
      state.selected = same ? null : payload;
      update();
    } else if (pos) {
      // A selection from the global tensor stays selected so it can go into several plots (Replicate).
      if (sel) plantAt(sel, pos.r, pos.i, pos.j);
      else if (pos.slot) untill(pos.r, pos.i, pos.j);
      else tillTo(pos.r, pos.i, pos.j);
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.selected) {
      state.selected = null;
      update();
    } else if (e.key === "Enter" && planting() && e.target === document.body) {
      advance();
    }
  });
}

// ---------------------------------------------------------------- sandbox

// Parse "4, 4" into [4, 4]. Returns {dims} or {error}: at most maxDims dims of 1 to 8 each, whose
// product is at most maxTotal.
function parseShape(text, what, maxDims, maxTotal, unit) {
  const parts = text.replace(/[()[\]]/g, "").split(/[\s,]+/).filter(Boolean);
  if (!parts.length || !parts.every((p) => /^\d+$/.test(p))) return { error: `${what}: whole numbers separated by commas, like 4, 4` };
  if (parts.length > maxDims) return { error: `${what}: at most ${maxDims} dims` };
  const dims = parts.map(Number);
  if (!dims.every((n) => n >= 1 && n <= 8)) return { error: `${what}: each dim must be 1 to 8` };
  if (prod(dims) > maxTotal) return { error: `${what}: at most ${maxTotal} ${unit} (this has ${prod(dims)})` };
  return { dims };
}

function renderSandbox() {
  $("#instructions").innerHTML = "<p>No plan here: pick a tensor shape, a mesh and placements, and see which seeds every rank gets. Handy for checking your intuition, or for designing your own puzzles.</p>";
  const inp = (key) => {
    const i = el("input", { class: "inline", value: state.sandbox[key], spellcheck: "false", "aria-label": key });
    i.addEventListener("input", () => { state.sandbox[key] = i.value; save(); update(); });
    return i;
  };
  const pre = $("#before");
  pre.innerHTML = "";
  pre.append("shape = (", inp("shape"), ")\n", 'mesh = init_device_mesh("cpu", (', inp("mesh"), "))\n", "dtensor = distribute_tensor(torch.arange(prod(shape)).reshape(shape), mesh, placements=[");
  $("#after").textContent = "])";
  const code = $("#code");
  code.style.display = "";
  code.value = state.sandbox.text;
  code.placeholder = "";
  $("#next").classList.add("disabled");
  update();
}

function updateSandbox() {
  state.sandbox.text = $("#code").value;
  save();
  // One seed per letter, and few enough ranks for the board to fit.
  const shapeIn = parseShape(state.sandbox.shape, "shape", 2, 52, "elements, one per seed letter");
  const meshIn = parseShape(state.sandbox.mesh, "mesh", 3, 16, "ranks");
  $("#seeds").innerHTML = "";
  $("#field").innerHTML = "";
  $("#board").classList.remove("solved");
  $("#hint").textContent = "";
  for (const [key, parsedIn] of [["shape", shapeIn], ["mesh", meshIn]]) {
    const input = document.querySelector(`#before input[aria-label="${key}"]`);
    input.classList.toggle("error", !!parsedIn.error);
    input.title = parsedIn.error || "";
  }
  const error = shapeIn.error || meshIn.error;
  if (error) return void ($("#hint").textContent = error);
  const shape = shapeIn.dims;
  const mesh = meshIn.dims;
  renderSeeds(shape);
  const parsed = parsePlacements(state.sandbox.text, shape.length, mesh.length);
  state.correct = false;
  markCode(parsed.error);
  if (parsed.error) return void ($("#hint").textContent = parsed.error);
  renderWriteField(shape, mesh, layout(shape, mesh, parsed.placements), localShapes(shape, mesh, parsed.placements), null, null);
}

// ---------------------------------------------------------------- wiring

window.addEventListener("load", () => {
  load();
  if (state.level !== SANDBOX && !(state.level >= 0 && state.level < LEVELS.length)) state.level = 0;
  if (!(state.mode in MODE_HELP)) state.mode = "plant";

  const code = $("#code");
  code.addEventListener("input", () => {
    if (state.level !== SANDBOX) state.inputs[state.level] = code.value;
    update();
  });
  code.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      advance();
    }
  });
  $("#next").addEventListener("click", () => {
    if (!planting()) code.focus();
    advance();
  });
  $("#editor").addEventListener("animationend", () => $("#editor").classList.remove("shake"));
  $("#hint-btn").addEventListener("click", showHint);
  $("#solution-btn").addEventListener("click", showSolution);
  document.querySelectorAll("#mode span").forEach((s) => s.addEventListener("click", () => {
    if (state.mode === s.dataset.mode) return;
    state.mode = s.dataset.mode;
    save();
    renderLevel();
  }));
  $("#level-indicator").addEventListener("click", () => {
    const w = $("#levelsWrapper");
    w.style.display = w.style.display === "block" ? "none" : "block";
  });
  $(".arrow.left").addEventListener("click", () => {
    if (state.level === SANDBOX) go(LEVELS.length - 1);
    else if (state.level > 0) go(state.level - 1);
  });
  $(".arrow.right").addEventListener("click", () => {
    if (state.level === SANDBOX) return;
    go(state.level < LEVELS.length - 1 ? state.level + 1 : SANDBOX);
  });
  // Sandboxed iframes block confirm(), so ask with a second click instead.
  $("#labelReset").addEventListener("click", (e) => {
    const btn = e.currentTarget;
    if (!btn.dataset.armed) {
      btn.dataset.armed = "1";
      btn.textContent = "Click again to reset";
      setTimeout(() => { delete btn.dataset.armed; btn.textContent = "Reset"; }, 3000);
      return;
    }
    delete btn.dataset.armed;
    btn.textContent = "Reset";
    state.inputs = {};
    state.plantings = {};
    state.solved = { write: {}, plant: {} };
    go(0);
  });
  wirePlanting();
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (!$("#board").classList.contains("win")) update(); }, 150);
  });
  renderLevel();
});
