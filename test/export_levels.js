// Prints every level's shape, mesh, reference placements and target layout as JSON for torch_check.py.
const path = require("path");
const G = require(path.join(__dirname, "../js/garden.js"));
const { LEVELS } = require(path.join(__dirname, "../js/levels.js"));
console.log(JSON.stringify(LEVELS.map((lv) => ({
  title: lv.title, shape: lv.shape, mesh: lv.mesh,
  placements: G.parseLevelSolution(lv), target: G.targetOf(lv),
  local_shapes: G.localShapes(lv.shape, lv.mesh, G.parseLevelSolution(lv)),
}))));
