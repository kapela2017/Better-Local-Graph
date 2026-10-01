/* Node-only contract checks for blg-bases.js. No vault writes. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

class TFolder { constructor(pathname) { this.path = pathname; } }
class TFile {
  constructor(pathname, parent, ext) {
    this.path = pathname; this.parent = parent || new TFolder(path.dirname(pathname) === "." ? "" : path.posix.dirname(pathname));
    this.name = path.posix.basename(pathname);
    this.extension = ext || (this.name.match(/\.([^.]+)$/) || [null, "md"])[1];
    this.basename = this.name.replace(/\.[^.]+$/, "");
    this.stat = { ctime: 1, mtime: 2, size: 3 };
  }
}
const obsidian = { TFile, TFolder, Notice: class { constructor() {} } };
const source = fs.readFileSync(path.join(__dirname, "blg-bases.js"), "utf8");
const context = { module: { exports: { default: class { onload() {} onunload() {} } } },
  PLUGIN_PROTO: { onload() {}, onunload() {} },
  require(name) { if (name === "obsidian") return obsidian; return require(name); },
  console, globalThis: null };
context.globalThis = context;
vm.runInNewContext(source, context, { filename: "blg-bases.js" });
const api = context.__BLG_BASES_TEST;
assert.ok(api && api.parseYaml && api.compileFilters && api.computeResults);

/* los valores mutados dentro del vm son de otro realm: comparar por JSON */
const eqJ = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);

const mitsumeru = `filters:
  and:
    - file.inFolder("Reviews")
    - not:
        - file.inFolder("Reviews/Papelera")
    - m_estatus != "aplicado"
    - m_estatus != "eliminado"
properties:
  m_estatus:
    displayName: Estado
views:
  - type: kanban-view
    name: Tablero
`;
const base = api.parseBase(mitsumeru);
assert.deepEqual(base.filters.and.length, 4);
assert.equal(base.views[0].name, "Tablero");

const files = [
  new TFile("Reviews/Keep.md"), new TFile("Reviews/Aplicado.md"),
  new TFile("Reviews/Papelera/Trash.md"), new TFile("Otros/No.md")
];
const fm = {
  "Reviews/Keep.md": { m_estatus: "review" },
  "Reviews/Aplicado.md": { m_estatus: "aplicado" },
  "Reviews/Papelera/Trash.md": { m_estatus: "review" },
  "Otros/No.md": { m_estatus: "review" }
};
const app = {
  vault: {
    getMarkdownFiles: () => files,
    getAbstractFileByPath: p => files.find(f => f.path === p) || null
  },
  metadataCache: {
    resolvedLinks: {},
    getFileCache: f => ({ frontmatter: fm[f.path] || {}, tags: [] }),
    getFirstLinkpathDest: p => files.find(f => f.path === p || f.basename === p) || null,
    isUserIgnored: () => false
  }
};
assert.deepEqual(api.computeResults(app, base), ["Reviews/Keep.md"]);

/* filtros por vista: Mitsumeru global + una vista con filtro propio */
const withView = api.parseBase(`${mitsumeru}    filters:
      and:
        - Origen == "Web"
`);
assert.deepEqual(api.computeResults(app, withView), []);

/* operadores y llamadas clave */
const exprCases = [
  ['file.inFolder("Reviews")', "Reviews/Keep.md", true],
  ['file.inFolder("Reviews")', "Otros/No.md", false],
  ['m_estatus != "aplicado"', "Reviews/Keep.md", true],
  ['m_estatus == "review"', "Reviews/Keep.md", true],
  ['file.hasTag("x")', "Reviews/Keep.md", false],
  ['file.name.startsWith("Keep")', "Reviews/Keep.md", true],
  ['file.path.endsWith(".md")', "Reviews/Keep.md", true],
  ['m_estatus.contains("rev")', "Reviews/Keep.md", true]
];
for (const [expr, p, want] of exprCases) {
  const parsed = { filters: { and: [expr] }, views: [], formulas: {} };
  assert.deepEqual(api.computeResults(app, parsed).includes(p), want, expr);
}

/* YAML roundtrip mínimo para lectura/escritura estable */
const dumped = api.stringifyYaml(base);
const reparsed = api.parseBase(dumped);
assert.deepEqual(reparsed.filters, base.filters);
assert.equal(reparsed.views[0].name, "Tablero");

