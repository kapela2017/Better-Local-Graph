/* Node-only contract checks for the injected module. No vault writes. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

class TFolder {
  constructor(pathname) { this.path = pathname; }
}
class TFile {
  constructor(pathname, parent) {
    this.path = pathname; this.parent = parent;
    this.name = pathname.split("/").pop(); this.basename = this.name.replace(/\.md$/i, ""); this.extension = "md";
  }
}
const obsidian = { TFile, TFolder, Notice: class { constructor() {} } };
const source = fs.readFileSync(path.join(__dirname, "blg-folder-drops.js"), "utf8");
const bundle = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");
assert.equal(bundle.slice(bundle.indexOf("/* ============================================================\n   Better Local Graph — Gotas de ubicación")), source);
const dict = {};
vm.runInNewContext(bundle.slice(bundle.indexOf('var BLG_LANG="es";'), bundle.indexOf("function L(k)")) + "\nglobalThis.dict = BLG_T;", dict);
const usedKeys = new Set(Array.from(source.matchAll(/\b(?:T|msg|notice)\(\s*["']([A-Za-z]\w+)["']/g), m => m[1]));
for (const key of usedKeys) for (const lang of ["es", "en"]) assert.ok(key in dict.dict[lang], `${lang}: ${key}`);
const instrumented = source.replace("  var _onload = PLUGIN_PROTO.onload", "  globalThis.__BLG_DROPS_TEST = { collect, arrange, camera, dropPath, dropLabel, defaults, hitDrop, hoverDrop, dropColors, clonePos, capturePositions, anchorPan, jellyStep, hoverStep, resetJelly, dragVelocity, tagMatches, tagGraphNodeIds, tagEdgeDescriptors };\n  var _onload = PLUGIN_PROTO.onload");
assert.notEqual(instrumented, source);
const context = { module: { exports: { default: class { onload() {} onunload() {} } } },
  require(name) { if (name === "obsidian") return obsidian; return require(name); },
  document: { body: { classList: { contains: () => false } } }, console, globalThis: null };
context.globalThis = context;
vm.runInNewContext(instrumented, context, { filename: "blg-folder-drops.js" });
const api = context.__BLG_DROPS, pure = context.__BLG_DROPS_TEST;
assert.deepEqual(Object.keys(api), ["addMoveToMenu", "openFolderPicker", "moveFiles", "resolveFile", "colors"]);

function fixture() {
  const folders = ["/", "ia/agentes", "docs/agentes", "out", "excluded"].map(p => new TFolder(p));
  const byPath = new Map(folders.map(f => [f.path, f]));
  function note(name, parent) {
    const f = new TFile(name, byPath.get(parent)); byPath.set(name, f); return f;
  }
  const a = note("ia/agentes/Uno.md", "ia/agentes");
  const b = note("ia/agentes/Dos.md", "ia/agentes");
  const c = note("docs/agentes/Tres.md", "docs/agentes");
  const x = note("excluded/No.md", "excluded");
  const vault = {
    getAbstractFileByPath(p) { return byPath.get(p) || null; }, getRoot() { return byPath.get("/"); },
    getMarkdownFiles() { return Array.from(byPath.values()).filter(f => f instanceof TFile); },
    async copy(f, p) { const to = byPath.get(p.split("/").slice(0, -1).join("/")); const copy = new TFile(p, to); byPath.set(p, copy); return copy; }
  };
  let renameCalls = 0, refreshes = 0, moves = [];
  const app = { vault, fileManager: { async renameFile(f, p) {
    renameCalls++; byPath.delete(f.path); f.path = p;
    f.parent = byPath.get(p.split("/").slice(0, -1).join("/")); f.name = p.split("/").pop(); byPath.set(p, f);
  } } };
  const view = { currentPath: a.path, _scheduleRefresh() { refreshes++; },
    _blgDropsMoved(result, copy) { moves.push({ result, copy }); }, cy: { nodes() {
    return [a, b, c, x].map(f => ({ id: () => f.path, visible: () => true, style: () => "element", position: () => ({ x: 0, y: 0 }) }));
  } } };
  const settings = { excludedFolders: ["excluded"], dropsMaxFolders: 15, dropsSize: 1,
    dropsZoomOut: true, dropsMinZoom: 0.2, dropsGooBlur: 10, dropsBorderWidth: 1,
    dropsColor: "#63bfe7", dropsOpacity: 0.22, dropsLabelSize: 0.85 };
  const plugin = { app, settings, getView: () => view };
  return { a, b, c, x, plugin, view, vault, byPath, get moves() { return moves; }, get renameCalls() { return renameCalls; }, get refreshes() { return refreshes; } };
}

function contextMenuOpens(plugin, nodeId) {
  const start = bundle.indexOf('this.cy.on("cxttap","node",a=>{');
  const endMarker = 's.showAtPosition({x:u.clientX,y:u.clientY})})';
  const end = bundle.indexOf(endMarker, start) + endMarker.length;
  assert.ok(start >= 0 && end >= start);
  let callback, opened = false;
  const cy = { on(name, selector, fn) { assert.equal(name, "cxttap"); callback = fn; } };
  const Menu = class { addItem(fn) { const item = {
    setTitle() { return this; }, setIcon() { return this; }, onClick() { return this; }
  }; fn(item); } showAtPosition() { opened = true; } };
  const scope = { Oe: { TFile, Menu }, L: key => key, __BLG_DROPS: api };
  const install = vm.runInNewContext(`(function(){${bundle.slice(start, end)}})`, scope);
  install.call({ cy, app: plugin.app, plugin, currentPath: null,
    _blgDropsAlias: plugin.getView()._blgDropsAlias });
  callback({ target: { id: () => nodeId }, originalEvent: { clientX: 1, clientY: 1 } });
  return opened;
}

function nodeTapOpens(plugin, nodeId) {
  const start = bundle.indexOf('this.cy.on("tap","node",a=>{');
  const endMarker = 'this.app.workspace.getLeaf(!1).openFile(i)})';
  const end = bundle.indexOf(endMarker, start) + endMarker.length;
  assert.ok(start >= 0 && end >= start);
  let callback, opened = null;
  plugin.app.workspace = { getLeaf() { return { openFile(file) { opened = file; } }; } };
  const cy = { on(_name, _selector, fn) { callback = fn; } };
  const scope = { Oe: { TFile }, __BLG_DROPS: api };
  vm.runInNewContext(`(function(){${bundle.slice(start, end)}})`, scope)
    .call({ cy, app: plugin.app, plugin, _blgDropsAlias: plugin.getView()._blgDropsAlias });
  callback({ target: { id: () => nodeId }, originalEvent: {} });
  return opened;
}

/* BLG-TAG-FOCUS: en Tag View el primer tap centra con ease-in-cubic y el
   segundo abre la nota. Ejecuta el handler real extraído del bundle. */
