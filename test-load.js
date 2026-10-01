/* Smoke test de carga: evalúa main.js COMPLETO como haría Obsidian al cargar
   el plugin. Captura regresiones de load-time (p. ej. un módulo inyectado que
   use PLUGIN_PROTO sin declarar su guard). No escribe nada. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function AnyClass() { return class { constructor() {} }; }
const obsidian = new Proxy({}, {
  get: (t, k) => {
    if (k === "parseYaml") return () => ({});
    if (k === "moment") return () => ({});
    if (k === "Platform") return { isDesktopApp: true, isMobile: false };
    return AnyClass();
  }
});
const ctx = {
  module: { exports: {} }, exports: {},
  require: (n) => n === "obsidian" ? obsidian : (n === "http" ? {} : require(n)),
  console, setTimeout, clearTimeout, setInterval, clearInterval, Promise,
  Map, Set, WeakMap, JSON, Math, Date, RegExp, Error, Array, Object, String,
  Number, Boolean, Symbol, globalThis: null, window: {},
  document: { createElement: () => ({ style: {}, getContext: () => null }), body: { querySelectorAll: () => [] } },
  navigator: {}, requestAnimationFrame: () => 0, cancelAnimationFrame: () => {}
};
ctx.globalThis = ctx;
ctx.module.exports = { default: AnyClass() };
ctx.exports = ctx.module.exports;

const bundle = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");
assert.doesNotThrow(() => vm.runInNewContext(bundle, ctx, { filename: "main.js" }), "main.js debe cargar sin errores");

/* Guard explícito: cada módulo inyectado que referencia PLUGIN_PROTO debe
   declararlo en su propio IIFE. */
const marker = "/* ============================================================\n   Better Local Graph — ";
let pos = 0, mods = 0;
for (;;) {
  pos = bundle.indexOf(marker, pos);
  if (pos < 0) break;
  const next = bundle.indexOf(marker, pos + marker.length);
  const body = bundle.slice(pos, next < 0 ? bundle.length : next);
  mods++;
  if (body.includes("PLUGIN_PROTO.")) {
    const decl = body.indexOf("var PLUGIN_PROTO");
    const firstUse = body.indexOf("PLUGIN_PROTO.onload");
    assert.ok(decl >= 0 && (firstUse < 0 || decl < firstUse), "módulo inyectado sin guard PLUGIN_PROTO: " + body.slice(0, 120));
  }
  pos = pos + marker.length;
}
assert.ok(mods >= 4, "se esperaban los módulos inyectados");
console.log("test-load: main.js carga OK con " + mods + " módulos inyectados");
