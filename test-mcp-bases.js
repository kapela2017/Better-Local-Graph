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
  return {
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
    _setRecord: (path, rec) => records.set(path, rec)
  };
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

  console.log("test-mcp-bases: all checks passed");
})().catch(e => { console.error(e); process.exit(1); });
