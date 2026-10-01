/* Node-only contract checks for the MCP Bases tools (blg_get_current_view mode='bases',
   blg_get_current_base, blg_update_base_cards). Loads blg-mcp-server.js in a vm with
   stubbed obsidian/http and a fake __BLG_BASES API. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

class TFolder { constructor(pathname) { this.path = pathname; } }
class TFile {
  constructor(pathname, parent) {
    this.path = pathname;
    this.parent = parent || new TFolder(path.posix.dirname(pathname) === "." ? "" : path.posix.dirname(pathname));
    this.name = path.posix.basename(pathname);
    this.extension = (this.name.match(/\.([^.]+)$/) || [null, "md"])[1];
    this.basename = this.name.replace(/\.[^.]+$/, "");
    this.stat = { ctime: 1, mtime: 2, size: 3 };
  }
}

const obsidian = { TFile, TFolder, Notice: class { constructor() {} }, parsePropertyId: s => s };
const httpStub = { createServer: () => ({ on() {}, listen() {}, close() {} }) };

class FakePlugin {
  async onload() {}
  async onunload() {}
}

const source = fs.readFileSync(path.join(__dirname, "blg-mcp-server.js"), "utf8");
const context = {
  module: { exports: { default: FakePlugin } },
  require(name) {
    if (name === "obsidian") return obsidian;
    if (name === "http") return httpStub;
    return require(name);
  },
  console
};
context.globalThis = context;
vm.runInNewContext(source, context, { filename: "blg-mcp-server.js" });

function makeApp() {
  const files = new Map();
  const app = {
    files,
    vault: {
      getAbstractFileByPath: p => files.get(p) || null,
      getMarkdownFiles: () => Array.from(files.values()).filter(f => f.extension === "md"),
      getFiles: () => Array.from(files.values())
    },
    metadataCache: {
      getFileCache: () => null,
      getFirstLinkpathDest: () => null,
      resolvedLinks: {},
      isUserIgnored: () => false,
      on: () => {}
    },
    fileManager: {
      processFrontMatter: async (file, fn) => {
        const cache = app.metadataCache.getFileCache(file);
        const fm = (cache && cache.frontmatter) || {};
        fn(fm);
        if (cache) cache.frontmatter = fm;
        return fm;
      }
    },
    workspace: {}
  };
  return app;
}

/* API de bases falsa con la misma forma que __BLG_BASES. */
function fakeBasesApi() {
  const records = new Map();
  const api = {
    isBaseFile: f => f instanceof TFile && f.extension === "base",
    record: (plugin, path) => records.get(path) || null,
    files: () => Array.from(records.values()),
    refresh: async () => {},
    refreshBase: async () => {},
    resultsFor: (plugin, path) => records.get(path) ? records.get(path).paths : [],
    basesContaining: () => [],
    contains: () => false,
    invalidatePath: () => {},
    notifyFile: () => {},
    /* store de costuras .md ↔ .base (misma forma que sew de blg-bases.js) */
    sew: {
      pairs: [],
      targetsMap: new Map(), // path -> Set<path>
      tagsMap: new Map(),    // path -> [tags]
      pair: async (plugin, parent, child) => {
        api.sew.pairs.push([parent.path, child.path]);
        if (!api.sew.targetsMap.has(parent.path)) api.sew.targetsMap.set(parent.path, new Set());
        api.sew.targetsMap.get(parent.path).add(child.path);
      },
      targets: (app, file) => api.sew.targetsMap.get(file.path) || new Set(),
      tags: (app, file) => (api.sew.tagsMap.get(file.path) || []).slice()
    },
    _setRecord: (path, rec) => records.set(path, rec)
  };
  return api;
}

async function makeServer() {
  const plugin = new FakePlugin();
  plugin.settings = { mcpEnabled: true, mcpToken: "t", mcpPort: 0 };
  plugin.app = makeApp();
  plugin._blgBases = { cache: new Map(), version: 0 };
  context.__BLG_BASES = fakeBasesApi();
  await plugin.onload();
  assert.ok(plugin._blgMcp, "servidor MCP creado en onload");
  return plugin;
}
const call = (plugin, name, args) => plugin._blgMcp.tools[name].handler(args);
const eqJ = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);

