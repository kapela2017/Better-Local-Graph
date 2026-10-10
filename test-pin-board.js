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
const obsidian = { TFile, TFolder, Notice: class { constructor() {} },
  parseYaml(text) {
    const out = {};
    String(text || "").split(/\r?\n/).forEach(line => {
      const m = line.match(/^([^:#][^:]*):\s*(.*)$/);
      if (!m) return;
      const key = m[1].trim(), raw = m[2].trim();
      if (raw.startsWith("[") && raw.endsWith("]")) out[key] = raw.slice(1, -1).split(",").map(x => x.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
      else if (raw === "true" || raw === "false") out[key] = raw === "true";
      else out[key] = raw.replace(/^['"]|['"]$/g, "");
    });
    return out;
  } };
const source = fs.readFileSync(path.join(__dirname, "blg-pin-board.js"), "utf8");
const bundle = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");

/* Paridad: el módulo de bases va antes del pin-board, y el pin-board va
   incrustado en main.js ANTES del marcador de drops (drops debe seguir
   siendo marker→EOF para test-folder-drops.js). Los standalone pueden tener
   CRLF (Windows) y main.js embebe en LF: normalizar antes de comparar. */
const lf = s => s.replace(/\r\n/g, "\n");
const basesSource = lf(fs.readFileSync(path.join(__dirname, "blg-bases.js"), "utf8"));
const basesMarker = "/* ============================================================\n   Better Local Graph — Nodos de consultas .base";
const pinMarker = "/* ============================================================\n   Better Local Graph — Pizarra de notas fijadas";
const dropsMarker = "/* ============================================================\n   Better Local Graph — Gotas de ubicación";
const basesIdx = bundle.indexOf(basesMarker), pinIdx = bundle.indexOf(pinMarker), dropsIdx = bundle.indexOf(dropsMarker);
assert.ok(basesIdx >= 0 && pinIdx > basesIdx && dropsIdx > pinIdx, "bases module embedded before pin-board and pin-board before drops");
assert.equal(bundle.slice(basesIdx, pinIdx).replace(/\s+$/, ""), basesSource.replace(/\s+$/, ""), "bases embebido = blg-bases.js");
assert.equal(bundle.slice(pinIdx, dropsIdx).replace(/\s+$/, ""), lf(source).replace(/\s+$/, ""), "pin-board embebido = blg-pin-board.js");

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
  "  globalThis.__BLG_PINBOARD_TEST = { normalizeState, migrateRename, deriveEdges, findSpot, fitCamera, focusCam, anchorPan, previewText, sewCurve, borderPoint, rectsOverlap, folderOf, normalizeColor, edgeKey, relationPairs, tooltipFieldNames, frontmatterValues, formatMtime, dateFont, dateColor, baseHidden, visibleBaseResults, taskSettings, isTaskNote, taskTitle, taskTitleProp, taskCompletedValues, taskStatusValue, taskIsCompleted, setTaskCompleted, taskTemplatePatch, taskTemplatePath, parseFrontmatterBlock, templateMarkdownFiles, cardTaskInfo, taskNotesEnabled, taskNotesPlugin, askTaskTitle, DEFAULT_TASK_COLOR };\n  var _onload = PLUGIN_PROTO.onload");
assert.notEqual(instrumented, source);
const context = { module: { exports: { default: class { onload() {} onunload() {} } } },
  require(name) { if (name === "obsidian") return obsidian; return require(name); },
  console, globalThis: null };
context.globalThis = context;
vm.runInNewContext(instrumented, context, { filename: "blg-pin-board.js" });
const api = context.__BLG_PINBOARD, pure = context.__BLG_PINBOARD_TEST;
assert.deepEqual(Object.keys(api), ["addPinMenu", "isPinned", "pin", "unpin", "openBoard", "closeBoard", "boardState", "focusCard", "fitBoard", "setTaskCompleted", "layoutButtons"]);

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

/* ---------- filtro de visibilidad de .base (basesMode none/all/custom) ---------- */
{
  // __BLG_BASES stub: solo B.base es visible
  context.__BLG_BASES = {
    isVisible: (plugin, p) => p === "B.base",
    resultsFor: (plugin, p) => ({ "A.base": ["a.md"], "B.base": ["b.md"] }[p] || []),
    mode: () => "custom"
  };
  const plugin = { settings: { basesMode: "custom", basesCustom: ["B.base"] } };
  assert.equal(pure.baseHidden(plugin, "A.base"), true, "base fuera de la lista = oculta");
  assert.equal(pure.baseHidden(plugin, "B.base"), false, "base en la lista = visible");
  assert.equal(pure.baseHidden(plugin, "nota.md"), false, "una nota nunca se oculta por este filtro");
  /* aristas consulta→nota vacías para bases ocultas, intactas para visibles */
  assert.equal(JSON.stringify(pure.visibleBaseResults(plugin, "A.base")), "[]");
  assert.equal(JSON.stringify(pure.visibleBaseResults(plugin, "B.base")), '["b.md"]');
  /* deriveEdges con la closure de visibilidad: A.base oculta no produce aristas base */
  const edges = pure.deriveEdges(["a.md", "b.md", "A.base", "B.base"], () => [], p => pure.visibleBaseResults(plugin, p));
  assert.equal(JSON.stringify(edges), JSON.stringify([{ from: "B.base", to: "b.md", kind: "base" }]));
  /* sin __BLG_BASES (módulo no cargado): nada se oculta ni se filtra */
  delete context.__BLG_BASES;
  assert.equal(pure.baseHidden(plugin, "A.base"), false);
  assert.equal(JSON.stringify(pure.visibleBaseResults(plugin, "A.base")), "[]");
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

/* ---------- TaskNotes: detección, plantilla y conversión (puras) ---------- */
{
  const taskSettings = { taskIdentificationMethod: "tag", taskTag: "Pendiente", defaultTaskStatus: "open", defaultTaskPriority: "normal" };
  assert.equal(pure.isTaskNote(null, { path: "docs/Tarea.md" }, { tags: ["Pendiente"] }, null, taskSettings), true, "tag exacto detecta tarea");
  assert.equal(pure.isTaskNote(null, { path: "docs/Tarea.md" }, { tags: ["pendiente/urgente"] }, null, taskSettings), true, "subtag y case-insensitive");
  assert.equal(pure.isTaskNote(null, { path: "docs/Nota.md" }, { tags: ["pendienteza"] }, null, taskSettings), false, "un prefijo distinto no es el tag");
  assert.equal(pure.isTaskNote(null, { path: "docs/Query.base" }, { tags: ["Pendiente"] }, null, taskSettings), false, "una .base nunca es tarea");
  assert.equal(pure.isTaskNote(null, { path: "docs/Tarea.md" }, { tipo: "task" }, null,
    { taskIdentificationMethod: "property", taskPropertyName: "tipo", taskPropertyValue: "task" }), true, "identificación por propiedad");
  assert.equal(pure.taskTitle({ title: "  Revisar informe  " }, { basename: "Tarea" }), "Revisar informe", "el encabezado usa el título");
  assert.equal(pure.taskTitle({ title: " " }, { basename: "Tarea" }), "Tarea", "sin título cae al basename");
  /* La plantilla ANEXA propiedades YAML: jamás reemplaza (ni "" ni false ni 0),
     fusiona tags sin duplicar, jamás toca sewing y añade el identificador. */
  const patch = pure.taskTemplatePatch(
    { status: "in-progress", tags: ["Personal"] },
    { status: "open", priority: "high", icon: "alarm", tags: ["Admin", "personal"] },
    taskSettings);
  assert.equal(JSON.stringify(patch), JSON.stringify({ priority: "high", icon: "alarm", tags: ["Personal", "Admin", "Pendiente"] }),
    "anexa huecos, fusiona tags de la plantilla sin duplicar (case-insensitive) y añade el identificador");
  assert.equal(pure.taskTemplatePatch(
    { tags: ["Pendiente"], done: false, count: 0, note: "" },
    { done: true, count: 5, note: "relleno", sewing: ["[[X]]"] },
    taskSettings), null, "valores existentes (false/0/\"\") se conservan y sewing jamás se copia");
  assert.equal(pure.taskTemplatePatch({ tags: ["Pendiente"] }, {}, taskSettings), null, "ya era tarea: no hay toque de archivo");
  assert.equal(JSON.stringify(pure.taskTemplatePatch(
    { tags: ["Pendiente"] }, { area: "Casa" }, taskSettings)),
    JSON.stringify({ area: "Casa" }), "ya siendo tarea aún anexa las propiedades que faltan");
  assert.equal(JSON.stringify(pure.taskTemplatePatch(
    {}, { area: "Casa" },
    { taskIdentificationMethod: "property", taskPropertyName: "tipo", taskPropertyValue: "task" })),
    JSON.stringify({ area: "Casa", tipo: "task" }), "método property: anexa propiedades e identificador");
  assert.equal(JSON.stringify(pure.taskTemplatePatch(
    { tags: "Admin Personal" }, { tags: ["Casa"] }, taskSettings)),
    JSON.stringify({ tags: ["Admin", "Personal", "Casa", "Pendiente"] }), "tags propios en string se conservan y se anexan");
  /* La fusión respeta la propiedad que la nota YA use (`tag` singular) y
     rellena la propiedad cuando está nula. */
  assert.equal(JSON.stringify(pure.taskTemplatePatch(
    { tag: ["Personal"] }, { tags: ["Admin"] }, taskSettings)),
    JSON.stringify({ tag: ["Personal", "Admin", "Pendiente"] }), "nota con `tag` singular: la fusión se escribe en `tag`");
  assert.equal(JSON.stringify(pure.taskTemplatePatch(
    { tags: null }, {}, taskSettings)),
    JSON.stringify({ tags: ["Pendiente"] }), "tags nulo se rellena con el identificador");
  /* Título: prioridad caché TaskNotes → fm.title → basename. */
  assert.equal(pure.taskTitle(null, { basename: "N" }, { title: "  Mi tarea  " }), "Mi tarea", "el encabezado usa fm.title");
  assert.equal(pure.taskTitle(null, { basename: "N" }, { title: "" }), "N", "title vacío cae al basename");
  assert.equal(pure.taskTitle(null, { basename: "N" }, { title: null }), "N", "title nulo cae al basename");
  assert.equal(pure.taskTitle({ title: "Cache" }, { basename: "N" }, { title: "Fm" }), "Cache", "la caché de TaskNotes manda");
  /* El modal solo se pide si `title` existe en la nota O en la plantilla. */
  assert.equal(pure.taskTitleProp({}, {}), null, "sin title en ninguna: no se pregunta");
  assert.equal(pure.taskTitleProp({ Date: "2026-10-02" }, { status: "open" }), null, "otras propiedades no activan el modal");
  assert.equal(JSON.stringify(pure.taskTitleProp({}, { title: null })), JSON.stringify({ prefill: "" }), "title nulo en plantilla: se pregunta sin prefill");
  assert.equal(JSON.stringify(pure.taskTitleProp({ title: "Mi tarea" }, {})), JSON.stringify({ prefill: "Mi tarea" }), "title de la nota se prefiere como prefill");
  assert.equal(JSON.stringify(pure.taskTitleProp({ title: "  " }, { title: "X" })), JSON.stringify({ prefill: "" }), "title en blanco: prefill vacío");
  assert.equal(pure.taskTemplatePath("Plantillas/Tarea"), "Plantillas/Tarea.md");
  assert.equal(pure.taskTemplatePath("[[Plantillas/Tarea.md]]"), "Plantillas/Tarea.md");
  /* Las plantillas se buscan SOLO en la carpeta configurada (subcarpetas
     incluidas, sin distinguir mayúsculas); sin carpeta no se lista nada. */
  const tplApp = { vault: { getMarkdownFiles: () => [
    { path: "Templater/Tpl TaskNotes.md" },
    { path: "Templater/Sub/Diaria.md" },
    { path: "Otras/Nota.md" },
    { path: "TemplaterX/Fuera.md" },
    { path: "Raiz.md" }
  ] } };
  const j = JSON.stringify;
  assert.equal(j(pure.templateMarkdownFiles(tplApp, "Templater")),
    j(["Templater/Sub/Diaria.md", "Templater/Tpl TaskNotes.md"]), "solo la carpeta y sus subcarpetas");
  assert.equal(j(pure.templateMarkdownFiles(tplApp, "templater")),
    j(["Templater/Sub/Diaria.md", "Templater/Tpl TaskNotes.md"]), "la carpeta no distingue mayúsculas");
  assert.equal(j(pure.templateMarkdownFiles(tplApp, " Templater/ ")),
    j(["Templater/Sub/Diaria.md", "Templater/Tpl TaskNotes.md"]), "espacios y barra final se limpian");
  assert.equal(j(pure.templateMarkdownFiles(tplApp, "")), j([]), "sin carpeta configurada: no lista toda la bóveda");
  assert.equal(j(pure.templateMarkdownFiles(tplApp, "Otras")), j(["Otras/Nota.md"]), "otra carpeta solo da sus notas");
  assert.equal(j(pure.templateMarkdownFiles(tplApp, "Inexistente")), j([]), "carpeta inexistente: vacío");
  const parsed = pure.parseFrontmatterBlock("---\nstatus: open\npriority: high\n---\n\n# Cuerpo\nTexto");
  assert.equal(JSON.stringify(parsed.frontmatter), JSON.stringify({ status: "open", priority: "high" }));
  assert.ok(parsed.body.includes("# Cuerpo"));
  const defaults = pure.taskSettings({});
  assert.equal(defaults.enabled, true);
  assert.equal(defaults.color, pure.DEFAULT_TASK_COLOR);
  assert.equal("bodyMode" in defaults, false, "la plantilla ya no tiene modo de cuerpo");
  /* cardTaskInfo: resumen serializable para el MCP (boardState). */
  const tnPlugin = {
    settings: {},
    app: {
      plugins: { enabledPlugins: new Set(["tasknotes"]), getPlugin: () => ({ settings: { taskIdentificationMethod: "tag", taskTag: "task", defaultTaskStatus: "open", defaultTaskPriority: "normal" } }) },
      metadataCache: { getFileCache: () => ({ frontmatter: { tags: ["task"], status: "doing", due: "2026-10-05" } }) }
    }
  };
  const ti = pure.cardTaskInfo(tnPlugin, { path: "docs/T.md", basename: "T" });
  assert.equal(ti.title, "T", "sin caché de TaskNotes el título cae al basename");
  assert.equal(ti.status, "doing");
  assert.equal(ti.priority, "normal");
  assert.equal(ti.due, "2026-10-05");
  assert.equal(ti.scheduled, null);
  assert.equal(pure.cardTaskInfo(tnPlugin, { path: "docs/Q.base", basename: "Q" }), null, "una .base nunca reporta tarea");
  tnPlugin.app.metadataCache.getFileCache = () => ({ frontmatter: { tags: ["otra"] } });
  assert.equal(pure.cardTaskInfo(tnPlugin, { path: "docs/N.md", basename: "N" }), null, "sin identificador no es tarea");
  tnPlugin.settings.pinTasksEnabled = false;
  assert.equal(pure.cardTaskInfo(tnPlugin, { path: "docs/T.md", basename: "T" }), null, "integración desactivada: sin tareas");
  /* TaskNotes debe estar instalado Y habilitado en Obsidian. */
  const tnEnabledSet = new Set(["tasknotes"]);
  const tnPlugins = { tasknotes: { settings: { taskTag: "task" } } };
  /* Mock fiel a Obsidian: un plugin desactivado NO tiene instancia cargada. */
  const mkPl = () => ({ app: { plugins: { enabledPlugins: tnEnabledSet,
    getPlugin: id => tnEnabledSet.has(id) ? tnPlugins[id] : undefined, plugins: {} } } });
  assert.equal(pure.taskNotesEnabled(mkPl()), true, "Set habilita");
  tnEnabledSet.delete("tasknotes");
  assert.equal(pure.taskNotesEnabled(mkPl()), false, "desactivado: sin instancia cargada");
  assert.equal(pure.taskNotesPlugin(mkPl()), null, "getPlugin devuelve null si no está habilitado");
  tnEnabledSet.add("tasknotes");
  assert.equal(pure.taskNotesPlugin(mkPl()), tnPlugins.tasknotes, "habilitado devuelve el plugin");
  /* Better Plugins Manager con DELAY: la instancia está cargada aunque el id
     no figure en enabledPlugins (que solo contiene al gestor). */
  const bpmPl = { app: { plugins: { enabledPlugins: new Set(["better-plugins-manager"]),
    plugins: { tasknotes: tnPlugins.tasknotes }, getPlugin: id => ({ tasknotes: tnPlugins.tasknotes })[id] } } };
  assert.equal(pure.taskNotesEnabled(bpmPl), true, "BPM diferido: instancia cargada habilita");
  assert.equal(pure.taskNotesPlugin(bpmPl), tnPlugins.tasknotes, "BPM diferido: devuelve la instancia");
  /* Registro como Map (algunas versiones) */
  assert.equal(pure.taskNotesEnabled({ app: { plugins: { enabledPlugins: new Set(), plugins: new Map([["tasknotes", {}]]) } } }), true, "registry Map habilita");
  /* Array en vez de Set */
  assert.equal(pure.taskNotesEnabled({ app: { plugins: { enabledPlugins: ["tasknotes"] } } }), true, "Array habilita");
  assert.equal(pure.taskNotesEnabled({ app: { plugins: { enabledPlugins: [] } } }), false, "Array sin tasknotes ni instancia");
  /* Solo registry (móvil / fallbacks antiguos) */
  assert.equal(pure.taskNotesEnabled({ app: { plugins: { plugins: { tasknotes: {} } } } }), true, "registry habilita");
  assert.equal(pure.taskNotesEnabled({ app: { plugins: {} } }), false, "sin registry no está habilitado");
  assert.equal(pure.taskNotesPlugin({ app: { plugins: {} } }), null, "sin registry plugin null");
}

/* ---------- check ✅ de tarea: estado completado (lectura) ---------- */
{
  /* taskCompletedValues: solo cuentan los estados con isCompleted=true. */
  assert.equal(JSON.stringify(pure.taskCompletedValues({ customStatuses: [
    { value: "open", isCompleted: false }, { value: "done", isCompleted: true },
    { value: "cancelled", isCompleted: true }, { value: "doing" }, { isCompleted: true } ] })),
    JSON.stringify(["done", "cancelled"]), "solo isCompleted=true y con valor cuentan");
  assert.equal(JSON.stringify(pure.taskCompletedValues({})), JSON.stringify([]), "sin customStatuses: vacío");
  /* taskStatusValue: caché → frontmatter → estado por defecto. */
  assert.equal(pure.taskStatusValue({ status: "doing" }, { status: "done" }, { defaultTaskStatus: "open" }), "doing");
  assert.equal(pure.taskStatusValue(null, { status: "done" }, { defaultTaskStatus: "open" }), "done");
  assert.equal(pure.taskStatusValue(null, {}, { defaultTaskStatus: "open" }), "open");
  assert.equal(pure.taskStatusValue(null, null, null), "");
  /* taskIsCompleted: statusManager de TaskNotes > customStatuses > convenio. */
  const withMgr = { app: { plugins: { enabledPlugins: new Set(["tasknotes"]),
    getPlugin: () => ({ statusManager: { isCompletedStatus: s => s === "weird" } }) } } };
  assert.equal(pure.taskIsCompleted(withMgr, "weird", {}), true, "el statusManager de TaskNotes manda");
  assert.equal(pure.taskIsCompleted(withMgr, "done", {}), false, "el statusManager puede redefinir 'done'");
  const tnSet = { customStatuses: [{ value: "done", isCompleted: true }] };
  assert.equal(pure.taskIsCompleted(null, "done", tnSet), true, "customStatuses: done completada");
  assert.equal(pure.taskIsCompleted(null, "open", tnSet), false, "customStatuses: open pendiente");
  assert.equal(pure.taskIsCompleted(null, "done", {}), true, "convenio: done sin configuración");
  assert.equal(pure.taskIsCompleted(null, "completed", {}), true, "convenio: completed sin configuración");
  assert.equal(pure.taskIsCompleted(null, "open", {}), false, "convenio: open pendiente");
  /* cardTaskInfo incluye completed = el check visible de la tarjeta. */
  const tnPl2 = { settings: {}, app: {
    plugins: { enabledPlugins: new Set(["tasknotes"]), getPlugin: () => ({ settings: {
      taskTag: "task", defaultTaskStatus: "open",
      customStatuses: [{ value: "open", isCompleted: false }, { value: "done", isCompleted: true }] } }) },
    metadataCache: { getFileCache: () => ({ frontmatter: { tags: ["task"], status: "done" } }) } } };
  const tiDone = pure.cardTaskInfo(tnPl2, { path: "docs/T.md", basename: "T" });
  assert.equal(tiDone.status, "done");
  assert.equal(tiDone.completed, true, "cardTaskInfo reporta el check completado");
  tnPl2.app.metadataCache.getFileCache = () => ({ frontmatter: { tags: ["task"], status: "open" } });
  assert.equal(pure.cardTaskInfo(tnPl2, { path: "docs/T.md", basename: "T" }).completed, false, "pendiente: check en false");
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

  /* Contrato del modal "Asigne el Nombre de la Tarea": aceptar resuelve el
     valor (Guardar, Enter, usar título de la nota) aunque Modal.close()
     dispare onClose; cancelar/ESC resuelve null y no tocaría la nota. */
  {
    function fakeModalOe() {
      const els = [];
      function mkEl(tag, opts) {
        const el = {
          tag, style: {}, value: "", text: (opts && opts.text) || "",
          listeners: {}, hidden: false,
          setText() {}, focus() {}, select() {},
          createEl(t, o) { const c = mkEl(t, o); els.push(c); return c; },
          createDiv() { const c = mkEl("div"); els.push(c); return c; },
          addEventListener(type, fn) { (el.listeners[type] = el.listeners[type] || []).push(fn); },
          click() { (el.listeners.click || []).forEach(fn => fn()); },
          pressKey(key) { (el.listeners.keydown || []).forEach(fn => fn({ key, preventDefault() {} })); }
        };
        return el;
      }
      class Modal {
        constructor() { this.titleEl = mkEl("h2"); this.contentEl = mkEl("div"); }
        open() {}
        close() { this.onClose(); }
      }
      const OeX = { Modal };
      return {
        OeX,
        input: () => els.find(e => e.tag === "input"),
        buttons: () => els.filter(e => e.tag === "button")
      };
    }
    const FILE = { basename: "Untitled 2" };
    // Guardar con texto escrito → ese texto recortado (pese al onClose de close())
    {
      const r = fakeModalOe();
      const p = pure.askTaskTitle(r.OeX, {}, FILE, "");
      r.input().value = "  Revisar informe  ";
      r.buttons()[0].click(); // Guardar (mod-cta, primero)
      assert.equal(await p, "Revisar informe", "Guardar resuelve el texto escrito");
    }
    // Guardar con campo vacío → basename de la nota
    {
      const r = fakeModalOe();
      const p = pure.askTaskTitle(r.OeX, {}, FILE, "");
      r.input().value = "   ";
      r.buttons()[0].click();
      assert.equal(await p, "Untitled 2", "campo vacío cae al nombre de la nota");
    }
    // Enter en el cuadro → confirma lo escrito
    {
      const r = fakeModalOe();
      const p = pure.askTaskTitle(r.OeX, {}, FILE, "");
      r.input().value = "Por Enter";
      r.input().pressKey("Enter");
      assert.equal(await p, "Por Enter", "Enter confirma el texto");
    }
    // "Usar título de la nota" → basename directo
    {
      const r = fakeModalOe();
      const p = pure.askTaskTitle(r.OeX, {}, FILE, "Otro");
      r.input().value = "Cualquier cosa";
      r.buttons()[1].click();
      assert.equal(await p, "Untitled 2", "el botón usa el título de la nota");
    }
    // Cancelar → null (la conversión no toca la nota)
    {
      const r = fakeModalOe();
      const p = pure.askTaskTitle(r.OeX, {}, FILE, "");
      r.buttons()[2].click();
      assert.equal(await p, null, "Cancelar resuelve null");
    }
    // Prefill: con valor lo usa; sin valor usa el basename
    {
      const r = fakeModalOe();
      const p = pure.askTaskTitle(r.OeX, {}, FILE, "Mi tarea previa");
      assert.equal(r.input().value, "Mi tarea previa", "prefill rellena el cuadro");
      r.buttons()[2].click();
      await p;
      const r2 = fakeModalOe();
      const p2 = pure.askTaskTitle(r2.OeX, {}, FILE, "");
      assert.equal(r2.input().value, "Untitled 2", "sin prefill el cuadro muestra el nombre de la nota");
      r2.buttons()[2].click();
      await p2;
    }
  }

  /* ---------- check ✅ de tarea: escritura bidireccional (setTaskCompleted) ---------- */
  {
    const calls = [];
    const tnInst3 = {
      settings: { taskTag: "task", defaultTaskStatus: "open",
        customStatuses: [{ value: "open", isCompleted: false }, { value: "done", isCompleted: true }] },
      api: { apiVersion: 1, tasks: {
        complete: async p => { calls.push(["complete", p]); tnPl3.fm.status = "done"; },
        uncomplete: async p => { calls.push(["uncomplete", p]); tnPl3.fm.status = "open"; } } }
    };
    const tnPl3 = { settings: {}, fm: { tags: ["task"], status: "open" }, app: {
      plugins: { enabledPlugins: new Set(["tasknotes"]), getPlugin: () => tnInst3, plugins: { tasknotes: tnInst3 } },
      metadataCache: { getFileCache: () => ({ frontmatter: tnPl3.fm }) }, vault: {} } };
    const tf = { path: "docs/T.md", basename: "T" };
    let r = await pure.setTaskCompleted(tnPl3, tf, true);
    assert.equal(JSON.stringify(r), JSON.stringify({ completed: true, unchanged: false }), "marcar ✅ escribe vía api.tasks.complete");
    assert.equal(JSON.stringify(calls), JSON.stringify([["complete", "docs/T.md"]]));
    r = await pure.setTaskCompleted(tnPl3, tf, true);
    assert.equal(r.unchanged, true, "ya completada: no reescribe (idempotente)");
    assert.equal(calls.length, 1, "sin segunda llamada a la API");
    r = await pure.setTaskCompleted(tnPl3, tf, false);
    assert.equal(JSON.stringify(r), JSON.stringify({ completed: false, unchanged: false }), "desmarcar reabre vía api.tasks.uncomplete");
    assert.equal(JSON.stringify(calls[1]), JSON.stringify(["uncomplete", "docs/T.md"]));
    assert.equal(tnPl3.fm.status, "open", "el frontmatter quedó pendiente (lo leerá la tarjeta)");
    /* Respaldo sin API pública: el toggle de la instancia de TaskNotes. */
    const toggles = [];
    const tnInst4 = { settings: tnInst3.settings, toggleTaskStatus: async t => { toggles.push(t.path); } };
    const tnPl4 = { settings: {}, app: {
      plugins: { enabledPlugins: new Set(["tasknotes"]), getPlugin: () => tnInst4, plugins: { tasknotes: tnInst4 } },
      metadataCache: { getFileCache: f => f && f.path === "docs/T.md" ? { frontmatter: { tags: ["task"], status: "open" } } : null }, vault: {} } };
    r = await pure.setTaskCompleted(tnPl4, { path: "docs/T.md", basename: "T" }, true);
    assert.equal(r.completed, true);
    assert.equal(JSON.stringify(toggles), JSON.stringify(["docs/T.md"]), "sin API usa toggleTaskStatus de la instancia");
    /* Guardas: integración desactivada, TaskNotes ausente y no-tarea → null. */
    const tnPl5 = { settings: { pinTasksEnabled: false }, app: tnPl4.app };
    assert.equal(await pure.setTaskCompleted(tnPl5, tf, true), null, "integración desactivada: null");
    assert.equal(await pure.setTaskCompleted({ settings: {}, app: { plugins: {}, metadataCache: { getFileCache: () => null }, vault: {} } }, tf, true), null, "sin TaskNotes: null");
    assert.equal(await pure.setTaskCompleted(tnPl4, { path: "docs/N.md", basename: "N" }, true), null, "nota que no es tarea: null");
    assert.equal(await pure.setTaskCompleted(tnPl4, { path: "docs/Q.base", basename: "Q" }, true), null, "una .base nunca se completa");
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

  /* Borrar una nota la desfija: el handler de vault "delete" llama unpinPath
     (no availability): la tarjeta desaparece de la pizarra, abierta o no. */
  {
    const delBlock = source.match(/vault\.on\("delete"[\s\S]{0,420}?\}\)\);/);
    assert.ok(delBlock, "hay handler de borrado");
    assert.ok(/unpinPath\(plugin, file\.path\)/.test(delBlock[0]), "borrar desfija la tarjeta");
    assert.ok(!/availability\(file\.path, false\)/.test(delBlock[0]), "ya no conserva el pin como no disponible");
    /* comportamiento: unpin retira tarjeta y estilos (cubierto arriba con api.unpin) */
  }

  console.log("test-pin-board: all checks passed");
})().catch(e => { console.error(e); process.exit(1); });
