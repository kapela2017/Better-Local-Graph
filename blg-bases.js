/* ============================================================
   Better Local Graph — Nodos de consultas .base
   ------------------------------------------------------------
   Lee archivos Obsidian Bases (.base), combina sus filtros
   globales con los de TODAS sus vistas y ofrece a las vistas
   local/tag/pizarra un conjunto de resultados por base.

   El parser/evaluador cubre el lenguaje visible en `.base`:
   - and / or / not anidados;
   - comparaciones ==, !=, >, >=, <, <=;
   - llamadas habituales de file/note (inFolder, hasTag,
     contains*, startsWith, endsWith, isEmpty, hasProperty,
     hasLink, matches, linksto);
   - literales string/number/bool/null, listas y `this`.

   Todo lo puro queda expuesto en globalThis.__BLG_BASES_TEST
   para probar el contrato desde Node sin tocar el vault.
   ============================================================ */
(function () {
  "use strict";
  var PLUGIN_PROTO;
  try { PLUGIN_PROTO = module.exports && module.exports.default && module.exports.default.prototype; } catch (_) { return; }
  if (!PLUGIN_PROTO) { try { console.warn("[BLG bases] no se encontró el prototipo del plugin"); } catch (_) {} return; }
  var Oe;
  try { Oe = require("obsidian"); } catch (_) { return; } // móvil

  var pluginInstance = null;

  function warn(e) { try { console.warn("[BLG bases]", e && e.message || e); } catch (_) {} }
  function normPath(p) { return String(p || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""); }
  function baseColor(settings) { return (settings && settings.baseNodeColor) || "#8b5cf6"; }

  /* ---------- YAML propio: parseo/serialización acotado a .base ---------- */

  function splitKey(line) {
    for (var i = 0, depth = 0, quote = null; i < line.length; i++) {
      var c = line[i];
      if (quote) { if (c === "\\") i++; else if (c === quote) quote = null; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === "[" || c === "{") depth++;
      else if (c === "]" || c === "}") depth--;
      else if (c === ":" && !depth) return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    }
    return [line.trim(), ""];
  }
  function unquote(s) {
    s = String(s == null ? "" : s).trim();
    if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') return JSON.parse(s);
    if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") return s.slice(1, -1).replace(/''/g, "'");
    return s;
  }
  function scalar(s) {
    s = String(s == null ? "" : s).trim();
    if (!s) return "";
    if (s[0] === '"' || s[0] === "'") return unquote(s);
    if (s[0] === "[" && s[s.length - 1] === "]") {
      var body = s.slice(1, -1).trim();
      if (!body) return [];
      var out = [], cur = "", quote = null;
      for (var i = 0; i < body.length; i++) {
        var c = body[i];
        if (quote) { cur += c; if (c === "\\" && i + 1 < body.length) cur += body[++i]; else if (c === quote) quote = null; }
        else if (c === '"' || c === "'") { quote = c; cur += c; }
        else if (c === ",") { out.push(scalar(cur)); cur = ""; }
        else cur += c;
      }
      out.push(scalar(cur));
      return out;
    }
    if (/^(?:true|false)$/i.test(s)) return /^t/i.test(s);
    if (/^(?:null|~)$/i.test(s)) return null;
    if (/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(s)) return Number(s);
    return s;
  }
  function indentOf(line) { var m = line.match(/^ */); return m ? m[0].length : 0; }
  function parseBlock(lines, i, indent) {
    var isList = false, outMap = {}, outList = [];
    for (; i < lines.length;) {
      var raw = lines[i];
      if (!raw.trim() || raw.trim().indexOf("#") === 0) { i++; continue; }
      var ind = indentOf(raw);
      if (ind < indent) break;
      if (ind > indent) throw new Error("YAML .base: indentación inesperada en línea " + (i + 1));
      var text = raw.slice(indent);
      if (text.indexOf("- ") === 0 || text === "-") {
        isList = true;
        var rest = text === "-" ? "" : text.slice(2);
        if (!rest) {
          var sub = parseBlock(lines, i + 1, nextIndent(lines, i + 1, indent + 1));
          outList.push(sub.value); i = sub.next;
        } else {
          var kv = splitKey(rest);
          if (kv[0] && rest.indexOf(":") > -1 && !/:$/.test(rest)) {
            var obj = {}; obj[kv[0]] = scalar(kv[1]); i++;
            var objIndent = nextIndent(lines, i, -1);
            if (objIndent > indent) {
              var sub2 = parseBlock(lines, i, objIndent);
              if (sub2.value && typeof sub2.value === "object" && !Array.isArray(sub2.value)) Object.assign(obj, sub2.value);
              else obj[kv[0]] = sub2.value;
              i = sub2.next;
            }
            outList.push(obj);
          } else if (/:$/.test(rest)) {
            var key = rest.slice(0, -1).trim();
            var sub3 = parseBlock(lines, i + 1, nextIndent(lines, i + 1, indent + 1));
            var obj2 = {}; obj2[key] = sub3.value; outList.push(obj2); i = sub3.next;
          } else { outList.push(scalar(rest)); i++; }
        }
      } else {
        if (isList) throw new Error("YAML .base: mezcla de lista y mapa en línea " + (i + 1));
        var p = splitKey(text);
        if (!p[0]) { i++; continue; }
        if (p[1] === "") {
          if (/:$/.test(text) || text === p[0]) {
            var ni = nextIndent(lines, i + 1, -1);
            if (ni > indent) { var sub4 = parseBlock(lines, i + 1, ni); outMap[p[0].replace(/:$/, "")] = sub4.value; i = sub4.next; }
            else { outMap[p[0].replace(/:$/, "")] = null; i++; }
          } else { outMap[p[0]] = null; i++; }
        } else { outMap[p[0].replace(/:$/, "")] = scalar(p[1]); i++; }
      }
    }
    return { value: isList ? outList : outMap, next: i };
  }
  function nextIndent(lines, i, fallback) {
    for (; i < lines.length; i++) {
      var raw = lines[i];
      if (!raw.trim() || raw.trim().indexOf("#") === 0) continue;
      return indentOf(raw);
    }
    return fallback;
  }
  function parseYaml(text) {
    var lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/);
    var parsed = parseBlock(lines, 0, nextIndent(lines, 0, 0));
    return parsed.value;
  }
  function quoteString(v) { return JSON.stringify(String(v)); }
  function dumpValue(v, indent) {
    var pad = " ".repeat(indent);
    if (Array.isArray(v)) {
      if (!v.length) return "[]";
      return "\n" + v.map(function (item) {
        if (item && typeof item === "object") {
          var body = dumpValue(item, indent + 2);
          if (body[0] === "\n") {
            var lines = body.slice(1).split("\n");
            return pad + "- " + lines[0].trim() + (lines.length > 1 ? "\n" + lines.slice(1).join("\n") : "");
          }
          return pad + "- " + body;
        }
        return pad + "- " + formatScalar(item);
      }).join("\n");
    }
    if (v && typeof v === "object") {
      var keys = Object.keys(v);
      if (!keys.length) return "{}";
      return "\n" + keys.map(function (k) {
        var val = dumpValue(v[k], indent + 2);
        return pad + k + ":" + (val[0] === "\n" ? val : " " + val);
      }).join("\n");
    }
    return formatScalar(v);
  }
  function formatScalar(v) {
    if (v == null) return "null";
    if (typeof v === "boolean" || typeof v === "number") return String(v);
    return quoteString(v);
  }
  function stringifyYaml(obj) { return dumpValue(obj || {}, 0).replace(/^\n/, "") + "\n"; }

  /* ---------- modelo .base ---------- */

  function normalizeLogic(obj, op) {
    var out = {};
    out[op] = Array.isArray(obj && obj[op]) ? obj[op] : [];
    return out;
  }
  function normalizeBase(data) {
    data = data && typeof data === "object" ? data : {};
    var views = Array.isArray(data.views) ? data.views.filter(function (v) { return v && typeof v === "object"; }) : [];
    return {
      filters: data.filters && typeof data.filters === "object" ? data.filters : null,
      formulas: data.formulas && typeof data.formulas === "object" ? data.formulas : {},
      properties: data.properties && typeof data.properties === "object" ? data.properties : {},
      views: views
    };
  }
  function parseBase(text) {
    var data = typeof text === "string" ? parseYaml(text) : text;
    var base = normalizeBase(data);
    if (!base.views.length) base.views = [{ type: "table", name: "" }];
    return base;
  }
  function viewFilters(base) {
    var filters = [];
    if (base.filters) filters.push(base.filters);
    (base.views || []).forEach(function (v) { if (v && v.filters && typeof v.filters === "object") filters.push(v.filters); });
    if (!filters.length) return null;
    return filters.length === 1 ? filters[0] : { and: filters };
  }

  /* ---------- fórmulas: lexer, parser y evaluación ---------- */

  var TOKEN_RE = /(?:(\/(?:\\.|[^\/])+\/[a-z]*)|("(?:\\.|[^"])*"|'(?:\\.|[^'])*')|([A-Za-z_$][A-Za-z0-9_$-]*)|(-?\d+(?:\.\d+)?)|(==|!=|>=|<=|&&|\|\||[()\[\],.!><=+\-*%]))/y;
  function lex(src) {
    var out = [], i = 0;
    while (i < src.length) {
      var ws = /\s+/y; ws.lastIndex = i;
      var w = ws.exec(src); if (w) i = ws.lastIndex;
      if (i >= src.length) break;
      TOKEN_RE.lastIndex = i;
      var m = TOKEN_RE.exec(src);
      if (!m) throw new Error("No se pudo leer la fórmula cerca de: " + src.slice(i));
      out.push({ raw: m[0], re: m[1], str: m[2], id: m[3], num: m[4], op: m[5] });
      i = TOKEN_RE.lastIndex;
    }
    return out;
  }
  function parseFormula(src) {
    var toks = lex(String(src || "").trim()), pos = 0;
    function peek() { return toks[pos]; }
    function take(raw) { var t = toks[pos]; if (raw && (!t || t.raw !== raw)) throw new Error("Se esperaba " + raw + " en " + src); pos++; return t; }
    function parseExpr(min) {
      var left = parseUnary();
      for (;;) {
        var t = peek(), op = t && t.op;
        var prec = op === "||" ? 1 : op === "&&" ? 2 : (op === "==" || op === "!=") ? 3 : (op === ">" || op === ">=" || op === "<" || op === "<=") ? 4 : (op === "+" || op === "-") ? 5 : (op === "*" || op === "/" || op === "%") ? 6 : 0;
        if (!prec || prec < min) break;
        take();
        left = { type: "binary", op: op, left: left, right: parseExpr(prec + 1) };
      }
      return left;
    }
    function parseUnary() {
      var t = peek();
      if (t && t.op === "!") { take("!"); return { type: "not", expr: parseUnary() }; }
      if (t && t.op === "-") { take("-"); return { type: "neg", expr: parseUnary() }; }
      return parsePostfix(parsePrimary());
    }
    function parsePostfix(node) {
      for (;;) {
        var t = peek();
        if (t && t.op === ".") {
          take(".");
          var p = take();
          var name = p && (p.id || p.raw);
          if (!name) throw new Error("Se esperaba propiedad en " + src);
          if (peek() && peek().op === "(") node = call(node, name);
          else node = { type: "prop", object: node, name: name };
        } else if (t && t.op === "[") {
          take("["); var idx = parseExpr(1); take("]"); node = { type: "index", object: node, index: idx };
        } else break;
      }
      return node;
    }
    function call(object, name) {
      take("("); var args = [];
      if (!(peek() && peek().op === ")")) do { args.push(parseExpr(1)); } while (peek() && peek().op === "," && (take(","), true));
      take(")");
      return { type: "call", object: object, name: name, args: args };
    }
    function parsePrimary() {
      var t = peek();
      if (!t) throw new Error("Fórmula incompleta: " + src);
      if (t.op === "(") { take("("); var e = parseExpr(1); take(")"); return e; }
      if (t.str) { pos++; return { type: "literal", value: unquote(t.str) }; }
      if (t.re) { pos++; var last = t.re.lastIndexOf("/"); return { type: "regexp", value: new RegExp(t.re.slice(1, last), t.re.slice(last + 1)) }; }
      if (t.num) { pos++; return { type: "literal", value: Number(t.num) }; }
      if (t.id) {
        pos++;
        var id = t.id;
        if (id === "true" || id === "false") return { type: "literal", value: id === "true" };
        if (id === "null") return { type: "literal", value: null };
        return { type: "ident", name: id };
      }
      if (t.op === "[") {
        take("["); var vals = [];
        if (!(peek() && peek().op === "]")) do { vals.push(parseExpr(1)); } while (peek() && peek().op === "," && (take(","), true));
        take("]"); return { type: "list", values: vals };
      }
      throw new Error("Token inesperado " + t.raw + " en " + src);
    }
    var ast = parseExpr(1);
    if (pos !== toks.length) throw new Error("Sobra texto en fórmula: " + src.slice(toks[pos - 1] ? toks[pos - 1].raw.length : 0));
    return ast;
  }

  function lower(v) { return String(v == null ? "" : v).toLowerCase(); }
  function values(v) { return Array.isArray(v) ? v : (v == null || v === "" ? [] : [v]); }
  function flatValues(v) {
    var out = [];
    values(v).forEach(function (x) {
      if (x instanceof Date) out.push(x.toISOString());
      else if (x && typeof x === "object" && x.path) out.push(x.path);
      else if (x && typeof x === "object" && x.value != null) out.push(x.value);
      else out.push(x);
    });
    return out;
  }
  function looseEqual(a, b) {
    if (a == null && (b == null || b === "")) return true;
    if (b == null && (a == null || a === "")) return true;
    if (a instanceof Date || b instanceof Date) {
      var ta = a instanceof Date ? a.getTime() : Date.parse(a), tb = b instanceof Date ? b.getTime() : Date.parse(b);
      return !isNaN(ta) && ta === tb;
    }
    var av = flatValues(a), bv = flatValues(b);
    if (!av.length && !bv.length) return true;
    return av.some(function (x) { return bv.some(function (y) { return String(x) === String(y) || lower(x) === lower(y); }); });
  }
  function cmp(a, b, op) {
    if (op === "==") return looseEqual(a, b);
    if (op === "!=") return !looseEqual(a, b);
    var x = a, y = b;
    if (a instanceof Date || b instanceof Date) { x = a instanceof Date ? a.getTime() : Date.parse(a); y = b instanceof Date ? b.getTime() : Date.parse(b); }
    else if (typeof a !== "number" || typeof b !== "number") { x = lower(a); y = lower(b); }
    return op === ">" ? x > y : op === ">=" ? x >= y : op === "<" ? x < y : x <= y;
  }
  function hasAny(hay, needles, all) {
    var h = flatValues(hay).map(lower), n = flatValues(needles).map(lower);
    if (!n.length) return false;
    var test = function (q) { return h.some(function (x) { return x === q || x.indexOf(q) !== -1; }); };
    return all ? n.every(test) : n.some(test);
  }
  function pathInFolder(path, folder) {
    path = normPath(path); folder = normPath(folder);
    if (!folder || folder === "/" || folder === ".") return true;
    return path === folder || path.indexOf(folder + "/") === 0;
  }
  function linkTarget(app, value, sourcePath) {
    if (!value) return null;
    if (value.path) return value;
    var s = String(value).replace(/^\[\[|\]\]$/g, "").split("|")[0].split("#")[0];
    return app.metadataCache.getFirstLinkpathDest(s, sourcePath || "") || app.vault.getAbstractFileByPath(s);
  }
  function resolveIdent(entry, name) {
    var n = lower(name);
    if (n === "this") return entry.file;
    if (n === "note") return entry.frontmatter;
    if (n === "file") return entry.fileData;
    if (n === "formula") return entry.formulaProxy;
    if (Object.prototype.hasOwnProperty.call(entry.lowerFm, n)) return entry.lowerFm[n];
    return undefined;
  }
  function propOf(value, name, entry) {
    if (value == null) return undefined;
    if (value === entry.fileData) {
      var n = lower(name);
      var map = { file: entry.file, name: entry.file.name, basename: entry.file.basename, fullname: entry.file.basename,
        path: entry.file.path, folder: normPath(entry.folder), ext: entry.file.extension, extension: entry.file.extension,
        ctime: entry.file.stat && entry.file.stat.ctime, mtime: entry.file.stat && entry.file.stat.mtime,
        size: entry.file.stat && entry.file.stat.size, links: entry.links, outlinks: entry.links,
        backlinks: entry.backlinks, embeds: entry.embeds, tags: entry.tags };
      if (Object.prototype.hasOwnProperty.call(map, n)) return map[n];
      if (entry.fileData && Object.prototype.hasOwnProperty.call(entry.fileData, name)) return entry.fileData[name];
      return undefined;
    }
    if (Array.isArray(value) && /^\d+$/.test(name)) return value[Number(name)];
    if (typeof value === "object") {
      if (Object.prototype.hasOwnProperty.call(value, name)) return value[name];
      var low = lower(name);
      for (var k in value) if (Object.prototype.hasOwnProperty.call(value, k) && lower(k) === low) return value[k];
    }
    return undefined;
  }
  function fnName(object, name) { return object && object.type === "ident" ? (object.name + "." + name).toLowerCase() : lower(name); }
  function evalAst(node, entry) {
    var i;
    switch (node.type) {
      case "literal": return node.value;
      case "regexp": return node.value;
      case "ident": return resolveIdent(entry, node.name);
      case "list": return node.values.map(function (v) { return evalAst(v, entry); });
      case "prop": return propOf(evalAst(node.object, entry), node.name, entry);
      case "index": { var arr = evalAst(node.object, entry); return arr && arr[evalAst(node.index, entry)]; }
      case "not": return !truthy(evalAst(node.expr, entry));
      case "neg": { var v = evalAst(node.expr, entry); return typeof v === "number" ? -v : NaN; }
      case "binary": {
        if (node.op === "&&") return truthy(evalAst(node.left, entry)) && truthy(evalAst(node.right, entry));
        if (node.op === "||") return truthy(evalAst(node.left, entry)) || truthy(evalAst(node.right, entry));
        var l = evalAst(node.left, entry), r = evalAst(node.right, entry);
        if (node.op === "+" || node.op === "-" || node.op === "*" || node.op === "/" || node.op === "%") {
          if (typeof l !== "number" || typeof r !== "number") return NaN;
          return node.op === "+" ? l + r : node.op === "-" ? l - r : node.op === "*" ? l * r : node.op === "/" ? l / r : l % r;
        }
        return cmp(l, r, node.op);
      }
      case "call": {
        var root = node.object && node.object.type === "ident" ? lower(node.object.name) : "";
        var name = fnName(node.object, node.name);
        var target = node.object && node.object.type !== "ident" ? evalAst(node.object, entry)
          : (root && root !== "file" && root !== "note" && root !== "this" ? resolveIdent(entry, node.object.name) : undefined);
        var args = node.args.map(function (a) { return evalAst(a, entry); });
        return evalCall(name, target, args, entry);
      }
    }
    return undefined;
  }
  function truthy(v) {
    if (v == null || v === false) return false;
    if (Array.isArray(v)) return v.length > 0;
    return true;
  }
  function evalCall(name, target, args, entry) {
    var app = entry.app;
    var leaf = lower(name).split(".").pop();
    switch (name) {
      case "file.infolder": return pathInFolder(entry.file.path, args[0]);
      case "file.hastag": return hasAny(entry.tags, args[0]);
      case "file.hasproperty": return Object.prototype.hasOwnProperty.call(entry.lowerFm, lower(args[0]));
      case "file.haslink": {
        var dest = linkTarget(app, args[0], entry.file.path);
        return !!(dest && flatValues(entry.links).some(function (p) { return p === dest.path; }));
      }
      case "file.linksto": return evalCall("file.haslink", target, args, entry);
      case "file.inlinks": case "file.inbacklinks": {
        var src = linkTarget(app, args[0], entry.file.path);
        return !!(src && flatValues(entry.backlinks).some(function (p) { return p === src.path; }));
      }
      case "file.matches": { var re = args[0] instanceof RegExp ? args[0] : new RegExp(String(args[0] || "")); return re.test(entry.file.path); }
      case "file.isempty": return !truthy(target);
      case "note.isempty": return !truthy(target);
      case "isempty": return !truthy(target);
      case "contains": return hasAny(target, args[0]);
      case "containsany": return hasAny(target, args[0]);
      case "containsall": return hasAny(target, args[0], true);
      case "startswith": return flatValues(target).some(function (x) { return lower(x).indexOf(lower(args[0])) === 0; });
      case "endswith": return flatValues(target).some(function (x) { var a = lower(x), b = lower(args[0]); return b && a.slice(-b.length) === b; });
      case "matches": { var rr = args[0] instanceof RegExp ? args[0] : new RegExp(String(args[0] || "")); return flatValues(target).some(function (x) { return rr.test(String(x)); }); }
      case "lower": return lower(target);
      case "upper": return String(target == null ? "" : target).toUpperCase();
      case "length": return target == null ? 0 : (Array.isArray(target) || typeof target === "string") ? target.length : 0;
      case "list": return args;
      case "date": { var d = new Date(args[0]); return isNaN(d.getTime()) ? null : d; }
      case "now": return new Date();
      case "today": { var t = new Date(); t.setHours(0, 0, 0, 0); return t; }
      case "format": return String(target == null ? "" : target);
      default:
        if (leaf === "contains") return hasAny(target, args[0]);
        if (leaf === "containsany") return hasAny(target, args[0]);
        if (leaf === "containsall") return hasAny(target, args[0], true);
        if (leaf === "startswith") return flatValues(target).some(function (x) { return lower(x).indexOf(lower(args[0])) === 0; });
        if (leaf === "endswith") return flatValues(target).some(function (x) { var a = lower(x), b = lower(args[0]); return b && a.slice(-b.length) === b; });
        if (leaf === "matches") { var re2 = args[0] instanceof RegExp ? args[0] : new RegExp(String(args[0] || "")); return flatValues(target).some(function (x) { return re2.test(String(x)); }); }
        if (leaf === "isempty") return !truthy(target);
        return undefined;
    }
  }

  function compileFilters(filter) {
    if (filter == null || filter === "") return function () { return true; };
    if (typeof filter === "string") {
      var singleAst;
      try { singleAst = parseFormula(filter); }
      catch (e) { throw new Error("Filtro .base inválido «" + filter + "»: " + e.message); }
      return function (entry) { return truthy(evalAst(singleAst, entry)); };
    }
    if (Array.isArray(filter)) {
      var listFns = filter.map(compileFilters);
      return function (entry) { return listFns.every(function (fn) { return fn(entry); }); };
    }
    if (typeof filter !== "object") return function () { return true; };
    if (Array.isArray(filter.and)) {
      var andFns = filter.and.map(compileFilters);
      return function (entry) { return andFns.every(function (fn) { return fn(entry); }); };
    }
    if (Array.isArray(filter.or)) {
      var orFns = filter.or.map(compileFilters);
      return function (entry) { return orFns.some(function (fn) { return fn(entry); }); };
    }
    if (Array.isArray(filter.not)) {
      var notFns = filter.not.map(compileFilters);
      return function (entry) { return !notFns.every(function (fn) { return fn(entry); }); };
    }
    var keys = Object.keys(filter);
    if (!keys.length) return function () { return true; };
    var fns = keys.map(function (expr) { return compileFilters(expr); });
    return function (entry) { return fns.every(function (fn) { return fn(entry); }); };
  }

  /* ---------- contexto de ejecución sobre vault/metadataCache ---------- */

  function lowerObject(obj) {
    var out = {};
    obj = obj && typeof obj === "object" ? obj : {};
    Object.keys(obj).forEach(function (k) { out[lower(k)] = obj[k]; });
    return out;
  }
  function tagValues(cache) {
    var out = [];
    cache = cache || {};
    (cache.tags || []).forEach(function (t) { if (t && t.tag) out.push(String(t.tag).replace(/^#/, "")); });
    var fmTags = cache.frontmatter && cache.frontmatter.tags;
    (Array.isArray(fmTags) ? fmTags : fmTags == null ? [] : [fmTags]).forEach(function (t) { if (t != null) out.push(String(t).replace(/^#/, "")); });
    return out;
  }
  function makeEntry(app, file, formulas, cache, resolved, backlinkMap) {
    cache = cache || {};
    var lowerFm = lowerObject(cache.frontmatter);
    var formulaProxy = {};
    Object.keys(formulas || {}).forEach(function (k) {
      Object.defineProperty(formulaProxy, k, {
        enumerable: true,
        get: function () { return evalAst(parseFormula(formulas[k]), entry); }
      });
    });
    var entry = {
      app: app, file: file, frontmatter: cache.frontmatter || {}, lowerFm: lowerFm,
      fileData: {}, folder: file.parent && file.parent.path ? file.parent.path : "",
      links: Object.keys(resolved[file.path] || {}),
      backlinks: backlinkMap[file.path] || [],
      embeds: (cache.embeds || []).map(function (e) { return e.link; }).filter(Boolean),
      tags: tagValues(cache),
      formulaProxy: formulaProxy
    };
    return entry;
  }
  function backlinkMap(resolved) {
    var out = {};
    Object.keys(resolved || {}).forEach(function (src) {
      Object.keys(resolved[src] || {}).forEach(function (dst) {
        if (!out[dst]) out[dst] = [];
        out[dst].push(src);
      });
    });
    return out;
  }
  function computeResults(app, parsed) {
    var files = app.vault.getMarkdownFiles();
    var resolved = app.metadataCache.resolvedLinks || {};
    var backs = backlinkMap(resolved);
    var fn = compileFilters(viewFilters(parsed));
    var formulas = parsed.formulas || {};
    return files.filter(function (f) {
      try {
        if (app.metadataCache.isUserIgnored && app.metadataCache.isUserIgnored(f.path)) return false;
        return fn(makeEntry(app, f, formulas, app.metadataCache.getFileCache(f), resolved, backs));
      } catch (_) { return false; }
    }).map(function (f) { return f.path; }).sort();
  }
  function signature(paths) { return (paths || []).join("\u0000"); }

  /* ---------- caché viva de bases ---------- */

  function live(plugin) {
    if (!plugin._blgBases) plugin._blgBases = { cache: new Map(), version: 0 };
    return plugin._blgBases;
  }
  async function refreshBase(plugin, file) {
    var st = live(plugin), text;
    try { text = await plugin.app.vault.cachedRead(file); }
    catch (e) { st.cache.delete(file.path); return null; }
    try {
      var parsed = parseBase(text);
      var paths = computeResults(plugin.app, parsed);
      var rec = { path: file.path, mtime: file.stat && file.stat.mtime, parsed: parsed, paths: paths, sig: signature(paths) };
      var old = st.cache.get(file.path);
      st.cache.set(file.path, rec);
      if (!old || old.sig !== rec.sig) st.version++;
      return rec;
    } catch (e) {
      warn(e);
      var bad = { path: file.path, mtime: file.stat && file.stat.mtime, error: e, paths: [], sig: "" };
      st.cache.set(file.path, bad); st.version++;
      return bad;
    }
  }
  async function refreshAll(plugin) {
    var files = plugin.app.vault.getFiles().filter(function (f) { return f.extension && f.extension.toLowerCase() === "base"; });
    var seen = new Set(files.map(function (f) { return f.path; }));
    var st = live(plugin);
    Array.from(st.cache.keys()).forEach(function (p) { if (!seen.has(p)) { st.cache.delete(p); st.version++; } });
    for (var i = 0; i < files.length; i++) await refreshBase(plugin, files[i]);
    return st;
  }
  function baseFiles(plugin) {
    var st = live(plugin);
    return plugin.app.vault.getFiles().filter(function (f) {
      return f.extension && f.extension.toLowerCase() === "base" && st.cache.has(f.path) && !st.cache.get(f.path).error;
    });
  }
  function record(plugin, path) { return live(plugin).cache.get(path) || null; }
  function resultsFor(plugin, path) { var r = record(plugin, path); return r ? r.paths.slice() : []; }
  function basesContaining(plugin, notePath) {
    return baseFiles(plugin).filter(function (f) { return record(plugin, f.path).paths.indexOf(notePath) !== -1; }).map(function (f) { return f.path; });
  }

  /* ---------- integración de UI ---------- */

  function icon(settings, ink) {
    /* _blgFmIcon vive en el scope del bundle (no en globalThis): al estar
       incrustado en main.js este módulo lo ve directamente. */
    try { if (typeof _blgFmIcon === "function") return _blgFmIcon("database", ink || (settings && settings.iconColor) || baseColor(settings)); } catch (_) {}
    return null;
  }
  function scheduleGraphRefresh(plugin, force) {
    var v = plugin.getView && plugin.getView();
    if (!v || plugin.session) return;
    if (plugin.tagView && v.renderTagGraph) v.renderTagGraph();
    else if (v._scheduleRefresh) v._scheduleRefresh(!!force);
  }
  function schedulePinRefresh(plugin) {
    var h = plugin._blgPin && plugin._blgPin.attached;
    if (h && h.active && h.active() && h.basesSoon) h.basesSoon();
  }
  function refreshViews(plugin, force) { scheduleGraphRefresh(plugin, force); schedulePinRefresh(plugin); }

  /* ---------- API ---------- */

  var api = {
    color: baseColor,
    icon: icon,
    refresh: refreshAll,
    refreshBase: refreshBase,
    files: baseFiles,
    record: record,
    resultsFor: resultsFor,
    basesContaining: basesContaining,
    contains: function (plugin, basePath, notePath) { var r = record(plugin, basePath); return !!(r && r.paths.indexOf(notePath) !== -1); },
    isBaseFile: function (file) { return !!(file instanceof Oe.TFile && file.extension && file.extension.toLowerCase() === "base"); },
    invalidatePath: function (plugin, path) {
      var st = live(plugin);
      if (st.cache.delete(path)) { st.version++; refreshViews(plugin, true); }
    },
    notifyFile: function (plugin, file) {
      if (!(file instanceof Oe.TFile)) return;
      var ext = file.extension && file.extension.toLowerCase();
      if (ext === "base") {
        refreshBase(plugin, file).then(function () { refreshViews(plugin, true); }).catch(warn);
        return;
      }
      if (ext === "md") {
        var st = live(plugin), dirty = false;
        st.cache.forEach(function (r, p) {
          if (r.error) return;
          try {
            var recFile = plugin.app.vault.getAbstractFileByPath(p);
            if (!(recFile instanceof Oe.TFile)) return;
            var paths = computeResults(plugin.app, r.parsed);
            var sig = signature(paths);
            if (sig !== r.sig) { r.paths = paths; r.sig = sig; r.mtime = recFile.stat && recFile.stat.mtime; dirty = true; }
          } catch (_) {}
        });
        if (dirty) { st.version++; refreshViews(plugin, false); }
      }
    }
  };

  var _onload = PLUGIN_PROTO.onload, _onunload = PLUGIN_PROTO.onunload;
  PLUGIN_PROTO.onload = async function () {
    pluginInstance = this;
    this._blgBases = { cache: new Map(), version: 0 };
    await _onload.call(this);
    var plugin = this;
    try {
      refreshAll(plugin).then(function () { refreshViews(plugin, false); }).catch(warn);
      plugin.registerEvent(plugin.app.vault.on("create", function (f) { api.notifyFile(plugin, f); }));
      plugin.registerEvent(plugin.app.vault.on("modify", function (f) { api.notifyFile(plugin, f); }));
      plugin.registerEvent(plugin.app.vault.on("rename", function (f, oldPath) {
        try {
          var st = live(plugin);
          if (st.cache.delete(oldPath)) st.version++;
          api.notifyFile(plugin, f);
        } catch (e) { warn(e); }
      }));
      plugin.registerEvent(plugin.app.vault.on("delete", function (f) {
        try {
          if (!(f instanceof Oe.TFile)) return;
          if ((f.extension || "").toLowerCase() === "base") api.invalidatePath(plugin, f.path);
          else api.notifyFile(plugin, f);
        } catch (e) { warn(e); }
      }));
      plugin.registerEvent(plugin.app.metadataCache.on("changed", function (f) { api.notifyFile(plugin, f); }));
      plugin.registerEvent(plugin.app.metadataCache.on("resolved", function () {
        refreshAll(plugin).then(function () { refreshViews(plugin, false); }).catch(warn);
      }));
    } catch (e) { warn(e); }
  };
  PLUGIN_PROTO.onunload = function () {
    try { this._blgBases = null; } catch (_) {}
    pluginInstance = null;
    if (typeof globalThis !== "undefined" && globalThis.__BLG_BASES === api) delete globalThis.__BLG_BASES;
    return _onunload.call(this);
  };

  if (typeof globalThis !== "undefined") {
    globalThis.__BLG_BASES = api;
    globalThis.__BLG_BASES_TEST = {
      parseYaml: parseYaml, stringifyYaml: stringifyYaml, parseBase: parseBase, viewFilters: viewFilters,
      parseFormula: parseFormula, compileFilters: compileFilters, evalAst: evalAst, computeResults: computeResults,
      normalizeLogic: normalizeLogic, pathInFolder: pathInFolder, looseEqual: looseEqual, baseColor: baseColor
    };
  }
})();