(async () => {
  /* ---------- tools/list expone las nuevas herramientas ---------- */
  {
    const plugin = await makeServer();
    const reply = await plugin._blgMcp._dispatch({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const names = reply.result.tools.map(t => t.name);
    assert.ok(names.includes("blg_get_current_base"), "blg_get_current_base listada");
    assert.ok(names.includes("blg_update_base_cards"), "blg_update_base_cards listada");
  }

  /* ---------- get_current_view: modo bases ---------- */
  {
    const plugin = await makeServer();
    const baseFile = new TFile("Tablero.base");
    plugin.app.files.set("Tablero.base", baseFile);
    plugin.app.workspace.activeLeaf = {
      view: { file: baseFile, controller: { getViewName: () => "Tablero" } },
      getViewState: () => ({ type: "bases", state: { file: "Tablero.base", viewName: "Tablero" } })
    };
    const rec = {
      path: "Tablero.base",
      parsed: {
        views: [{ type: "kanban-view", name: "Tablero", groupByProperty: "note.m_estatus" }],
        properties: { "note.m_estatus": { displayName: "Estado" }, "note.Origen": { displayName: "Origen" } },
        formulas: {}
      },
      paths: ["Reviews/A.md", "Reviews/B.md"]
    };
    context.__BLG_BASES._setRecord("Tablero.base", rec);
    const r = await call(plugin, "blg_get_current_view", {});
    assert.equal(r.mode, "bases");
    assert.equal(r.base.path, "Tablero.base");
    assert.equal(r.base.views[0].type, "kanban-view");
    assert.equal(r.base.groupByProperty, "m_estatus");
    assert.ok(r.message.includes("blg_get_current_base"));
  }

  /* ---------- get_current_base: lee columnas y tarjetas ---------- */
  {
    const plugin = await makeServer();
    const baseFile = new TFile("Tablero.base");
    plugin.app.files.set("Tablero.base", baseFile);
    const noteA = new TFile("Reviews/A.md");
    const noteB = new TFile("Reviews/B.md");
    plugin.app.files.set("Reviews/A.md", noteA);
    plugin.app.files.set("Reviews/B.md", noteB);
    plugin.app.metadataCache.getFileCache = f => f === noteA ? { frontmatter: { m_estatus: "review", Origen: "Web" } } : f === noteB ? { frontmatter: { m_estatus: "aprobado", Origen: "RSS" } } : {};
    plugin.app.workspace.activeLeaf = {
      view: { file: baseFile },
      getViewState: () => ({ type: "bases", state: { file: "Tablero.base", viewName: "Tablero" } })
    };
    const rec = {
      path: "Tablero.base",
      parsed: {
        views: [{ type: "kanban-view", name: "Tablero", groupByProperty: "note.m_estatus" }],
        properties: { "note.m_estatus": {}, "note.Origen": {} },
        formulas: { Origen: "file.name" } /* fórmula calculada, no editable */
      },
      paths: ["Reviews/A.md", "Reviews/B.md"]
    };
    context.__BLG_BASES._setRecord("Tablero.base", rec);
    // subview simulada con entradas
    const subview = {
      type: "kanban-view",
      name: "Tablero",
      groupByPropertyId: "note.m_estatus",
      swimlaneByPropertyId: null,
      data: {
        data: [
          { file: noteA, getValue: pid => pid === "note.m_estatus" ? "review" : "Web" },
          { file: noteB, getValue: pid => pid === "note.m_estatus" ? "aprobado" : "RSS" }
        ]
      }
    };
    plugin.app.workspace.activeLeaf.view._children = [subview];
    const r = await call(plugin, "blg_get_current_base", {});
    assert.equal(r.path, "Tablero.base");
    assert.equal(r.activeView, "Tablero");
    assert.equal(r.groupByProperty, "m_estatus");
    assert.ok(r.columns.length >= 1);
    const reviewCol = r.columns.find(c => c.name === "review");
    assert.ok(reviewCol, "columna review presente");
    assert.equal(reviewCol.count, 1);
    assert.equal(reviewCol.cards[0].path, "Reviews/A.md");
    assert.equal(reviewCol.cards[0].properties.Origen.editable, false, "fórmula no editable");
    assert.equal(reviewCol.cards[0].properties.m_estatus.editable, true);
  }

  /* ---------- update_base_cards: mueve una tarjeta ---------- */
  {
    const plugin = await makeServer();
    const baseFile = new TFile("Tablero.base");
    plugin.app.files.set("Tablero.base", baseFile);
    const note = new TFile("Reviews/A.md");
    plugin.app.files.set("Reviews/A.md", note);
    const fm = { m_estatus: "review", Origen: "Web" };
    plugin.app.metadataCache.getFileCache = () => ({ frontmatter: fm });
    plugin.app.workspace.activeLeaf = {
      view: { file: baseFile },
      getViewState: () => ({ type: "bases", state: { file: "Tablero.base", viewName: "Tablero" } })
    };
    const rec = {
      path: "Tablero.base",
      parsed: {
        views: [{ type: "kanban-view", name: "Tablero", groupByProperty: "note.m_estatus" }],
        properties: { "note.m_estatus": {}, "note.Origen": {} },
        formulas: { Origen: "file.name" }
      },
      paths: ["Reviews/A.md"]
    };
    context.__BLG_BASES._setRecord("Tablero.base", rec);
    const r = await call(plugin, "blg_update_base_cards", {
      cards: [{ path: "Reviews/A.md", properties: { m_estatus: "aprobado", Origen: "Nuevo" } }]
    });
    assert.equal(r.ok, true);
    assert.equal(fm.m_estatus, "aprobado", "propiedad editable actualizada");
    assert.equal(fm.Origen, "Web", "fórmula NO se modifica");
    assert.equal(r.updated[0].skipped[0], "Origen", "fórmula reportada como omitida");
  }

  /* ---------- update_base_cards: eliminar propiedad con null ---------- */
  {
    const plugin = await makeServer();
    const baseFile = new TFile("Tablero.base");
    plugin.app.files.set("Tablero.base", baseFile);
    const note = new TFile("Reviews/A.md");
    plugin.app.files.set("Reviews/A.md", note);
    const fm = { m_estatus: "review", prioridad: 5 };
    plugin.app.metadataCache.getFileCache = () => ({ frontmatter: fm });
    plugin.app.workspace.activeLeaf = {
      view: { file: baseFile },
      getViewState: () => ({ type: "bases", state: { file: "Tablero.base", viewName: "Tablero" } })
    };
    const rec = {
      path: "Tablero.base",
      parsed: {
        views: [{ type: "kanban-view", name: "Tablero", groupByProperty: "note.m_estatus" }],
        properties: { "note.m_estatus": {}, "note.prioridad": {} },
        formulas: {}
      },
      paths: ["Reviews/A.md"]
    };
    context.__BLG_BASES._setRecord("Tablero.base", rec);
    const r = await call(plugin, "blg_update_base_cards", {
      cards: [{ path: "Reviews/A.md", properties: { prioridad: null } }]
    });
    assert.equal(r.ok, true);
    assert.equal("prioridad" in fm, false, "propiedad eliminada");
  }

  /* ---------- errores ---------- */
  {
    const plugin = await makeServer();
    let e1 = null, e2 = null;
    try { await call(plugin, "blg_get_current_base", {}); } catch (e) { e1 = e; }
    try { await call(plugin, "blg_update_base_cards", { cards: [] }); } catch (e) { e2 = e; }
    assert.ok(e1 && e1.code === -32603, "blg_get_current_base debe lanzar -32603");
    assert.ok(e2 && (e2.code === -32602 || e2.code === -32603), "blg_update_base_cards sin cards debe lanzar -32602 o -32603");
  }

  /* ---------- blg_sew con .base: padre base → hija md vía sew.pair ---------- */
  {
    const plugin = await makeServer();
    const base = new TFile("Bases/Tablero.base");
    const nota = new TFile("Notas/A.md");
    plugin.app.files.set(base.path, base);
    plugin.app.files.set(nota.path, nota);
    plugin.app.metadataCache.getFileCache = () => ({ frontmatter: {} });
    const r = await call(plugin, "blg_sew", { parent: "Bases/Tablero.base", children: ["Notas/A.md"] });
    assert.equal(r.ok, true);
    eqJ(context.__BLG_BASES.sew.pairs, [["Bases/Tablero.base", "Notas/A.md"]],
      "pareja mixta enrutada al store compartido, no a processFrontMatter");
  }

  /* ---------- blg_sew md→md sigue por frontmatter (regresión) ---------- */
  {
    const plugin = await makeServer();
    const a = new TFile("Notas/A.md"), b = new TFile("Notas/B.md");
    plugin.app.files.set(a.path, a); plugin.app.files.set(b.path, b);
    const fms = { "Notas/A.md": {}, "Notas/B.md": {} };
    plugin.app.metadataCache.getFileCache = f => ({ frontmatter: fms[f.path] });
    plugin.app.fileManager.processFrontMatter = async (f, fn) => { fn(fms[f.path]); return fms[f.path]; };
    const r = await call(plugin, "blg_sew", { parent: "Notas/A.md", children: ["Notas/B.md"] });
    assert.equal(r.ok, true);
    eqJ(fms["Notas/A.md"].sewing, ["[[B]]"], "padre md: fm sewing");
    eqJ(fms["Notas/B.md"].tags, ["a/sewing/b"], "hija md: tag");
    assert.equal(context.__BLG_BASES.sew.pairs.length, 0, "md→md no toca el store");
  }

  /* ---------- resolveFile: .base por ruta sin extensión y por basename ---------- */
  {
    const plugin = await makeServer();
    const base = new TFile("Bases/Tablero.base");
    plugin.app.files.set(base.path, base);
    plugin.app.metadataCache.getFileCache = () => ({});
    const r = await call(plugin, "blg_get_note", { note: "Bases/Tablero" });
    assert.equal(r.path, "Bases/Tablero.base", "resuelve añadiendo .base");
    assert.equal(r.isBase, true);
    const r2 = await call(plugin, "blg_get_note", { note: "Tablero" });
    assert.equal(r2.path, "Bases/Tablero.base", "resuelve por basename");
  }

  /* ---------- blg_get_note en .base: tags de costura + baseResults ---------- */
  {
    const plugin = await makeServer();
    const base = new TFile("Bases/Tablero.base");
    const nota = new TFile("Reviews/A.md");
    plugin.app.files.set(base.path, base);
    plugin.app.files.set(nota.path, nota);
    plugin.app.metadataCache.getFileCache = () => ({});
    context.__BLG_BASES._setRecord("Bases/Tablero.base", { path: "Bases/Tablero.base", parsed: { views: [], properties: {}, formulas: {} }, paths: ["Reviews/A.md"] });
    context.__BLG_BASES.sew.tagsMap.set("Bases/Tablero.base", ["padre/sewing/tablero"]);
    context.__BLG_BASES.sew.targetsMap.set("Bases/Tablero.base", new Set(["Reviews/A.md"]));
    const r = await call(plugin, "blg_get_note", { note: "Bases/Tablero.base" });
    assert.equal(r.isBase, true);
    eqJ(r.tags, ["padre/sewing/tablero"], "tags de costura del JSON");
    eqJ(r.sewing, ["Reviews/A.md"], "costuras salientes del store");
    eqJ(r.baseResults, ["Reviews/A.md"], "resultados de la consulta");
    eqJ(r.frontmatter, {}, "sin frontmatter en .base");
  }

  /* ---------- blg_search_notes incluye .base con ext ---------- */
  {
    const plugin = await makeServer();
    plugin.app.files.set("Notas/Tablero viejo.md", new TFile("Notas/Tablero viejo.md"));
    plugin.app.files.set("Bases/Tablero.base", new TFile("Bases/Tablero.base"));
    plugin.app.metadataCache.getFileCache = () => ({});
    const r = await call(plugin, "blg_search_notes", { query: "tablero" });
    assert.equal(r.count, 2);
    const exts = r.results.map(x => x.ext).sort();
    eqJ(exts, ["base", "md"], "devuelve ambos tipos con ext");
  }

  /* ---------- blg_get_active_note_relations con .base activa ---------- */
  {
    const plugin = await makeServer();
    const base = new TFile("Bases/Tablero.base");
    const nota = new TFile("Reviews/A.md");
    plugin.app.files.set(base.path, base);
    plugin.app.files.set(nota.path, nota);
    plugin.app.metadataCache.getFileCache = () => ({});
    plugin.app.metadataCache.resolvedLinks = {};
    plugin.app.workspace.getActiveViewOfType = () => null;
    plugin.app.workspace.getActiveFile = () => base;
    context.__BLG_BASES._setRecord("Bases/Tablero.base", { path: "Bases/Tablero.base", parsed: { views: [], properties: {}, formulas: {} }, paths: ["Reviews/A.md"] });
    context.__BLG_BASES.sew.targetsMap.set("Bases/Tablero.base", new Set(["Reviews/A.md"]));
    const r = await call(plugin, "blg_get_active_note_relations", {});
    assert.equal(r.active.path, "Bases/Tablero.base");
    assert.equal(r.active.isBase, true);
    const edge = r.outgoing.find(e => e.path === "Reviews/A.md");
    assert.ok(edge, "arista a la nota presente");
    assert.equal(edge.kind, "sewing", "la costura tiene prioridad sobre base-query");
    assert.equal(edge.sewn, true);
  }

  console.log("test-mcp-bases: all checks passed");
})().catch(e => { console.error(e); process.exit(1); });
