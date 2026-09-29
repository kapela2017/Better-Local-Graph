/* Node-only contract checks for the MCP pin-board tool (blg_pin_board) and the
   pinboard mode of blg_get_current_view. Loads blg-mcp-server.js in a vm with
   stubbed obsidian/http (no real socket) and a fake __BLG_PINBOARD API. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

class TFile {
  constructor(pathname) {
    this.path = pathname;
    this.name = pathname.split("/").pop();
    this.basename = this.name.replace(/\.md$/i, "");
    this.extension = "md";
  }
}
const obsidian = { TFile, Notice: class { constructor() {} } };
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
  return {
    files,
    vault: {
      getAbstractFileByPath: p => files.get(p) || null,
      getMarkdownFiles: () => Array.from(files.values())
    },
    metadataCache: {
      getFileCache: () => null,
      getFirstLinkpathDest: () => null,
      resolvedLinks: {}
    },
    workspace: {}
  };
}
/* API de pizarra falsa con la misma forma que __BLG_PINBOARD. */
function fakePinApi(plugin) {
  return {
    isPinned: (pl, p) => !!pl.settings.pinBoard.cards[p],
    pin: (pl, f) => { pl.settings.pinBoard.cards[f.path] = { x: 0, y: 0, z: 1 }; },
    unpin: (pl, p) => { delete pl.settings.pinBoard.cards[p]; },
    boardState: pl => ({
      active: false,
      pinnedCount: Object.keys(pl.settings.pinBoard.cards).length,
      camera: null, boardColor: null, selected: [],
      cards: Object.keys(pl.settings.pinBoard.cards).map(p => ({ path: p })),
      edges: []
    }),
    openBoard: async () => true,
    closeBoard: () => true,
    focusCard: (pl, p) => !!pl.settings.pinBoard.cards[p],
    fitBoard: () => true
  };
}

async function makeServer() {
  const plugin = new FakePlugin();
  plugin.settings = { mcpEnabled: true, mcpToken: "t", mcpPort: 0, pinBoard: { version: 1, cards: {}, edgeStyles: {} } };
  plugin.app = makeApp();
  context.__BLG_PINBOARD = fakePinApi(plugin);
  await plugin.onload();
  assert.ok(plugin._blgMcp, "servidor MCP creado en onload");
  return plugin;
}
const call = (plugin, name, args) => plugin._blgMcp.tools[name].handler(args);
/* Los resultados vienen del realm vm: comparar serializados, no por prototipo. */
const eqJ = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);