/* Integración bundle: local/tag/pizarra reconocen nodos base y el estilo
   database/color violeta por defecto queda cableado. */
const bundle = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");
for (const marker of [
  'a.extension==="md"||a.extension==="base"',
  'let _baseRel=new Map',
  'classes:(w?`${b} has-icon`:b)+(_isBase?" base-node":"")',
  'classes:"dir base-edge"',
  'BB.color(st)',
  'classes:_bi?"tagnode base-node has-icon":"tagnode base-node"',
  '"tagedge base-edge"',
  'selector:"node.base-node"',
  'selector:"edge.base-edge"',
  'baseNodeColor||"#8b5cf6"',
  'baseNodeColor:"#8b5cf6"',
  'n_baseNodeColor:"Color de nodos .base"',
  'n_baseNodeColor:".base node color"',
  'this.plugin.settings.baseNodeColor=o',
  'setValue(this.plugin.settings.baseNodeColor||"#8b5cf6")'
]) assert.ok(bundle.includes(marker), marker);
/* el icono por defecto es database y respeta el color personalizable */
assert.ok(source.includes('_blgFmIcon("database"'), "icono database por defecto");
assert.equal(api.baseColor({}), "#8b5cf6");
assert.equal(api.baseColor({ baseNodeColor: "#ff0000" }), "#ff0000");
const styles = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
for (const marker of [".blg-pin-card.is-base", ".blg-pinboard-edge.is-base", "--blg-pin-base-color",
  ".blg-bases-chip", ".blg-bases-chip-x"])
  assert.ok(styles.includes(marker), marker);

/* ---------- visibilidad: ajuste basesMode none/all/custom ---------- */
assert.equal(api.basesModeOf({}), "none", "modo por defecto = none");
assert.equal(api.basesModeOf({ basesMode: "all" }), "all");
assert.equal(api.basesModeOf({ basesMode: "custom" }), "custom");
assert.equal(api.basesModeOf({ basesMode: "rarito" }), "none", "modo desconocido cae a none");
{
  const mk = settings => ({ settings });
  assert.equal(api.isVisibleBase(mk({ basesMode: "none" }), "Bases/A.base"), false, "none oculta todo");
  assert.equal(api.isVisibleBase(mk({ basesMode: "all" }), "Bases/A.base"), true, "all muestra todo");
  assert.equal(api.isVisibleBase(mk({ basesMode: "custom", basesCustom: ["Bases/A.base"] }), "Bases/A.base"), true);
  assert.equal(api.isVisibleBase(mk({ basesMode: "custom", basesCustom: ["Bases/A.base"] }), "Bases/B.base"), false);
  assert.equal(api.isVisibleBase(mk({ basesMode: "custom" }), "Bases/A.base"), false, "custom sin lista = ninguna");
}

/* ---------- costuras .md ↔ .base (sewing-bases.json) ---------- */
function makeSewPlugin() {
  const fms = {};   // path -> frontmatter vivo (lo que fileManager muta)
  const disk = {};  // adapter: ruta -> texto
  const files = new Map();
  const plugin = {
    _blgBases: { cache: new Map(), version: 0 },
    manifest: { dir: ".obsidian/plugins/better-local-graph" },
    settings: {},
    app: {
      vault: {
        getAbstractFileByPath: p => files.get(p) || null,
        adapter: {
          exists: async p => p in disk,
          read: async p => disk[p],
          write: async (p, c) => { disk[p] = c; }
        }
      },
      fileManager: {
        processFrontMatter: async (file, fn) => { const fm = fms[file.path] = fms[file.path] || {}; fn(fm); return fm; }
      },
      metadataCache: {
        getFileCache: f => ({ frontmatter: fms[f.path] || {} }),
        getFirstLinkpathDest: (lt, from) => files.get(lt) || null
      }
    },
    _files: files, _fms: fms, _disk: disk
  };
  return plugin;
}
const SEW_PATH = ".obsidian/plugins/better-local-graph/" + api.SEW_JSON;