function tagTapFocusOpensOnSecondClick() {
  const start = bundle.indexOf('this.cy.on("tap","node",a=>{');
  const endMarker = 'this.app.workspace.getLeaf(!1).openFile(i)})';
  const end = bundle.indexOf(endMarker, start) + endMarker.length;
  assert.ok(start >= 0 && end >= start);
  assert.ok(bundle.slice(start, end).includes("BLG-TAG-FOCUS"), "the bundle tap handler carries the two-click focus");
  const fileA = new TFile("out/Uno.md", new TFolder("out"));
  const fileB = new TFile("out/Dos.md", new TFolder("out"));
  function run(behavior) {
    let callback, opened = null, animateCalls = [], stopped = 0, selToggled = 0;
    const nodes = {
      "out/Uno.md": { id: () => "out/Uno.md", position: () => ({ x: 100, y: 50 }) },
      "out/Dos.md": { id: () => "out/Dos.md", position: () => ({ x: -30, y: 80 }) }
    };
    const cy = { on(_n, _s, fn) { callback = fn; }, zoom: () => 1, width: () => 800, height: () => 600,
      animate(props, opts) { animateCalls.push({ props, opts }); return { stop() { stopped++; } }; } };
    const byPath = new Map([["out/Uno.md", fileA], ["out/Dos.md", fileB]]);
    const plugin = { tagView: behavior.tagView === false ? null : { tag: "x" }, session: null,
      _blgDrops: behavior.dropsBusy ? { attached: { busy: true } } : behavior.dropsIdle ? { attached: { busy: false } } : null,
      app: { vault: { getAbstractFileByPath: p => byPath.get(p) || null },
        workspace: { getLeaf() { return { openFile(f) { opened = f; } }; } } } };
    const view = { cy, app: plugin.app, plugin, _sz: { z: 1, tz: 1, running: true },
      toggleSel() { selToggled++; } };
    const scope = { Oe: { TFile }, __BLG_DROPS: api };
    vm.runInNewContext(`(function(){${bundle.slice(start, end)}})`, scope).call(view);
    const tap = id => callback({ target: nodes[id], originalEvent: behavior.shift ? { shiftKey: true } : {} });
    return { tap, view, get opened() { return opened; }, animateCalls, get stopped() { return stopped; }, get selToggled() { return selToggled; } };
  }
  // A → A: el primero centra sin abrir; el segundo abre y consume el armado.
  let r = run({});
  r.tap("out/Uno.md");
  assert.equal(r.opened, null, "first tap must not open the note");
  assert.equal(r.animateCalls.length, 1);
  assert.equal(r.animateCalls[0].opts.easing, "ease-in-cubic");
  assert.equal(r.animateCalls[0].opts.duration, 400);
  assert.equal(r.animateCalls[0].props.zoom, 1.9, "zoom-in moderado desde z=1");
  assert.ok(Math.abs(r.animateCalls[0].props.pan.x - 210) < 1e-9 && Math.abs(r.animateCalls[0].props.pan.y - 205) < 1e-9,
    "el nodo queda centrado en pantalla");
  assert.equal(r.view._tagFocusArm, "out/Uno.md");
  assert.equal(r.view._sz.running, false, "el zoom de rueda no compite con el enfoque");
  r.tap("out/Uno.md");
  assert.equal(r.opened, fileA, "second tap on the SAME node opens the note");
  assert.equal(r.view._tagFocusArm, null, "el armado se consume al abrir");
  assert.equal(r.animateCalls.length, 1, "opening does not animate again");
  // A → B → A: tres enfoques, ninguna apertura.
  r = run({});
  r.tap("out/Uno.md"); r.tap("out/Dos.md"); r.tap("out/Uno.md");
  assert.equal(r.opened, null, "changing nodes never opens");
  assert.equal(r.animateCalls.length, 3, "each first tap on a node refocuses");
  assert.equal(r.stopped, 2, "each new focus cancels the previous animation");
  // Zoom ya profundo: no aleja.
  r = run({}); r.view.cy.zoom = () => 3; r.tap("out/Uno.md");
  assert.equal(r.animateCalls[0].props.zoom, 3, "nunca aleja si ya está más cerca");
  // Gotas en transición: el tap se ignora (ni arma ni abre).
  r = run({ dropsBusy: true });
  r.tap("out/Uno.md");
  assert.equal(r.opened, null); assert.equal(r.animateCalls.length, 0);
  assert.equal(r.view._tagFocusArm, undefined, "drops busy: no se arma el enfoque");
  // BLG-FOCUS-WHEEL: gotas activas SIN trabajo de cámara/archivos (p. ej. el
  // agarre sin arrastre que aún existe cuando Cytoscape emite "tap", antes del
  // "free") NO bloquean el enfoque del primer clic.
  r = run({ dropsIdle: true });
  r.tap("out/Uno.md");
  assert.equal(r.opened, null);
  assert.equal(r.animateCalls.length, 1, "agarre sin arrastre no es busy: el primer tap enfoca dentro de la gota");
  r.tap("out/Uno.md");
  assert.equal(r.opened, fileA, "el segundo tap abre la nota estando agrupada");
  // El busy real del módulo distingue agarre de arrastre.
  assert.ok(source.includes("(st.drag && st.drag.everMoved)"),
    "busy solo bloquea con arrastre real (everMoved), no con el simple agarre");
  // Shift: selección, sin enfocar ni abrir.
  r = run({ shift: true });
  r.tap("out/Uno.md");
  assert.equal(r.selToggled, 1); assert.equal(r.animateCalls.length, 0); assert.equal(r.opened, null);
  // Vista local: apertura inmediata como antes.
  r = run({ tagView: false });
  r.tap("out/Uno.md");
  assert.equal(r.opened, fileA, "local view keeps immediate open");
  assert.equal(r.animateCalls.length, 0);
  // Fondo y rueda desarman (anclas del bundle).
  assert.ok(bundle.includes('this.cy.on("tap",a=>{if(a.target!==this.cy)return;if(!this.cy.elements().length)return;this._tagFocusArm=null;'),
    "background tap disarms the second click");
  assert.ok(bundle.includes('this._tagFocusAnim&&(this._tagFocusAnim.stop(),this._tagFocusAnim=null),this._tagFocusArm=null;'),
    "wheel cancels the focus animation and disarms");
  assert.ok(bundle.includes('this.currentPath=null;this._tagFocusArm=null;'),
    "renderTagGraph resets the armed node");
}

function hoverDropIncludesNodesAndFadedPill() {
  const mk = (x, y, w) => ({ position: () => ({ x, y }), width: () => w || 42 });
  const groups = [{ path: "ia/agentes", x: 0, y: 0, r: 100, nodes: [mk(0, 10), mk(40, 0)] },
    { path: "out", x: 300, y: 0, r: 80, nodes: [] }];
  const hs = { dropsLabels: true, dropsLabelSize: 0.85 }, pan = { x: 0, y: 0 };
  assert.equal(pure.hoverDrop(groups, { x: 40, y: 0 }, { x: 40, y: 0 }, 1, pan, hs), groups[0],
    "hoverDrop counts water INCLUDING nodes (the label fades to reveal them)");
  assert.equal(pure.hitDrop(groups, { x: 40, y: 0 }, { x: 40, y: 0 }, 1, pan, hs), null,
    "hitDrop still yields to the node drag");
  assert.equal(pure.hoverDrop(groups, { x: 0, y: -60 }, { x: 0, y: -60 }, 1, pan, hs), groups[0], "the visible pill hovers");
  assert.equal(pure.hoverDrop(groups, { x: 150, y: 0 }, { x: 150, y: 0 }, 1, pan, hs), null, "outside every drop");
  groups[0].labelFade = 0;
  assert.equal(pure.hoverDrop(groups, { x: 0, y: -60 }, { x: 0, y: -60 }, 1, pan, hs), groups[0],
    "faded pill: el agua debajo sigue contando");
  groups[0].labelFade = 1;
}

