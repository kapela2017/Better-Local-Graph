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
for (const marker of [".blg-pin-card.is-base", ".blg-pinboard-edge.is-base", "--blg-pin-base-color"])
  assert.ok(styles.includes(marker), marker);

console.log("test-bases OK");