(async () => {
  /* ---------- tools/list expone la herramienta con su esquema ---------- */
  {
    const plugin = await makeServer();
    const reply = await plugin._blgMcp._dispatch({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const names = reply.result.tools.map(t => t.name);
    assert.ok(names.includes("blg_pin_board"), "blg_pin_board listada");
    const t = reply.result.tools.find(t => t.name === "blg_pin_board");
    /* Los objetos vienen del realm vm: comparar serializados, no por prototipo. */
    assert.equal(JSON.stringify(t.inputSchema.required), JSON.stringify(["action"]));
    assert.equal(JSON.stringify(t.inputSchema.properties.action.enum), JSON.stringify(["get", "open", "close", "pin", "unpin", "focus", "fit"]));
  }

  /* ---------- get_current_view: modo pinboard ---------- */
  {
    const plugin = await makeServer();
    plugin.settings.pinBoard.cards = { "docs/A.md": { x: 0, y: 0, z: 1 }, "docs/B.md": { x: 5, y: 5, z: 2 } };
    plugin.app.files.set("docs/A.md", new TFile("docs/A.md"));
    plugin.app.files.set("docs/B.md", new TFile("docs/B.md"));
    plugin._blgPin = { attached: { active: () => true, selected: () => ["docs/B.md"] } };
    const r = await call(plugin, "blg_get_current_view", {});
    assert.equal(r.mode, "pinboard");
    assert.equal(r.pinnedCount, 2);
    assert.equal(r.selectionCount, 1);
    assert.equal(r.selectedNotes[0].basename, "B");
    assert.ok(r.message.includes("blg_pin_board"));
    // con la pizarra inactiva no se cuela: cae al modo normal (unknown sin vista)
    plugin._blgPin = { attached: { active: () => false, selected: () => [] } };
    const r2 = await call(plugin, "blg_get_current_view", {});
    assert.equal(r2.mode, "unknown");
  }

  /* ---------- pin: resuelve, no duplica, reporta ambiguos sin elegir ---------- */
  {
    const plugin = await makeServer();
    plugin.app.files.set("docs/A.md", new TFile("docs/A.md"));
    plugin.app.files.set("x/Duplicada.md", new TFile("x/Duplicada.md"));
    plugin.app.files.set("y/Duplicada.md", new TFile("y/Duplicada.md"));
    const r = await call(plugin, "blg_pin_board", { action: "pin", notes: ["A", "docs/A.md", "Fantasma", "Duplicada"] });
    assert.equal(r.ok, false);
    eqJ(r.pinned, ["docs/A.md"], "basename único resuelve; la ruta exacta ya pineada no duplica");
    eqJ(r.alreadyPinned, ["docs/A.md"]);
    eqJ(r.notFound, ["Fantasma"]);
    assert.equal(r.ambiguous.length, 1);
    eqJ(r.ambiguous[0].candidates.sort(), ["x/Duplicada.md", "y/Duplicada.md"]);
    assert.equal(r.pinnedCount, 1, "el ambiguo NO se fija");
    assert.equal(Object.keys(plugin.settings.pinBoard.cards).length, 1);
  }

  /* ---------- unpin: idempotente y sirve con la nota ya borrada ---------- */
  {
    const plugin = await makeServer();
    const a = new TFile("docs/A.md");
    plugin.app.files.set("docs/A.md", a);
    plugin.settings.pinBoard.cards["docs/A.md"] = { x: 0, y: 0, z: 1 };
    plugin.app.files.delete("docs/A.md"); // la nota ya no existe
    const r = await call(plugin, "blg_pin_board", { action: "unpin", notes: ["A", "Nada"] });
    assert.equal(r.ok, false);
    eqJ(r.unpinned, ["docs/A.md"], "desfija por basename aunque la nota no exista");
    eqJ(r.notPinned, []);
    eqJ(r.notFound, ["Nada"]);
    assert.equal(r.pinnedCount, 0);
    const r2 = await call(plugin, "blg_pin_board", { action: "unpin", notes: ["docs/A.md"] });
    eqJ(r2.notFound, ["docs/A.md"], "idempotente: ya no está ni pineada ni existe");
  }

  /* ---------- focus / fit / open / close ---------- */
  {
    const plugin = await makeServer();
    plugin.app.files.set("docs/A.md", new TFile("docs/A.md"));
    plugin.settings.pinBoard.cards["docs/A.md"] = { x: 0, y: 0, z: 1 };
    eqJ(await call(plugin, "blg_pin_board", { action: "open" }), { ok: true, active: true, pinnedCount: 1 });
    eqJ(await call(plugin, "blg_pin_board", { action: "focus", notes: ["A"] }), { ok: true, focused: "docs/A.md" });
    eqJ(await call(plugin, "blg_pin_board", { action: "fit" }), { ok: true });
    eqJ(await call(plugin, "blg_pin_board", { action: "close" }), { ok: true, active: false });
    await assert.rejects(() => call(plugin, "blg_pin_board", { action: "focus", notes: ["B"] }),
      e => e.code === -32602 && /ninguna tarjeta pineada/.test(e.message));
  }

  /* ---------- errores de validación ---------- */
  {
    const plugin = await makeServer();
    await assert.rejects(() => call(plugin, "blg_pin_board", { action: "pin" }), e => e.code === -32602);
    await assert.rejects(() => call(plugin, "blg_pin_board", { action: "unpin" }), e => e.code === -32602);
    await assert.rejects(() => call(plugin, "blg_pin_board", { action: "focus" }), e => e.code === -32602);
    await assert.rejects(() => call(plugin, "blg_pin_board", { action: "borrar-todo" }), e => e.code === -32602 && /action desconocida/.test(e.message));
    await assert.rejects(() => call(plugin, "blg_pin_board", {}), e => e.code === -32602);
  }

  /* ---------- sin módulo de pizarra: error claro ---------- */
  {
    const plugin = await makeServer();
    context.__BLG_PINBOARD = null;
    await assert.rejects(() => call(plugin, "blg_pin_board", { action: "get" }),
      e => e.code === -32603 && /pizarra no está disponible/.test(e.message));
  }

  console.log("test-mcp-pinboard: all checks passed");
})().catch(e => { console.error(e); process.exit(1); });