function wheelAnchorKeepsCursorPoint() {
  /* BLG-FOCUS-WHEEL: el punto bajo el cursor no se mueve al hacer zoom, en
     ambos sentidos y a cualquier nivel. */
  const fixed = (z0, z1, ax, ay, pan) => {
    const p = pure.anchorPan(pan, z0, z1, ax, ay);
    assert.ok(Math.abs((ax - p.x) / z1 - (ax - pan.x) / z0) < 1e-9, "mismo x del modelo bajo el cursor");
    assert.ok(Math.abs((ay - p.y) / z1 - (ay - pan.y) / z0) < 1e-9, "mismo y del modelo bajo el cursor");
    return p;
  };
  let p = fixed(1, 1.5, 400, 300, { x: 0, y: 0 });
  assert.equal(p.x, -200); assert.equal(p.y, -150); // zoom in empuja el pan hacia el cursor
  p = fixed(1, 0.75, 400, 300, { x: 0, y: 0 });
  assert.equal(p.x, 100); assert.equal(p.y, 75); // zoom out se aleja DESDE el cursor
  fixed(2.2, 1.1, 37, 511, { x: -88.5, y: 42.25 });
  fixed(0.35, 9.9, 799, 3, { x: 1200, y: -640 });
  assert.ok(source.includes("e.stopImmediatePropagation()"), "el módulo toma la rueda fuera de los nodos");
  assert.ok(source.includes("if (view._hoverNode) return;"), "sobre un nodo la rueda conserva su función actual");
  assert.ok(source.includes("tt.scrollHeight - tt.clientHeight"), "el tooltip con scroll conserva su rueda");
  assert.ok(source.includes("cancelWheel();"), "salir/destruir cancela el bucle de la rueda");
}

function dropColorOverrideAndReset() {
  const pl = { settings: { dropsColor: "#63bfe7", dropsOpacity: 0.22,
    dropsFolderColors: { "ia/agentes": "#ff0000" } } };
  const c = pure.dropColors(pl, "ia/agentes");
  assert.equal(c.fill, "#ff0000", "la carpeta con asignación usa su color");
  assert.equal(c.border, "#ff0000", "el borde sigue al color asignado");
  assert.equal(pure.dropColors(pl, "docs/agentes").fill, "#63bfe7", "sin asignación: color global");
  assert.equal(pure.dropColors(pl, "").fill, "#63bfe7", "raíz sin asignación: color global");
  pl.settings.dropsFolderColors["docs/agentes"] = "red";
  assert.equal(pure.dropColors(pl, "docs/agentes").fill, "#63bfe7", "hex inválido cae al global");
  pl.settings.dropsFolderColors = {};
  assert.equal(pure.dropColors(pl, "ia/agentes").fill, "#63bfe7", "tras reset vuelve el predeterminado");
}

async function dragFlow(group) {
  const f = fixture(), oldId = f.a.path;
  let position = { x: 0, y: 0 }, other = { x: 10, y: 0 }, release;
  f.plugin.app.fileManager.renameFile = () => new Promise(resolve => { release = resolve; });
  const node = { id: () => oldId, get length() { return 1; }, position(p) { if (p) position = p; return position; } };
  const sibling = { id: () => f.b.path, get length() { return 1; }, position(p) { if (p) other = p; return other; } };
  const cy = { getElementById(id) { return id === oldId ? node : sibling; }, nodes() { return [node, sibling]; }, zoom() { return 1; } };
  const st = { active: true, phase: "on", groups: [{ path: "ia/agentes", nodes: [node, sibling], x: 0, y: 0, r: 80 },
    { path: "out", nodes: [], x: 250, y: 0, r: 80 }], target: new Map([[oldId, { x: 0, y: 0 }], [f.b.path, { x: 10, y: 0 }]]),
    pending: new Set(), alias: new Map(), effects: [], mods: {}, reduced: false, dropBusy: false };
  const bodyClasses = new Set(), document = { body: { classList: { add: x => bodyClasses.add(x), remove: x => bodyClasses.delete(x) } } };
  let resets = 0, bounced = 0, rearranged = 0;
  const view = { _sel: [], resetHover() { resets++; } };
  const script = source.slice(source.indexOf("    view._blgDropsMoved = function"), source.indexOf("    cy.on(\"grab\""));
  const env = { st, cy, view, plugin: f.plugin, settings: { dropsSpeed: 1 }, document,
    clonePos: pure.clonePos, capturePositions: pure.capturePositions,
    resetJelly: pure.resetJelly, jellyStep: pure.jellyStep,
    performance: { now: () => 10 }, copied: () => false, candidate: (d, pos) => Math.abs(d.x - pos.x) < 80,
    excluded: () => false, rootOrFolder: (_app, name) => f.vault.getAbstractFileByPath(name), Oe: obsidian,
    fileForNode: (_app, id) => f.vault.getAbstractFileByPath(id), moveFiles: api.moveFiles,
    bounce: () => { bounced++; }, beginTween: () => {}, rerange: () => { rearranged++; },
    hitDrop: () => null, window: { addEventListener() {}, removeEventListener() {} }, graph: { getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 100 }), classList: { toggle() {} } },
    msg: () => "", notice: () => {}, warn: () => {}, button: {}, legend: { contains: () => false } };
  vm.runInNewContext(`${script}\nglobalThis.events={grabbed,dragged,freed,mods,dropped};`, env);
  f.plugin.getView = () => view;
  view._scheduleRefresh = () => {};
  const e = { target: node, originalEvent: { shiftKey: group, clientX: 0, clientY: 0 } };
  env.events.grabbed(e);
  position = { x: 250, y: 0 };
  if (group) env.events.dragged(e);
  env.events.freed(e);
  assert.equal(resets > 0, true, "moving should hide the tooltip");
  assert.equal(bodyClasses.has("blg-drops-node-moving"), true);
  if (group) { assert.equal(other.x, 260, "Shift moves the whole drop"); assert.equal(release, undefined, "group drag does not rename files");
    assert.equal(bounced, 0, "the dragged group must stay where it was released");
    assert.equal(st.target.get(f.b.path).x, 260, "the new base position becomes the target"); }
  else {
    assert.equal(typeof release, "function", "free must recognize movement even without a drag event");
    assert.equal(st.pending.has(oldId), true, "node stays at destination while rename is pending");
    release(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(rearranged, 1);
  }
}

