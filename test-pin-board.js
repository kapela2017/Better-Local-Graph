/* Node-only contract checks for the pin-board module. No vault writes. */
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
const source = fs.readFileSync(path.join(__dirname, "blg-pin-board.js"), "utf8");
const bundle = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");

/* Paridad: el módulo de bases va antes del pin-board, y el pin-board va
   incrustado en main.js ANTES del marcador de drops (drops debe seguir
   siendo marker→EOF para test-folder-drops.js). */
const basesSource = fs.readFileSync(path.join(__dirname, "blg-bases.js"), "utf8");
const basesMarker = "/* ============================================================\n   Better Local Graph — Nodos de consultas .base";
const pinMarker = "/* ============================================================\n   Better Local Graph — Pizarra de notas fijadas";
const dropsMarker = "/* ============================================================\n   Better Local Graph — Gotas de ubicación";
const basesIdx = bundle.indexOf(basesMarker), pinIdx = bundle.indexOf(pinMarker), dropsIdx = bundle.indexOf(dropsMarker);
assert.ok(basesIdx >= 0 && pinIdx > basesIdx && dropsIdx > pinIdx, "bases module embedded before pin-board and pin-board before drops");
assert.equal(bundle.slice(basesIdx, pinIdx), basesSource.trimEnd() + "\n");
assert.equal(bundle.slice(pinIdx, dropsIdx), source.trimEnd() + "\n");