(async () => {
  /* md padre → base hija: frontmatter con [[ruta.base]], tag en JSON */
  {
    const plugin = makeSewPlugin();
    api._setPluginInstance(plugin);
    const padre = new TFile("Notas/Padre.md");
    const hija = new TFile("Bases/Hija.base");
    plugin._files.set(padre.path, padre); plugin._files.set(hija.path, hija);
    await api.sewPair(plugin, padre, hija);
    eqJ(plugin._fms["Notas/Padre.md"].sewing, ["[[Bases/Hija.base]]"], "ref de ruta completa en fm");
    const data = JSON.parse(plugin._disk[SEW_PATH]);
    eqJ(data.bases["Bases/Hija.base"].tags, ["padre/sewing/hija"], "tag de costura en JSON");
    eqJ(data.bases["Bases/Hija.base"].sewing, [], "hija sin salientes");
    /* idempotente */
    await api.sewPair(plugin, padre, hija);
    eqJ(plugin._fms["Notas/Padre.md"].sewing, ["[[Bases/Hija.base]]"], "sin duplicados");
  }
  /* base padre → md hija: sewing en JSON, tag en frontmatter */
  {
    const plugin = makeSewPlugin();
    api._setPluginInstance(plugin);
    const padre = new TFile("Bases/Tablero.base");
    const hija = new TFile("Notas/Niña.md");
    plugin._files.set(padre.path, padre); plugin._files.set(hija.path, hija);
    await api.sewPair(plugin, padre, hija);
    const data = JSON.parse(plugin._disk[SEW_PATH]);
    eqJ(data.bases["Bases/Tablero.base"].sewing, ["Notas/Niña.md"], "hija por ruta en JSON");
    eqJ(plugin._fms["Notas/Niña.md"].tags, ["tablero/sewing/nina"], "tag en fm de la nota");
    /* targets resueltos desde la .base */
    const tg = api.sewTargetsOf(plugin.app, padre);
    assert.ok(tg.has("Notas/Niña.md"), "targets de la base resuelven a la nota");
    assert.equal(api.sewTagsOf(plugin.app, padre).length, 0, "padre sin tags");
  }
  /* base → base y sesión mixta */
  {
    const plugin = makeSewPlugin();
    api._setPluginInstance(plugin);
    const a = new TFile("Bases/A.base"), b = new TFile("Bases/B.base"), n = new TFile("Notas/N.md");
    plugin._files.set(a.path, a); plugin._files.set(b.path, b); plugin._files.set(n.path, n);
    await api.sewPair(plugin, a, b);
    let data = JSON.parse(plugin._disk[SEW_PATH]);
    eqJ(data.bases["Bases/A.base"].sewing, ["Bases/B.base"]);
    eqJ(data.bases["Bases/B.base"].tags, ["a/sewing/b"]);
    /* sesión: padre md con hijos md + base en una pasada */
    const padre = new TFile("Notas/P.md");
    plugin._files.set(padre.path, padre);
    await api.sewApplySession(plugin, padre, [{ path: n.path, name: n.basename }, { path: b.path, name: b.basename }]);
    eqJ(plugin._fms["Notas/P.md"].sewing, ["[[N]]", "[[Bases/B.base]]"], "sesión mixta en fm");
    data = JSON.parse(plugin._disk[SEW_PATH]);
    assert.ok(data.bases["Bases/B.base"].tags.includes("p/sewing/b"), "tag de sesión en JSON");
  }
  /* rename: migra clave y referencias; delete: limpia */
  {
    const plugin = makeSewPlugin();
    api._setPluginInstance(plugin);
    const a = new TFile("Bases/A.base"), b = new TFile("Bases/B.base");
    plugin._files.set(a.path, a); plugin._files.set(b.path, b);
    await api.sewPair(plugin, a, b);
    const aNew = new TFile("Bases/Z.base");
    plugin._files.set(aNew.path, aNew);
    await api.sewRename(plugin, aNew, "Bases/A.base");
    let data = JSON.parse(plugin._disk[SEW_PATH]);
    assert.ok(!data.bases["Bases/A.base"] && data.bases["Bases/Z.base"], "clave migrada");
    eqJ(data.bases["Bases/Z.base"].sewing, ["Bases/B.base"], "referencias intactas");
    /* rename de una hija referenciada */
    const bNew = new TFile("Bases/B2.base");
    await api.sewRename(plugin, bNew, "Bases/B.base");
    data = JSON.parse(plugin._disk[SEW_PATH]);
    eqJ(data.bases["Bases/Z.base"].sewing, ["Bases/B2.base"], "ref de hija migrada");
    assert.ok(data.bases["Bases/B2.base"].tags.includes("a/sewing/b"), "tags migran con la clave");
    /* delete */
    await api.sewDeletePath(plugin, "Bases/B2.base");
    data = JSON.parse(plugin._disk[SEW_PATH]);
    assert.ok(!data.bases["Bases/B2.base"], "entrada eliminada");
    eqJ(data.bases["Bases/Z.base"].sewing, [], "referencia huérfana limpiada");
  }
  console.log("test-bases sewing OK");
})().catch(e => { console.error(e); process.exit(1); });