function activeNoteRefresh() {
  const exit = source.slice(source.indexOf("    function finishExit() {"), source.indexOf("    function rerange() {"));
  const refresh = source.slice(source.indexOf("    /* Con conjuntos activos"), source.indexOf("    function changedNodes(e) {"));
  let refreshed = 0, current = "ia/agentes/Uno.md", buttonUpdates = 0, activeFile = true, sigReset = 0, localRenders = 0;
  const view = { currentPath: current, _startLocalPulse() {}, set _lastSig(v) { if (v === null) sigReset++; }, get _lastSig() { return "x"; },
    renderMode() {}, renderLocalGraph() { localRenders++; }, renderTagGraph() {}, refreshLocal() {}, _scheduleRefresh() {} };
  const st = { active: true, phase: "on", dirty: false, changed: false, alias: new Map(), centerPath: current,
    lastMode: "local", saved: { zoom: 1, pan: { x: 0, y: 0 }, positions: new Map() },
    pending: new Set(), hidden: new Map(), effects: [], raf: null };
  const listeners = {};
  const plugin = { tagView: null, session: null, app: {
    vault: { getAbstractFileByPath: p => new TFile(p, new TFolder(p.split("/").slice(0, -1).join("/") || "/")) },
    workspace: {
      getActiveFile: () => activeFile ? { path: current, extension: "md" } : null,
      on: (name, fn) => { listeners[name] = fn; return {}; } } } };
  const layer = { attributes: new Set(), setAttribute(k) { this.attributes.add(k); }, removeAttribute(k) { this.attributes.delete(k); } }, legend = { hidden: false };
  const cy = { nodes: () => [], getElementById: () => ({ length: 0 }), zoom: () => 1, pan: () => ({ x: 0, y: 0 }) };
  const env = { view, st, plugin, cy, layer, legend, Oe: obsidian, document: { body: { classList: { remove() {} } } },
    graph: { classList: { remove() {} } }, dropUp() {}, cancelWheel() {},
    mode: () => "local", syncZoom() {}, syncButton() { buttonUpdates++; }, cancelAnimationFrame() {},
    clonePos: pure.clonePos, capturePositions: pure.capturePositions,
    performance: { now: () => 1 }, beginTween() { st.tween = { duration: 100 }; },
    applyTween() { env.finishExit(); }, setTimeout: fn => fn(), originalSchedule: () => { refreshed++; },
    tagTimer: null, clearTimeout() {}, settings: {} };
  vm.runInNewContext("var originalMode = view.renderMode, originalLocal = view.renderLocalGraph, originalTag = view.renderTagGraph, originalSchedule = view._scheduleRefresh, originalRefresh = view.refreshLocal;\n"
    + exit + refresh + "\nglobalThis.checkActiveNote = checkActiveNote; globalThis.finishExit = finishExit; globalThis.exitNow = exitNow", env);
  env.originalSchedule = () => { refreshed++; };
  const reset = () => { st.active = true; st.phase = "on"; st.dirty = false; st.changed = false; st.centerPath = "ia/agentes/Uno.md";
    st.saved = { zoom: 1, pan: { x: 0, y: 0 }, positions: new Map() }; layer.attributes.delete("hidden"); };
  // 1. Cambiar de nota con gotas activas: salida inmediata + refresco del grafo nuevo.
  current = "out/Otra.md"; view.currentPath = current;
  view._scheduleRefresh(true);
  assert.equal(st.active, false);
  assert.equal(layer.attributes.has("hidden"), true, "SVG must carry the hidden attribute, not just an expando property");
  assert.equal(legend.hidden, true);
  assert.ok(buttonUpdates >= 1, "the button must be toggled off");
  assert.equal(refreshed, 1, "exiting must request the new note's graph");
  assert.ok(sigReset >= 1, "the graph signature must be invalidated for the new note");
  view._scheduleRefresh(false);
  assert.equal(refreshed, 2);
  // 2. renderLocalGraph para otra nota NO se traga: apaga gotas y sigue.
  reset(); localRenders = 0;
  view.renderLocalGraph({ path: "out/Otra.md" });
  assert.equal(st.active, false, "rendering another note must turn drops off");
  assert.equal(localRenders, 1, "the render for the new note must proceed");
  reset(); localRenders = 0;
  view.renderLocalGraph({ path: "ia/agentes/Uno.md" });
  assert.equal(st.active, true, "same-note rerender is deferred"); assert.equal(localRenders, 1, "the same-note render still syncs relation edges in place"); assert.equal(st.dirty, true);
  reset(); st.phase = "leave"; localRenders = 0;
  current = "out/Otra.md";
  view.renderLocalGraph({ path: "out/Otra.md" });
  assert.equal(st.active, false, "a note change during the exit animation must close drops");
  assert.equal(localRenders, 1, "the new note still renders while leaving");
  // 3. file-open / active-leaf-change
  reset(); activeFile = false;
  listeners["file-open"]({ path: "out/Otra.md", extension: "md" });
  assert.equal(st.active, false, "file-open must turn off stale drops even when active file is null");
  reset();
  listeners["active-leaf-change"]({ view: { file: { path: "out/Otra.md", extension: "md" } } });
  assert.equal(st.active, false, "the Markdown leaf must turn off drops even with null active file");
  reset(); st.dropBusy = true; activeFile = true; current = "out/Uno.md";
  env.checkActiveNote();
  assert.equal(st.active, true, "renaming the active note during a drop must not close drops");
  st.dropBusy = false; st.alias.set(st.centerPath, current);
  env.checkActiveNote();
  assert.equal(st.active, true, "the active note's new path must not close drops after a move");
  // 4. Desactivar sólo con eventos de caché tragados: refresco SIN invalidar la firma (no hay re-layout).
  reset(); st.dirty = true; sigReset = 0; refreshed = 0; current = "ia/agentes/Uno.md"; st.alias.clear();
  env.finishExit();
  assert.equal(refreshed, 1); assert.equal(sigReset, 0, "dirty-only exit must keep _lastSig so the bundle short-circuits");
  reset(); st.changed = true; sigReset = 0; refreshed = 0;
  env.finishExit();
  assert.equal(refreshed, 1); assert.equal(sigReset, 1, "file moves must force a rebuild");
}

function graphEventsDoNotCountAsFileMoves() {
  const script = source.slice(source.indexOf("    function changedNodes(e) {"), source.indexOf("    cy.on(\"add remove\", changedNodes);"));
  const st = { active: true, phase: "on", changed: false };
  let reranges = 0;
  const env = { st, plugin: { tagView: null }, nodeTimer: null, clearTimeout() {}, setTimeout(fn) { fn(); return 1; },
    cy: { nodes: () => [{ id: () => "a" }] }, overLimit: () => false, maxN: () => 30,
    rerange() { reranges++; }, syncButton() {}, exitNow() {} };
  vm.runInNewContext(script + "\nglobalThis.changedNodes=changedNodes", env);
  env.changedNodes();
  assert.equal(reranges, 1);
  assert.equal(st.changed, false, "graph events do not mean files were moved");
}

/* Extrae un método shorthand de una clase del bundle minificado sin ejecutar
   el plugin completo. Sirve para fijar contratos del bundle con mocks. */
function extractBundleMethod(name) {
  const match = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\([^)]*\\)\\{").exec(bundle);
  assert.ok(match, `bundle method missing: ${name}`);
  const start = match.index;
  const open = bundle.indexOf("{", start);
  let depth = 0, end = open;
  for (; end < bundle.length; end++) {
    const ch = bundle[end];
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) { end++; break; }
  }
  assert.ok(depth === 0, `unbalanced method: ${name}`);
  return bundle.slice(start, end);
}

function bundleSchedulerRefreshesActiveMode() {
  const method = extractBundleMethod("_scheduleRefresh");
  const fn = vm.runInNewContext("(" + method.replace(/^_scheduleRefresh/, "function _scheduleRefresh") + ")", {
    setTimeout(fn) { fn(); return 1; }, clearTimeout() {}
  });
  let tag = 0, local = 0, forced = null;
  const view = { plugin: { tagView: { tag: "x" }, session: null },
    renderTagGraph() { tag++; }, refreshLocal(force) { local++; forced = force; } };
  fn.call(view, true);
  assert.equal(tag, 1, "metadata changes must rebuild the visible tag graph");
  assert.equal(local, 0, "tag mode must not fall through to refreshLocal");
  view.plugin.tagView = null;
  fn.call(view, true);
  assert.equal(local, 1); assert.equal(forced, true);
}

function applyGraphEdgesReconcilesSewing() {
  const method = extractBundleMethod("_applyGraphEdges");
  const fn = vm.runInNewContext("(" + method.replace(/^_applyGraphEdges/, "function _applyGraphEdges") + ")");
  function edge(id, classes) {
    const set = new Set(classes.split(" ").filter(Boolean));
    return { id: () => id, length: 1, classes: set, payload: {},
      isEdge: () => true,
      removeClass(str) { String(str).split(" ").forEach(c => set.delete(c)); },
      addClass(str) { String(str).split(" ").forEach(c => c && set.add(c)); },
      data(v) { if (v) this.payload = v; return this.payload; } };
  }
  const existing = edge("a\0b", "dir sewing g1 ehl");
  const stale = edge("a\0c", "dir sewing g1");
  const removed = [], added = [];
  const cy = { edges: () => ({ forEach(fn) { [existing, stale].forEach(fn); } }),
    getElementById(id) { return id === "a\0b" ? existing : id === "a\0c" ? stale : { length: 0 }; },
    remove(els) { removed.push(...els); }, add(els) { added.push(...els); } };
  fn.call({ cy }, [{ data: { id: "a\0b", source: "a", target: "b" }, classes: "dir g1" },
    { data: { id: "b\0c", source: "b", target: "c" }, classes: "dir sewing g2" }]);
  assert.deepEqual(Array.from(existing.classes).sort(), ["dir", "ehl", "g1"].sort(),
    "removing a sewing must remove the class while preserving hover/highlight classes");
  assert.deepEqual(existing.payload, { id: "a\0b", source: "a", target: "b" });
  assert.deepEqual(removed.map(e => e.id()), ["a\0c"], "a relation that disappeared is removed");
  assert.deepEqual(added.map(e => e.data.id), ["b\0c"], "a new visible relation is added without a layout");
}