/* i18n: toda clave usada existe en es y en */
const dict = {};
vm.runInNewContext(bundle.slice(bundle.indexOf('var BLG_LANG="es";'), bundle.indexOf("function L(k)")) + "\nglobalThis.dict = BLG_T;", dict);
const usedKeys = new Set(Array.from(source.matchAll(/\b(?:T|msg|notice)\(\s*["']([A-Za-z]\w+)["']/g), m => m[1]));
for (const key of usedKeys) for (const lang of ["es", "en"]) assert.ok(key in dict.dict[lang], `${lang}: ${key}`);
/* claves referenciadas por ternario/variable que el escaneo no alcanza */
for (const key of ["ctxPinNote", "ctxUnpinNote", "pinBtnShow", "pinBtnHide", "pinCount", "pinAdded", "pinRemoved",
  "pinEmptyTitle", "pinEmptyHint", "pinUnavailable", "pinOpen", "pinUnpin", "pinFit", "moveRoot"])
  for (const lang of ["es", "en"]) assert.ok(key in dict.dict[lang], `${lang}: ${key}`);

/* Instrumentación: exponer las funciones puras sin tocar el bundle. */
const instrumented = source.replace("  var _onload = PLUGIN_PROTO.onload",
  "  globalThis.__BLG_PINBOARD_TEST = { normalizeState, migrateRename, deriveEdges, findSpot, fitCamera, focusCam, anchorPan, previewText, sewCurve, borderPoint, rectsOverlap, folderOf, normalizeColor, edgeKey, relationPairs, tooltipFieldNames, frontmatterValues, formatMtime, dateFont, dateColor };\n  var _onload = PLUGIN_PROTO.onload");
assert.notEqual(instrumented, source);
const context = { module: { exports: { default: class { onload() {} onunload() {} } } },
  require(name) { if (name === "obsidian") return obsidian; return require(name); },
  console, globalThis: null };
context.globalThis = context;
vm.runInNewContext(instrumented, context, { filename: "blg-pin-board.js" });
const api = context.__BLG_PINBOARD, pure = context.__BLG_PINBOARD_TEST;
assert.deepEqual(Object.keys(api), ["addPinMenu", "isPinned", "pin", "unpin", "openBoard", "closeBoard", "boardState", "focusCard", "fitBoard", "layoutButtons"]);

/* ---------- normalizeState ---------- */
{
  const st = pure.normalizeState(null);
  assert.equal(st.version, 1);
  assert.equal(st.camera, null);
  assert.equal(st.nextZ, 1);
  assert.deepEqual(Object.keys(st.cards), []);
}
{
  const st = pure.normalizeState({ version: 9, camera: { x: "a", y: 1, z: 2 }, nextZ: 99,
    cards: { "a.md": { x: 10, y: 20, z: 3 }, "b.md": { x: NaN, y: 0, z: 1 }, "c.md": "junk", "d.md": { x: 1, y: 2, z: 0 } } });
  assert.equal(st.camera, null);
  assert.equal(JSON.stringify(st.cards["a.md"]), JSON.stringify({ x: 10, y: 20, z: 3 }));
  assert.ok(!("b.md" in st.cards) && !("c.md" in st.cards));
  assert.equal(st.cards["d.md"].z, 1);
  assert.equal(st.nextZ, 4);
}
{
  const st = pure.normalizeState({ camera: { x: 5, y: 6, z: 99 }, cards: {} });
  assert.equal(st.camera.z, 4); // clamp
}
{
  const st = pure.normalizeState({
    boardColor: "#A1B2C3",
    cards: { "a.md": { x: 1, y: 2, z: 3, color: "#FF00AA" }, "b.md": { x: 4, y: 5, z: 6, color: "red" } },
    edgeStyles: {
      ["a.md\0b.md"]: { color: "#00FFCC", dash: "solid" },
      ["b.md\0a.md"]: { color: "nope", dash: "dash" },
      bad: { color: "#ffffff", dash: "solid" }
    }
  });
  assert.equal(st.boardColor, "#a1b2c3");
  assert.equal(JSON.stringify(st.cards["a.md"]), JSON.stringify({ x: 1, y: 2, z: 3, color: "#ff00aa" }));
  assert.equal(JSON.stringify(st.cards["b.md"]), JSON.stringify({ x: 4, y: 5, z: 6 }));
  assert.equal(JSON.stringify(st.edgeStyles), JSON.stringify({ ["a.md\0b.md"]: { color: "#00ffcc", dash: "solid" }, ["b.md\0a.md"]: { dash: "dash" } }));
}

/* ---------- relaciones y campos visibles ---------- */
{
  assert.equal(pure.normalizeColor("#A1B2C3"), "#a1b2c3");
  assert.equal(pure.normalizeColor("red"), null);
  assert.equal(pure.edgeKey("a.md", "b.md"), "a.md\0b.md");
  assert.equal(JSON.stringify(pure.relationPairs(["a.md", "b.md"])), JSON.stringify([["a.md", "b.md"]]));
  assert.equal(JSON.stringify(pure.relationPairs(["a.md", "b.md", "c.md"], "parent")), JSON.stringify([["a.md", "b.md"], ["a.md", "c.md"]]));
  assert.equal(JSON.stringify(pure.relationPairs(["a.md", "b.md", "c.md"], "chain")), JSON.stringify([["a.md", "b.md"], ["b.md", "c.md"]]));
  assert.equal(JSON.stringify(pure.tooltipFieldNames({ tooltipProps: ["status", "aliases"] })), JSON.stringify(["status", "aliases"]));
  assert.equal(JSON.stringify(pure.tooltipFieldNames({ tooltipProps: [] })), JSON.stringify(["aliases"]));
  const fm = { alias: "Alias singular", status: "lectura", tags: ["a", "", null, "b"], empty: "" };
  assert.equal(JSON.stringify(pure.frontmatterValues(fm, "aliases")), JSON.stringify(["Alias singular"]));
  assert.equal(JSON.stringify(pure.frontmatterValues(fm, "tags")), JSON.stringify(["a", "b"]));
  assert.equal(JSON.stringify(pure.frontmatterValues(fm, "empty")), JSON.stringify([]));
  assert.equal(pure.formatMtime(0, "es"), "—");
  assert.ok(pure.formatMtime(Date.UTC(2026, 0, 2, 3, 4), "es").length > 4);
  assert.equal(pure.dateColor({ pinDateColor: "#A1B2C3" }), "#a1b2c3");
  assert.ok(pure.dateFont({ pinDateFont: "  Ink Free  " }).includes("Ink Free"));
}

/* ---------- migrateRename: archivo exacto y carpeta completa ---------- */
{
  const st = { cards: { "a/Uno.md": { x: 1, y: 2, z: 1 }, "a/sub/Dos.md": { x: 3, y: 4, z: 2 }, "b/Tres.md": { x: 5, y: 6, z: 3 } } };
  assert.equal(pure.migrateRename(st, "a/Uno.md", "a/Uno-renombrada.md"), true);
  assert.equal(JSON.stringify(st.cards["a/Uno-renombrada.md"]), JSON.stringify({ x: 1, y: 2, z: 1 }));
  assert.ok(!("a/Uno.md" in st.cards));
  assert.equal(pure.migrateRename(st, "a", "z"), true); // carpeta: migra TODOS los descendientes
  assert.deepEqual(Object.keys(st.cards).sort(), ["b/Tres.md", "z/Uno-renombrada.md", "z/sub/Dos.md"]);
  assert.equal(pure.migrateRename(st, "inexistente", "x"), false);
}

/* ---------- deriveEdges: solo costuras entre notas AMBAS fijadas ---------- */
{
  const sewing = { "a.md": ["b.md", "c.md"], "b.md": new Set(["a.md"]), "c.md": ["a.md"], "d.md": ["c.md"] };
  const edges = pure.deriveEdges(["a.md", "b.md", "c.md"], p => sewing[p]);
  assert.equal(JSON.stringify(edges), JSON.stringify([
    { from: "a.md", to: "b.md", kind: "sewing" },
    { from: "a.md", to: "c.md", kind: "sewing" },
    { from: "b.md", to: "a.md", kind: "sewing" },
    { from: "c.md", to: "a.md", kind: "sewing" }
  ]));
  // "d.md" no está fijada: sus costuras no aparecen
  assert.ok(!edges.some(e => e.from === "d.md" || e.to === "d.md"));
  // auto-costura ignorada
  const self = pure.deriveEdges(["a.md"], () => ["a.md"]);
  assert.equal(self.length, 0);
  // destino duplicado en la lista de costura no duplica la arista
  const dup = pure.deriveEdges(["a.md", "b.md"], () => ["b.md", "b.md"]);
  assert.equal(dup.length, 1);
  // una .base fijada conecta con sus resultados fijados; una costura base→nota no se duplica
  const bases = { "Tablero.base": ["a.md", "b.md", "z.md"] };
  const bedges = pure.deriveEdges(["a.md", "b.md", "Tablero.base"], p => p === "Tablero.base" ? [] : [], p => bases[p]);
  assert.equal(JSON.stringify(bedges), JSON.stringify([
    { from: "Tablero.base", to: "a.md", kind: "base" },
    { from: "Tablero.base", to: "b.md", kind: "base" }
  ]));
}

/* ---------- findSpot: nunca solapa y es determinista ---------- */
{
  const existing = [{ x: 0, y: 0, w: 220, h: 150 }];
  const spot = pure.findSpot(existing, { x: 110, y: 75 }, 220, 150, 26);
  assert.ok(!pure.rectsOverlap(spot.x, spot.y, 220, 150, 0, 0, 220, 150, 26));
  const again = pure.findSpot(existing, { x: 110, y: 75 }, 220, 150, 26);
  assert.equal(JSON.stringify(spot), JSON.stringify(again));
  const free = pure.findSpot([], { x: 400, y: 300 }, 220, 150, 26);
  assert.ok(Math.abs(free.x - (400 - 110)) <= 246 && Math.abs(free.y - (300 - 75)) <= 176);
}

/* ---------- fitCamera ---------- */
{
  const one = pure.fitCamera([{ x: 100, y: 50, w: 220, h: 150 }], { w: 800, h: 600 }, 60);
  assert.ok(one.z <= 1.25 && one.z >= 0.2);
  const cx = (one.x + one.z * (100 + 110)), cy = (one.y + one.z * (50 + 75));
  assert.ok(Math.abs(cx - 400) < 1e-9 && Math.abs(cy - 300) < 1e-9, "card centrada");
  const empty = pure.fitCamera([], { w: 800, h: 600 }, 60);
  assert.equal(JSON.stringify(empty), JSON.stringify({ x: 400, y: 300, z: 1 }));
  const wide = pure.fitCamera([{ x: 0, y: 0, w: 220, h: 150 }, { x: 5000, y: 0, w: 220, h: 150 }], { w: 800, h: 600 }, 60);
  assert.equal(wide.z, 0.2); // clamp inferior
}

/* Entrar a la pizarra siempre abre en vista general. La cámara persistida
   sirve para serializar el estado, pero ya no decide la entrada: si se
   restaurara, una salida durante el enfoque de una tarjeta reabriría allí. */
{
  const enterAt = source.indexOf("    function enter() {");
  const fitAt = source.indexOf("      cancelCamAnim();\n      var f = fitCamera(cardRects(), viewport(), 70);\n      setCam(f.x, f.y, f.z); saveCamSoon();", enterAt);
  assert.ok(enterAt >= 0 && fitAt > enterAt, "enter cancels any stale camera tween and fits every card");
  assert.ok(!source.includes("if (state.camera) setCam(state.camera.x, state.camera.y, state.camera.z);"),
    "enter must not restore the camera of the last reviewed card");
}

/* ---------- anchorPan: el punto del mundo bajo el cursor no se mueve ---------- */
{
  const pan = { x: 50, y: -30 }, z0 = 0.8, z1 = 1.4, ax = 300, ay = 200;
  const p1 = pure.anchorPan(pan, z0, z1, ax, ay);
  const mx = (ax - pan.x) / z0, my = (ay - pan.y) / z0;
  assert.ok(Math.abs(ax - (p1.x + mx * z1)) < 1e-9 && Math.abs(ay - (p1.y + my * z1)) < 1e-9);
}

/* ---------- focusCam: primer clic = centrar + zoom-in solo si está lejos ---------- */
{
  const vp = { w: 800, h: 600 }, rect = { x: 100, y: 50, w: 220, h: 150 };
  // Lejos (z<0.8): acerca a 1.1 para leer
  const far = pure.focusCam(rect, vp, 0.3);
  assert.equal(far.z, 1.1);
  // Siempre centra: cam + z·centro = centro del viewport
  const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
  assert.ok(Math.abs(far.x + far.z * cx - 400) < 1e-9 && Math.abs(far.y + far.z * cy - 300) < 1e-9);
  // Cerca y legible (0.8–2): NO hace zoom in, solo centra
  const near = pure.focusCam(rect, vp, 1.3);
  assert.equal(near.z, 1.3);
  // Muy cerca (z>2): aleja a un encuadre legible
  const huge = pure.focusCam(rect, vp, 3);
  assert.equal(huge.z, 1.5);
  // Panel estrecho: nunca deja la tarjeta recortada (encuadre mínimo)
  const tiny = pure.focusCam(rect, { w: 260, h: 600 }, 0.3);
  assert.ok(tiny.z <= (260 - 80) / 220 + 1e-9 && tiny.z >= 0.2);
  assert.ok(Math.abs(tiny.x + tiny.z * cx - 130) < 1e-9);
}

/* ---------- previewText ---------- */
{
  const md = "---\ntags: [x]\nsewing: [[Otra]]\n---\n# Título\n\nTexto con [[Nota|alias]], [[Simple]] y [enlace](http://x).\n\n- [ ] tarea\n> cita\n**negrita** y _cursiva_ `codigo`.\n\n```js\nvar no=1;\n```";
  const t = pure.previewText(md, 400);
  assert.ok(!t.includes("---") && !t.includes("tags"), "sin frontmatter");
  assert.ok(t.includes("alias") && t.includes("Simple") && t.includes("enlace"), "wikilinks y enlaces a texto");
  assert.ok(!t.includes("[["), "sin corchetes");
  assert.ok(!t.includes("#") && !t.includes("var no"), "sin marcador de encabezado ni código");
  assert.ok(t.includes("tarea") && t.includes("cita"), "listas y citas conservan su texto");
  assert.ok(t.includes("negrita") && t.includes("cursiva"), "énfasis sin asteriscos");
  const long = pure.previewText("a ".repeat(300), 100);
  assert.ok(long.length <= 100 && long.endsWith("…"));
}

/* ---------- sewCurve / borderPoint / folderOf ---------- */
{
  assert.equal(pure.sewCurve(0, 0, 100, 50), "M0,0 C50,0 50,50 100,50");
  const p = pure.borderPoint(0, 0, 100, 50, 200, 0);
  assert.ok(Math.abs(p.x - 54) < 1e-9 && Math.abs(p.y) < 1e-9, "borde derecho con margen");
  assert.equal(pure.folderOf("a/b/Nota.md"), "a/b");
  assert.equal(pure.folderOf("Nota.md"), "");
}

/* ---------- inserción en el menú cxttap del bundle ---------- */
assert.ok(bundle.includes("/* BLG-PIN: Fijar en pizarra */if(!this.plugin.session&&globalThis.__BLG_PINBOARD)globalThis.__BLG_PINBOARD.addPinMenu(s,{plugin:this.plugin,view:this,file:i});"),
  "bundle carries the pin menu insertion");
{
  const start = bundle.indexOf('this.cy.on("cxttap","node",a=>{');
  const endMarker = 's.showAtPosition({x:u.clientX,y:u.clientY})})';
  const end = bundle.indexOf(endMarker, start) + endMarker.length;
  assert.ok(start >= 0 && end >= start);
  const file = new TFile("docs/Nota.md", new TFolder("docs"));
  let callback, pinCalls = [];
  const items = [];
  const Menu = class { addItem(fn) { const item = {
    setTitle() { return this; }, setIcon() { return this; }, onClick() { return this; }
  }; fn(item); items.push(item); } showAtPosition() {} };
  const cy = { on(name, selector, fn) { assert.equal(name, "cxttap"); callback = fn; } };
  const plugin = { session: null, bookmark: null, aiClient: null,
    app: { vault: { getAbstractFileByPath: p => (p === file.path ? file : null) } } };
  const scope = { Oe: { TFile, Menu }, L: key => key,
    __BLG_DROPS: { resolveFile: () => null, addMoveToMenu: () => {} },
    __BLG_PINBOARD: { addPinMenu(menu, opts) { pinCalls.push(opts); } } };
  const install = vm.runInNewContext(`(function(){${bundle.slice(start, end)}})`, scope);
  install.call({ cy, app: plugin.app, plugin, currentPath: null });
  callback({ target: { id: () => file.path }, originalEvent: { clientX: 1, clientY: 1 } });
  assert.equal(pinCalls.length, 1, "addPinMenu invoked from the shared menu");
  assert.equal(pinCalls[0].file, file);
  assert.equal(pinCalls[0].plugin, plugin);
}

/* ---------- addPinMenu alterna fijar/desfijar y respeta la sesión ---------- */
{
  const pluginOn = { session: null, settings: { pinBoard: { version: 1, cards: { "docs/Nota.md": { x: 0, y: 0, z: 1 } } } } };
  assert.equal(api.isPinned(pluginOn, "docs/Nota.md"), true);
  assert.equal(api.isPinned(pluginOn, "docs/Otra.md"), false);
  const titles = [];
  const menu = { addItem(fn) { const item = {
    setIcon() { return this; }, setTitle(t) { titles.push(t); return this; }, onClick() { return this; }
  }; fn(item); } };
  api.addPinMenu(menu, { plugin: pluginOn, file: new TFile("docs/Nota.md", new TFolder("docs")) });
  assert.equal(JSON.stringify(titles), JSON.stringify(["ctxUnpinNote"]));
  const session = { session: { tag: "x" }, settings: {} };
  api.addPinMenu(menu, { plugin: session, file: new TFile("docs/Nota.md", new TFolder("docs")) });
  assert.equal(titles.length, 1, "sin entrada durante la sesión de costura");
}

/* ---------- API de acciones para el MCP (sin DOM) ---------- */
(async () => {
  /* Plugin mínimo: settings + vault + metadataCache en memoria. */
  function fakePlugin() {
    const files = new Map(), fm = new Map();
    const p = {
      settings: {}, _blgPin: null,
      async saveData() {},
      app: {
        vault: { getAbstractFileByPath: path => files.get(path) || null },
        metadataCache: {
          getFileCache: f => (fm.has(f.path) ? { frontmatter: fm.get(f.path) } : null),
          getFirstLinkpathDest: lt => {
            for (const f of files.values()) if (f.basename === lt || f.path === lt) return f;
            return null;
          }
        }
      },
      _add(path, frontmatter) {
        const f = new TFile(path, null);
        files.set(path, f);
        if (frontmatter) fm.set(path, frontmatter);
        return f;
      },
      _remove(path) { files.delete(path); fm.delete(path); }
    };
    return p;
  }

  /* boardState: tarjetas ordenadas por z, aristas de costura y estilos. */
  {
    const plugin = fakePlugin();
    const a = plugin._add("docs/A.md", { sewing: ["[[B]]"] });
    const b = plugin._add("docs/B.md");
    api.pin(plugin, a);
    api.pin(plugin, b);
    api.pin(plugin, a); // duplicado: no duplica ni mueve
    const st1 = api.boardState(plugin);
    assert.equal(st1.pinnedCount, 2);
    assert.equal(st1.active, false, "sin panel adjunto la pizarra no está activa");
    /* Los objetos vienen del realm vm: comparar serializados, no por prototipo. */
    assert.equal(JSON.stringify(st1.selected), "[]");
    assert.equal(JSON.stringify(st1.cards.map(c => c.path)), JSON.stringify(["docs/A.md", "docs/B.md"]), "orden por z de llegada");
    assert.ok(st1.cards.every(c => c.available));
    assert.equal(JSON.stringify(st1.edges), JSON.stringify([{ from: "docs/A.md", to: "docs/B.md", kind: "sewing", color: null, dash: "dash" }]));
    assert.equal(st1.camera, null);
    // estilo de arista persistido se refleja en el estado
    plugin.settings.pinBoard.edgeStyles["docs/A.md\0docs/B.md"] = { color: "#FF00AA", dash: "solid" };
    const st2 = api.boardState(plugin);
    assert.equal(JSON.stringify(st2.edges), JSON.stringify([{ from: "docs/A.md", to: "docs/B.md", kind: "sewing", color: "#ff00aa", dash: "solid" }]));
    // color de tarjeta normalizado; nota borrada → tarjeta no disponible y sin aristas
    plugin.settings.pinBoard.cards["docs/A.md"].color = "#FF00AA";
    plugin._remove("docs/B.md");
    const st3 = api.boardState(plugin);
    assert.equal(st3.cards.find(c => c.path === "docs/A.md").color, "#ff00aa");
    assert.equal(st3.cards.find(c => c.path === "docs/B.md").available, false);
    assert.equal(st3.edges.length, 0, "sin costuras hacia notas inexistentes");
    // unpin de una tarjeta cuya nota ya no existe: limpia también sus estilos
    api.unpin(plugin, "docs/B.md");
    const st4 = api.boardState(plugin);
    assert.equal(st4.pinnedCount, 1);
    assert.equal(Object.keys(plugin.settings.pinBoard.edgeStyles).length, 0);
    api.unpin(plugin, "docs/B.md"); // idempotente
    assert.equal(api.boardState(plugin).pinnedCount, 1);
  }

  /* pin persiste en settings.pinBoard vía saveData (sin pasar por saveSettings). */
  {
    const plugin = fakePlugin();
    let saves = 0;
    plugin.saveData = async () => { saves++; };
    api.pin(plugin, plugin._add("docs/A.md"));
    assert.ok(saves >= 1, "pin persiste con saveData");
    const raw = plugin.settings.pinBoard;
    assert.equal(raw.version, 1);
    assert.ok(raw.cards["docs/A.md"] && typeof raw.cards["docs/A.md"].x === "number" && raw.cards["docs/A.md"].z === 1);
    api.pin(plugin, plugin._add("docs/B.md"));
    assert.equal(plugin.settings.pinBoard.cards["docs/B.md"].z, 2, "nextZ crece");
  }

  /* Seguridad sin panel adjunto: nada explota y los retornos son falsos. */
  {
    const plugin = fakePlugin();
    assert.equal(api.closeBoard(plugin), true, "closeBoard sin pizarra no falla");
    assert.equal(api.focusCard(plugin, "docs/A.md"), false, "focus sin panel = false");
    assert.equal(api.fitBoard(plugin), false, "fit sin panel = false");
    assert.equal(await api.openBoard(null), false, "openBoard sin plugin = false");
    const noPanel = fakePlugin();
    noPanel.activateView = async () => {};
    assert.equal(await api.openBoard(noPanel, 0), false, "openBoard sin panel = false (sin espera)");
    assert.equal(api.boardState(null), null, "boardState sin plugin = null");
  }

  console.log("test-pin-board: all checks passed");
})().catch(e => { console.error(e); process.exit(1); });