/* ---------- marcadores del bundle: costura .base y ajuste de visibilidad ---------- */
for (const marker of [
  'basesMode:"none",basesCustom:[]',
  'n_basesMode:"BLG detecta .base?"',
  'n_basesMode:"BLG detects .base?"',
  'BlgBasePick=class extends Oe.FuzzySuggestModal',
  '_blgBasesViewsRefresh',
  'if(_sew&&(r.extension!=="md"||a.extension!=="md")){await _sew.pair(this,r,a)}',
  'if(_sew){await _sew.applySession(this,a,r.children)}',
  'BB.visible?BB.visible(this.plugin):BB.files(this.plugin)',
  'pf.extension==="base"){let _t=BB&&BB.sew?BB.sew.targets(this.app,pf):new Set',
  'if(BB&&BB.sew){for(var _bp2 of _baseResults.keys())',
  'blg-bases-chip-x',
  'openMarkdownToSew:"Abre una nota Markdown o una .base para coserla."',
  /* bases como gen1 terminal en vista local: solo relación directa con la central,
     sin expandir ni dibujar aristas base↔otros nodos */
  'if((g.endsWith(".base")||p.endsWith(".base"))&&g!==r.path&&p!==r.path)return',
  'let _cs2=this.plugin._sewingTargets?this.plugin._sewingTargets(r):new Set,_co=a[r.path]||{}',
  'if(!r.path.endsWith(".base")){for(let p of Object.keys(a[r.path]||{})){if(p.endsWith(".base")&&f.has(p))d(r.path,p)}}',
  '"dir base-edge"+(_sw(g,p)||_sw(p,g)?" sewing":"")',
  /* excepción: bases cosidas con la central siempre visibles en vista local */
  'if(!_vis&&!_sewn)continue',
  '_sewn=_cs2.has(_bp)||_sewIn'
]) assert.ok(bundle.includes(marker), "bundle: " + marker);

/* ---------- paridad módulos standalone ↔ embebidos en main.js ---------- */
/* los standalone pueden tener CRLF (Windows); main.js embebe en LF: normalizar */
const lf = s => s.replace(/\r\n/g, "\n");
function embeddedSlice(fname, nextFname) {
  const txt = lf(fs.readFileSync(path.join(__dirname, fname), "utf8"));
  const lines = txt.split("\n");
  const mark = lines[0] + "\n" + lines[1];
  const a = bundle.indexOf(mark);
  assert.ok(a >= 0, "banner no encontrado: " + fname);
  let b;
  if (nextFname) {
    const ntxt = lf(fs.readFileSync(path.join(__dirname, nextFname), "utf8"));
    const nlines = ntxt.split("\n");
    const nmark = nlines[0] + "\n" + nlines[1];
    b = bundle.indexOf(nmark, a);
    assert.ok(b >= 0, "banner siguiente no encontrado: " + nextFname);
  } else {
    b = bundle.length;
  }
  return { embedded: bundle.slice(a, b).replace(/\s+$/, ""), standalone: txt.replace(/\s+$/, "") };
}
for (const [f, next] of [
  ["blg-mcp-server.js", "blg-backgrounds.js"],
  ["blg-bases.js", "blg-pin-board.js"],
  ["blg-pin-board.js", "blg-folder-drops.js"],
  ["blg-folder-drops.js", null]
]) {
  const { embedded, standalone } = embeddedSlice(f, next);
  assert.equal(embedded, standalone, "paridad rota: " + f + " (re-embeber en main.js)");
}

console.log("test-bases OK");