function localRelationOnlyRenderPatchesWithoutLayout() {
  const method = extractBundleMethod("renderLocalGraph");
  const edgeMethod = extractBundleMethod("_applyGraphEdges");
  const render = vm.runInNewContext("(" + method.replace(/^renderLocalGraph/, "function renderLocalGraph") + ")", {
    Oe: obsidian, _blgFmIcon: () => null, _blgResolveIcon: () => null, BLG_LANG: "es", L: key => key
  });
  const applyEdges = vm.runInNewContext("(" + edgeMethod.replace(/^_applyGraphEdges/, "function _applyGraphEdges") + ")");
  const fa = new TFile("a/Uno.md", new TFolder("a"));
  const fb = new TFile("a/Dos.md", new TFolder("a"));
  fa.stat = { ctime: 1, mtime: 1 }; fb.stat = { ctime: 1, mtime: 1 };
  const byPath = new Map([[fa.path, fa], [fb.path, fb]]);
  function classes(list) { return new Set(list); }
  function node(id, cls) {
    const set = classes(cls), data = { id, label: id.includes("Uno") ? "Uno" : "Dos", bg: null, al: null };
    return { id: () => id, length: 1, hasClass: c => set.has(c), data: k => k ? data[k] : data };
  }
  function edge(id, cls) {
    const set = classes(cls); let payload = {};
    return { id: () => id, length: 1, isEdge: () => true, classes: set,
      removeClass(str) { String(str).split(" ").forEach(c => set.delete(c)); },
      addClass(str) { String(str).split(" ").forEach(c => c && set.add(c)); },
      data(v) { if (v) payload = v; return payload; } };
  }
  const nodes = new Map([[fa.path, node(fa.path, ["central"])], [fb.path, node(fb.path, ["gen1"])]]);
  const pairId = [fa.path, fb.path].sort().join("\0");
  const oldEdge = edge(pairId, "dir sewing g1");
  const edges = new Map([[oldEdge.id(), oldEdge]]);
  let layouts = 0, fits = 0;
  const cy = {
    nodes: () => ({ length: nodes.size, forEach(fn) { nodes.forEach(fn); } }),
    edges: () => ({ forEach(fn) { edges.forEach(fn); } }),
    getElementById(id) { return nodes.get(id) || edges.get(id) || { length: 0 }; },
    remove(list) { list.forEach(e => edges.delete(e.id())); },
    add(list) { list.forEach(e => { const x = edge(e.data.id, e.classes); x.data(e.data); edges.set(e.data.id, x); }); return list; },
    layout() { layouts++; return { run() {} }; }, fit() { fits++; }
  };
  const fm = { [fa.path]: { sewing: ["[[Dos]]"] }, [fb.path]: {} };
  const view = {
    app: {
      vault: { getAbstractFileByPath: p => byPath.get(p) || null },
      metadataCache: {
        resolvedLinks: { [fa.path]: { [fb.path]: 1 } },
        getFileCache: f => ({ frontmatter: fm[f.path] }),
        getFirstLinkpathDest: name => name === "Dos" ? fb : null
      }
    },
    plugin: { settings: { excludedFolders: [], maxNodes: 30, iconColor: "#ddd" }, tagView: null, session: null },
    cy, graphEl: { querySelector: () => null }, _iconCache: new Map(),
    _lastCentralPath: fa.path, _lastSig: "old",
    _applyGraphEdges(c) { return applyEdges.call(this, c); },
    _resyncSelNodes() {}, _selChanged() {}
  };
  assert.equal(render.call(view, fa, true), true);
  assert.ok(oldEdge.classes.has("sewing"), "fresh frontmatter marks the existing link as sewing immediately");
  fm[fa.path] = {};
  assert.equal(render.call(view, fa, true), true);
  assert.ok(!oldEdge.classes.has("sewing"), "removing sewing reconciles the existing edge class");
  assert.ok(oldEdge.classes.has("dir") && oldEdge.classes.has("g1"), "the normal wikilink remains");
  assert.equal(layouts, 0, "relation-only render never runs layout");
  assert.equal(fits, 0, "relation-only render never moves the camera");
  assert.notEqual(view._lastSig, "old", "the signature is synchronized so exit does not redraw");
}

function activeDropsSyncRelationsContract() {
  assert.equal(typeof pure.tagEdgeDescriptors, "function", "drops expose a pure tag-edge descriptor helper");
  const a = new TFile("a/Uno.md", new TFolder("a"));
  const b = new TFile("a/Dos.md", new TFolder("a"));
  const byPath = new Map([[a.path, a], [b.path, b]]);
  const plugin = {
    app: {
      vault: { getAbstractFileByPath: p => byPath.get(p) || null },
      metadataCache: {
        resolvedLinks: { [a.path]: { [b.path]: 1 } },
        getFileCache() { return null; },
        getFirstLinkpathDest() { return null; }
      }
    },
    settings: {},
    _sewingTargets(file) { return file.path === a.path ? new Set([b.path]) : new Set(); }
  };
  const edges = pure.tagEdgeDescriptors(plugin, new Set([a.path, b.path]));
  assert.equal(edges.length, 1, "wikilink + sewing collapse into one edge");
  assert.equal(edges[0].classes, "tagedge sewing", "sewing upgrades the existing tag edge");
  assert.ok(source.includes("function syncRelations()"), "active drops sync relationship edges in place");
  assert.ok(source.includes("if (st.active && !syncRelations()) st.dirty = true;"), "scheduled metadata refreshes are not swallowed while drops are active");
  assert.ok(source.includes("e && e.target && e.target.isEdge && e.target.isEdge()"), "edge-only patches do not trigger rerange/dirty");
  assert.ok(bundle.includes("this.plugin._sewingTargets?this.plugin._sewingTargets(sf):new Set()"),
    "tag view resolves sewing through the plugin, not through the view");
  assert.ok(bundle.includes("renderLocalGraph(r,_relationsOnly)"), "local graph supports a relation-only render");
  assert.ok(bundle.includes("_ex.removeClass(\"dir bidir sewing g1 g2 tagedge\")"),
    "incremental local updates reconcile structural edge classes");
}

/* Nodo con semántica real de Cytoscape: position() devuelve SIEMPRE el mismo
   objeto interno y position(p) lo muta en el sitio. Así se reproduce el bug
   de órbita: guardar la referencia en vez de copiarla. */
function liveNode(id, x, y) {
  const pos = { x, y };
  return { id: () => id, length: 1,
    position(p) { if (p) { pos.x = p.x; pos.y = p.y; } return pos; } };
}

