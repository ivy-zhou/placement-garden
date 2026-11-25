// Paste into the browser console on the game page: walks every level in both modes and
// reports labels that overlap each other, get cut off, or stick out of the board.
() => {
  const SEL = [".tag", ".mesh-head", ".group-label", ".rank-label .name", ".rank-label .local-shape",
    ".idx", ".seeds-title", "#legend > span", "#clear-all", "#snap"].join(",");
  const issues = [];
  const scan = (where) => {
    const els = [...document.querySelectorAll(SEL)].filter((e) => e.offsetParent && e.textContent.trim());
    const rects = els.map((e) => e.getBoundingClientRect());
    const board = document.querySelector("#board").getBoundingClientRect();
    els.forEach((e, a) => {
      const r = rects[a];
      if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== "visible") issues.push(`${where}: cut off "${e.textContent}"`);
      if (e.closest("#board") && (r.left < board.left - 1 || r.right > board.right + 1 || r.top < board.top - 1 || r.bottom > board.bottom + 1)) issues.push(`${where}: outside board "${e.textContent}"`);
      for (let b = a + 1; b < els.length; b++) {
        const q = rects[b];
        if (e.contains(els[b]) || els[b].contains(e)) continue;
        const w = Math.min(r.right, q.right) - Math.max(r.left, q.left);
        const h = Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top);
        if (w > 1 && h > 1) issues.push(`${where}: "${e.textContent.slice(0, 20)}" overlaps "${els[b].textContent.slice(0, 20)}"`);
      }
    });
  };
  for (let i = 0; i < LEVELS.length; i++) {
    state.mode = "write"; state.inputs = {}; go(i); scan(`write ${i + 1} empty`);
    document.querySelector("#solution-btn").click(); scan(`write ${i + 1} solved`);
    state.mode = "plant"; state.plantings = {}; go(i); scan(`plant ${i + 1} empty`);
    document.querySelector("#solution-btn").click(); document.querySelector("#next").click(); scan(`plant ${i + 1} checked`);
  }
  state.mode = "write"; state.inputs = {}; state.plantings = {}; localStorage.clear();
  return issues.length ? `${issues.length} issues:\n` + [...new Set(issues)].slice(0, 60).join("\n") : "no label issues";
}