function settleGroupStoresIndependentCopies() {
  const script = source.slice(source.indexOf("    function settleGroup(ids)"), source.indexOf("    /* Arrastre de la gota entera"));
  const node = liveNode("n1", 200, 120);
  const cy = { getElementById: () => node };
  const st = { target: new Map() };
  vm.runInNewContext(script + "\nsettleGroup([\"n1\"]);", { st, cy, clonePos: pure.clonePos });
  const base = st.target.get("n1");
  assert.ok(base !== node.position(), "the base must not alias the live position object");
  assert.equal(base.x, 200); assert.equal(base.y, 120);
  // 600 fotogramas de deriva ambiental como los de frame(): acotada, sin espiral.
  for (let i = 0; i < 600; i++) {
    const a = i * 16 / 3300;
    node.position({ x: base.x + 1.4 * Math.cos(a), y: base.y + 1.4 * Math.sin(a) });
  }
  const after = st.target.get("n1");
  assert.equal(after.x, 200, "the release point stays fixed");
  assert.equal(after.y, 120, "the release point stays fixed");
  assert.ok(Math.hypot(node.position().x - 200, node.position().y - 120) <= 1.4 + 1e-9,
    "ambient jitter stays bounded around the drop");
}

function savedPositionsAreIndependentCopies() {
  const node = liveNode("n1", 50, 60);
  const cy = { nodes: () => [node] };
  const saved = pure.capturePositions(cy);
  assert.ok(saved.get("n1") !== node.position(), "capturePositions copies instead of aliasing");
  node.position({ x: 999, y: 999 });
  assert.equal(saved.get("n1").x, 50, "the saved layout survives node movement");
  assert.equal(saved.get("n1").y, 60, "the saved layout survives node movement");
}

function exitTweenHasNoOvershoot() {
  const script = source.slice(source.indexOf("    function ease(p)"), source.indexOf("    function candidate(d, pos)"));
  function run(leaving) {
    const node = liveNode("n1", 0, 0);
    let zoom = 1; const pan = { x: 0, y: 0 };
    const cy = { batch(fn) { fn(); }, getElementById: () => node,
      zoom(v) { if (v != null) zoom = v; return zoom; },
      pan(v) { if (v) { pan.x = v.x; pan.y = v.y; } return pan; } };
    const st = { tween: { start: 0, duration: 100, leaving: leaving,
      from: new Map([["n1", { x: 0, y: 0 }]]), to: new Map([["n1", { x: 100, y: 0 }]]),
      fromZoom: 1, toZoom: 2, fromPan: { x: 0, y: 0 }, toPan: { x: 10, y: 10 } },
      pending: new Set(), drag: null, dropDrag: null, phase: leaving ? "leave" : "enter" };
    const track = [];
    const env = { st, cy, node, track, performance: { now: () => 0 }, clamp: (x, a, b) => Math.max(a, Math.min(b, x)),
      syncZoom() {}, finishExit() { st.tween = null; st.phase = "idle"; } };
    vm.runInNewContext(script + "\nfor (var t = 0; t <= 100; t += 5) { applyTween(t); track.push(node.position().x); }", env);
    return { node, st, track, zoom, pan };
  }
  // Salida: jamás se pasa del destino (ease cúbico, regreso fluido y exacto).
  const out = run(true);
  assert.equal(out.st.phase, "idle", "leave tween ends in finishExit");
  assert.deepEqual(out.node.position(), { x: 100, y: 0 }, "exit lands exactly on the saved layout");
  for (const x of out.track) assert.ok(x <= 100 + 1e-9, "no overshoot on exit: " + out.track.join(","));
  for (let i = 1; i < out.track.length; i++) assert.ok(out.track[i] >= out.track[i - 1], "exit is monotonic");
  // Entrada: conserva el spring con sobreimpulso característico.
  const inn = run(false);
  assert.equal(inn.st.phase, "on");
  assert.deepEqual(inn.node.position(), { x: 100, y: 0 });
  assert.ok(Math.max(...inn.track) > 100, "entrance keeps its spring overshoot");
}

/* Física del arrastre del conjunto: el CENTRO obedece al cursor (sin rebote
   al soltar) y sólo la FORMA integra la aceleración con un resorte amortiguado. */
function jellyPhysicsRespondsToDrag() {
  const st = {};
  pure.jellyStep(st, { x: 3, y: 0 }, 16); // primer paso: sólo inicializa el estado
  let a = pure.jellyStep(st, { x: 3, y: 0 }, 16);
  assert.ok(a.x > 0, "al arrancar, la masa acompaña el sentido del tirón");
  for (let i = 0; i < 240; i++) a = pure.jellyStep(st, { x: 3, y: 0 }, 16);
  assert.ok(Math.abs(a.x - 3) < 0.05, "a velocidad constante la deformación se estabiliza");
  let min = 0;
  for (let i = 0; i < 400; i++) { a = pure.jellyStep(st, { x: 0, y: 0 }, 16); min = Math.min(min, a.x); }
  assert.ok(min < -0.05, "al frenar, la masa se adelanta al conjunto antes de recuperarse");
  for (let i = 0; i < 400; i++) a = pure.jellyStep(st, { x: 0, y: 0 }, 16);
  assert.ok(Math.hypot(a.x, a.y) < 0.02, "la deformación se disipa por completo, sin desplazar el centro");
  const st2 = {};
  for (let i = 0; i < 200; i++) pure.jellyStep(st2, { x: 3, y: 0 }, 16);
  let a2;
  for (let i = 0; i < 400; i++) a2 = pure.jellyStep(st2, { x: -3, y: 0 }, 16);
  assert.ok(a2.x < -2.9, "invertir la dirección invierte la deformación");
  const st3 = {};
  let max = 0;
  for (let i = 0; i < 60; i++) { const a3 = pure.jellyStep(st3, { x: 900, y: 900 }, 16); max = Math.max(max, Math.hypot(a3.x, a3.y)); }
  assert.ok(max < 9, "la deformación está acotada incluso con tirones violentos");
  const still = {};
  const rest1 = pure.jellyStep(still, { x: 0, y: 0 }, 16);
  const rest2 = pure.jellyStep(still, { x: 0, y: 0 }, 16);
  assert.equal(rest1.x + rest1.y + rest2.x + rest2.y, 0, "sin arrastre no hay deformación residual y permanece en reposo");
}

function dropPathDeformsWithAcceleration() {
  const d = { r: 100, x: 0, y: 0, seed: 7 };
  const base = pure.dropPath(d, 0, 1, null, null);
  assert.equal(pure.dropPath(d, 0, 1, null, { x: 0, y: 0 }), base, "aceleración cero conserva la forma base");
  const parse = str => str.match(/-?\d+\.?\d*(?:e[+-]?\d+)?/gi).map(Number);
  const centroidX = str => { const n = parse(str); let s = 0, c = 0; for (let i = 0; i + 1 < n.length; i += 2) { s += n[i]; c++; } return s / c; };
  const cx0 = centroidX(base);
  const slow = centroidX(pure.dropPath(d, 0, 1, null, { x: 0.5, y: 0 })) - cx0;
  const right = centroidX(pure.dropPath(d, 0, 1, null, { x: 3, y: 0 })) - cx0;
  const left = centroidX(pure.dropPath(d, 0, 1, null, { x: -3, y: 0 })) - cx0;
  assert.ok(right > 3, "la masa se desplaza en el sentido de la inercia: " + right);
  assert.ok(left < -3, "invertir el arrastre invierte la forma: " + left);
  assert.ok(Math.abs(right + left) < 0.5, "la deformación es especular");
  assert.ok(slow > 0.3 && slow < right, "la deformación crece con la velocidad");
  const maxR = str => { const n = parse(str); let m = 0; for (let i = 0; i + 1 < n.length; i += 2) m = Math.max(m, Math.hypot(n[i], n[i + 1])); return m; };
  assert.ok(maxR(pure.dropPath(d, 0, 1, null, { x: 9999, y: 9999 })) - maxR(base) < 60, "el estiramiento extremo sigue acotado");
}

/* Frenar con el botón AÚN pulsado: el centro deja de moverse, la velocidad
   medida cae y la masa que venía retrasada se adelanta (gelatina real). */
function jellyStopWhileHeld() {
  const drg = {}, jelly = {};
  let x = 0, a = null;
  for (let i = 0; i < 30; i++) { x += 8; const v = pure.dragVelocity(drg, x, 0, 16); a = pure.jellyStep(jelly, { x: -v.x, y: -v.y }, 16); }
  assert.ok(drg.vx > 0.3, "la velocidad se mide en el sentido del arrastre: " + drg.vx);
  assert.ok(a.x < -0.15, "en crucero la masa se retrasa al conjunto: " + a.x);
  let peak = 0;
  for (let i = 0; i < 60; i++) { const v = pure.dragVelocity(drg, x, 0, 16); a = pure.jellyStep(jelly, { x: -v.x, y: -v.y }, 16); peak = Math.max(peak, a.x); }
  assert.ok(peak > 0.015, "al frenar sin soltar, la masa se adelanta: " + peak);
  for (let i = 0; i < 300; i++) { const v = pure.dragVelocity(drg, x, 0, 16); a = pure.jellyStep(jelly, { x: -v.x, y: -v.y }, 16); }
  assert.ok(Math.hypot(a.x, a.y) < 0.02 && Math.hypot(jelly.vx, jelly.vy) < 0.06, "la oscilación termina en reposo total");
  const drg2 = {}, jelly2 = {};
  let x2 = 0, a2 = null;
  for (let i = 0; i < 30; i++) { x2 -= 8; const v = pure.dragVelocity(drg2, x2, 0, 16); a2 = pure.jellyStep(jelly2, { x: -v.x, y: -v.y }, 16); }
  assert.ok(a2.x > 0.15, "arrastrar a la izquierda retrasa la masa a la derecha");
}

function hoverGlowTiming() {
  let g = 0;
  for (let i = 0; i < 9; i++) g = pure.hoverStep(g, 1, 16, false);
  assert.ok(g >= 1 - 1e-9, "el brillo entra en ~130 ms");
  for (let i = 0; i < 15; i++) g = pure.hoverStep(g, 0, 16, false);
  assert.ok(g <= 1e-9, "el brillo sale en ~210 ms");
  assert.equal(pure.hoverStep(0.4, 1, 16, true), 1, "reduced motion: cambio inmediato");
  assert.equal(pure.hoverStep(null, 0, 16, false), 0, "sin hover no hay brillo residual");
  assert.ok(source.includes("d.hoverGlow = hoverStep("), "el hover alimenta el brillo del borde");
  assert.ok(source.includes("0.42 * d.hoverGlow"), "el brillo es un halo sutil, no un segundo borde");
  assert.ok(source.includes('d.glow.setAttribute("d", path)'), "el brillo sigue la silueta deformada");
}

function dragFeedsVelocity() {
  assert.ok(source.includes("var v = dragVelocity(dragging, gd.x, gd.y, dt);"), "la velocidad sale del desplazamiento real por fotograma");
  assert.ok(source.includes("jellyStep(gd.jelly || resetJelly(gd), { x: -v.x, y: -v.y }"), "la masa se opone al avance (inercia)");
  assert.ok(source.includes("Math.hypot(j.vx, j.vy) < 0.06"), "el reposo exige velocidad baja, no sólo forma pequeña");
  assert.ok(!source.includes("dx / mdt"), "ya no se mide por eventos de ratón");
  assert.ok(source.includes("drag.last.x = p.x; drag.last.y = p.y;"), "drag.last jamás alias el objeto vivo de Cytoscape");
  assert.ok(source.includes("st.dropDrag = { drop: d, ids:"), "el conjunto arrastrado inicia su estado físico");
}

function buttonHiddenOverMaxNodes() {
  const script = source.slice(source.indexOf("    function mode()"), source.indexOf("    function paintSettings()"));
  function hiddenFor(count, opts) {
    opts = opts || {};
    const btn = { hidden: false, cls: [], title: "",
      classList: { toggle(c, v) { btn.cls[v ? "push" : "pop"](c); } },
      empty() {}, appendText() {}, setAttribute(k, v) { btn[k] = v; } };
    const nodes = Array.from({ length: count }, (_, i) => ({ id: () => "n" + i }));
    const env = {
      plugin: { session: !!opts.session, tagView: opts.tagView ? { tag: "x" } : null },
      settings: { maxNodes: 30, dropsCopyMod: "Ctrl", uiLang: "es" },
      st: { active: !!opts.active },
      view: { cy: { nodes: () => nodes } },
      graph: { querySelector: () => (opts.overlay ? {} : null) },
      button: btn, Oe: { setIcon() {} }, T: k => k, msg: () => "",
    };
    vm.runInNewContext(script + "\nsyncButton();", env);
    return btn.hidden;
  }
  assert.equal(hiddenFor(0), true, "empty view hides the button");
  assert.equal(hiddenFor(29), false);
  assert.equal(hiddenFor(30), false, "at the limit the button stays");
  assert.equal(hiddenFor(31), true, "over maxNodes the button hides");
  assert.equal(hiddenFor(31, { tagView: true }), false, "tag view ignores the count cap");
  assert.equal(hiddenFor(200, { tagView: true }), false, "tag view has no node limit at all");
  assert.equal(hiddenFor(0, { tagView: true }), true, "tag view still hides with no nodes");
  assert.equal(hiddenFor(10, { overlay: true }), true, "the over-limit overlay hides the button");
  assert.equal(hiddenFor(10, { session: true }), true, "sewing mode hides the button");
  assert.equal(hiddenFor(31, { active: true }), true, "even while active, over the limit hides");
}

function nodeCountOverLimitExits() {
  const script = source.slice(source.indexOf("    function changedNodes(e) {"), source.indexOf("    cy.on(\"add remove\", changedNodes);"));
  const nodes = Array.from({ length: 31 }, (_, i) => ({ id: () => "n" + i }));
  function run(tagView) {
    const st = { active: true, phase: "on", changed: false };
    const out = { exits: 0, reranges: 0 };
    const env = { st, plugin: { tagView: tagView ? { tag: "x" } : null }, nodeTimer: null,
      clearTimeout() {}, setTimeout(fn) { fn(); return 1; },
      cy: { nodes: () => nodes }, overLimit: () => false, maxN: () => 30,
      rerange() { out.reranges++; }, syncButton() {}, exitNow() { out.exits++; } };
    vm.runInNewContext(script + "\nchangedNodes();", env);
    return out;
  }
  const local = run(false);
  assert.equal(local.exits, 1, "crossing maxNodes in local view exits drops");
  assert.equal(local.reranges, 0);
  const tag = run(true);
  assert.equal(tag.exits, 0, "tag view ignores maxNodes while active");
  assert.equal(tag.reranges, 1, "tag view reranges instead of exiting");
}

(async function () {
  const f = fixture();
  assert.equal(pure.dropLabel("docs/agentes/hermes"), "hermes");
  assert.equal(pure.defaults().dropsLabelSize, 0.85);
  const data = pure.collect(f.plugin, f.view, new Map());
  assert.equal(data.skipped, true);
  assert.equal(data.groups.length, 2);
  assert.equal(data.groups.find(g => g.path === "ia/agentes").nodes.length, 2);
  assert.equal(data.groups.find(g => g.path === "docs/agentes").nodes.length, 1);
  const layout = pure.arrange(data.groups, f.view, f.plugin.settings);
  assert.equal(layout.positions.size, 3);
  for (const a of data.groups) for (const b of data.groups) if (a !== b) {
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r + 14 - 0.0001);
  }
  for (const d of data.groups) for (const n of d.nodes) {
    const p = layout.positions.get(n.id());
    assert.ok(Math.hypot(p.x - d.x, (p.y - d.y) / 1.07) < d.r);
  }
  const saved = { zoom: 2, pan: { x: 0, y: 0 } }, viewport = { w: 1400, h: 900 };
  const before = pure.camera(f.view, data.groups, saved, f.plugin.settings, viewport).zoom;
  f.plugin.settings.dropsSize = 1.8; pure.arrange(data.groups, f.view, f.plugin.settings);
  const after = pure.camera(f.view, data.groups, saved, f.plugin.settings, viewport).zoom;
  assert.ok(after <= before);
  const pathStr = pure.dropPath(data.groups[0], 0, 1, null);
  assert.ok(pathStr.startsWith("M") && pathStr.endsWith("Z") && pathStr.includes("L"));
  assert.notEqual(pure.dropPath(data.groups[0], 0, 1, { angle: 0, amount: 20 }), pathStr);
  const crowded = Array.from({ length: 12 }, (_, i) => ({ path: `ring/${i}`, seed: i,
    nodes: Array.from({ length: 3 }, (_, j) => ({ id: () => `ring/${i}/${j}.md` })) }));
  f.plugin.settings.dropsMaxFolders = 10;
  const rings = pure.arrange(crowded, f.view, f.plugin.settings);
  assert.equal(rings.compact, true); assert.equal(rings.positions.size, 36);
  for (const a of crowded) for (const b of crowded) if (a !== b) {
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r + 9 - 0.0001);
  }
  const first = JSON.stringify(Array.from(rings.positions));
  assert.equal(JSON.stringify(Array.from(pure.arrange(crowded, f.view, f.plugin.settings).positions)), first);

  const oldNodeId = f.a.path;
  f.view._blgDropsAlias = new Map();
  assert.equal(contextMenuOpens(f.plugin, oldNodeId), true);
  let r = await api.moveFiles([f.a, f.b], "out", { plugin: f.plugin, silent: true });
  assert.equal(r.moved, 2); assert.equal(r.skipped, 0);
  assert.equal(r.paths.get("ia/agentes/Uno.md"), "out/Uno.md");
  assert.equal(f.a.path, "out/Uno.md"); assert.equal(f.refreshes, 1);
  assert.equal(f.moves.length, 1); assert.equal(f.moves[0].copy, false);
  assert.equal(f.moves[0].result.paths.get(oldNodeId), "out/Uno.md");
  // Cytoscape mantiene su ID anterior hasta reconstruir la vista.
  assert.equal(contextMenuOpens(f.plugin, oldNodeId), true);
  assert.equal(nodeTapOpens(f.plugin, oldNodeId), f.a);
  r = await api.moveFiles([f.c], "out", { plugin: f.plugin, copy: true, silent: true });
  assert.equal(r.moved, 1); assert.equal(f.c.path, "docs/agentes/Tres.md");
  assert.equal(f.moves[1].copy, true);
  r = await api.moveFiles([f.c], "out", { plugin: f.plugin, copy: true, silent: true });
  assert.equal(r.paths.get(f.c.path), "out/Tres 1.md");
  const collision = await api.moveFiles([f.c], "out", { plugin: f.plugin, silent: true });
  assert.equal(collision.moved, 0); assert.equal(collision.skipped, 1);
  assert.equal(f.moves.length, 3);
  const prior = f.renameCalls; f.vault.copy = undefined;
  const noCopy = await api.moveFiles([f.c], "ia/agentes", { plugin: f.plugin, copy: true, silent: true });
  assert.equal(noCopy.moved, 0); assert.equal(f.renameCalls, prior);
  const excluded = await api.moveFiles([f.c], "excluded", { plugin: f.plugin, silent: true });
  assert.equal(excluded.moved, 0); assert.equal(f.renameCalls, prior);
  assert.equal(f.moves.length, 3);
  assert.ok(source.includes("if (st.active && (st.changed || st.dirty))") || source.includes("(st.changed || st.dirty)"));
  assert.ok(source.includes("st.pending.add(key)"));
  assert.ok(source.includes("if (drag.group)"));
  assert.ok(!source.includes('n.emit("mouseover");\n      }, 150)'));
  const mk = (x, y, w) => ({ position: () => ({ x, y }), width: () => w || 42 });
  const hitGroups = [{ path: "ia/agentes", x: 0, y: 0, r: 100, nodes: [mk(0, 10), mk(40, 0)] }, { path: "out", x: 300, y: 0, r: 80, nodes: [] }];
  const hs = { dropsLabels: true, dropsLabelSize: 0.85 }, z = 1, pan = { x: 0, y: 0 };
  assert.equal(pure.hitDrop(hitGroups, { x: -70, y: -20 }, { x: -70, y: -20 }, z, pan, hs), hitGroups[0], "empty water grabs the drop");
  assert.equal(pure.hitDrop(hitGroups, { x: 40, y: 0 }, { x: 40, y: 0 }, z, pan, hs), null, "a node keeps its own drag");
  assert.equal(pure.hitDrop(hitGroups, { x: 0, y: -60 }, { x: 0, y: -60 }, z, pan, hs), hitGroups[0], "the label pill grabs the drop");
  assert.equal(pure.hitDrop(hitGroups, { x: 150, y: 0 }, { x: 150, y: 0 }, z, pan, hs), null, "outside every drop");
  assert.equal(pure.hitDrop(hitGroups, { x: 300, y: 0 }, { x: 300, y: 0 }, z, pan, hs), hitGroups[1]);
  assert.ok(source.includes("st.dropDrag") && source.includes('graph.addEventListener("mousedown", dropDown, true)'));
  assert.ok(source.includes("!overLimit()"), "the toggle must hide when the view exceeds maxNodes");
  assert.ok(source.includes("capturePositions(cy)"), "layouts are stored as independent copies");
  assert.ok(!source.includes("st.target.set(key, n.position())"), "no live position references in targets");
  await dragFlow(false);
  await dragFlow(true);
  activeNoteRefresh();
  graphEventsDoNotCountAsFileMoves();
  settleGroupStoresIndependentCopies();
  savedPositionsAreIndependentCopies();
  exitTweenHasNoOvershoot();
  jellyPhysicsRespondsToDrag();
  dropPathDeformsWithAcceleration();
  jellyStopWhileHeld();
  hoverGlowTiming();
  dragFeedsVelocity();
  buttonHiddenOverMaxNodes();
  nodeCountOverLimitExits();
  tagTapFocusOpensOnSecondClick();
  wheelAnchorKeepsCursorPoint();
  hoverDropIncludesNodesAndFadedPill();
  dropColorOverrideAndReset();
  bundleSchedulerRefreshesActiveMode();
  applyGraphEdgesReconcilesSewing();
  localRelationOnlyRenderPatchesWithoutLayout();
  activeDropsSyncRelationsContract();
  assert.ok(source.includes('graph.addEventListener("contextmenu", dropContext, true)'), "right-click on water opens the color menu");
  assert.ok(source.includes("dropsFolderColors"), "per-folder colors persist via settings");
  assert.ok(source.includes("fadeTarget < curFade ? 180 : 320"), "fade-out 180 ms / fade-in 320 ms");
  assert.ok(source.includes("render(now, dt)"), "render receives the frame delta for the fades");
  assert.ok(bundle.includes("BLG-TAG-FOCUS") && bundle.includes('easing:"ease-in-cubic"'), "bundle carries the tag focus animation");
  assert.ok(source.includes("cy.nodes().stop(true, true)"), "finish graph entry animations before saving the original layout");
  console.log("folder-drops: agrupamiento, empaquetado, zoom, move/copy/colisiones/exclusiones, animaciones, física de arrastre y glow OK");
})().catch(e => { console.error(e); process.exitCode = 1; });
