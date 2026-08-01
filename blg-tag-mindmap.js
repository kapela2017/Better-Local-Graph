/* ============================================================
   Better Local Graph — Mapa mental de tags con markmap (inyectado)
   Pegar este bloque COMPLETO al FINAL de main.js (última línea).
   Requiere el archivo blg-vendor-markmap.js en la carpeta del plugin.
   Solo desktop (usa require de Node). Comando: "tag-mindmap".

   Comportamiento:
   - Comando "Mapa mental de tag": picker de tags (estilo Tag View)
     → modal con fondo blanco y markmap del tag + sus subtags.
   - Matcheo por SEGMENTO EN CUALQUIER POSICIÓN, idéntico a la Tag View
     del plugin (tagMatches de renderTagGraph): "hermes" también agrupa
     "ia/agentes/hermes/…", "notas_diarias/ia/agentes/hermes/…", etc.
     El árbol cuelga de la raíz las subrutas que aparecen debajo de ella.
    - Conteo por NOTA DIRECTA: una nota cuenta en el nodo donde TERMINA
      su tag (ej. …/hermes/recursos/mcp cuenta solo en recursos/mcp).
      Los intermedios sin notas directas llevan badge 0 (decisión A+A).
    - Layout BILATERAL: las ramas top-level se reparten a ambos lados de
      la raíz (greedy por altura) espejando nodos/links tras cada render.
    - Viewport propio: scroll nativo con patines (markmap zoom/pan off),
      lupas + / − / encajar, Ctrl+rueda = zoom al cursor, drag = pan.
    - Click en nodo con 1 nota → la abre directo (típico en las colas).
    - Click en nodo con N notas → selector (FuzzySuggestModal) para
      elegir cuál abrir.
    - Al abrir, la vista queda posicionada en la LÍNEA EXACTA del tag
      del nodo: 1ª aparición inline en el cuerpo; si solo está en
      frontmatter, su línea dentro del YAML (eState.line + refuerzo
      con setCursor/scrollIntoView en modo edición).
    - Click en nodo con 0 notas → Notice "sin notas directas".
    - Click DERECHO en un nodo → menú "Renombrar tag #<ruta>": pide un
      nuevo label (último segmento) y renombra el tag en TODAS las notas
      de la rama (nodo + descendientes), inline y frontmatter, usando el
      mismo matcheo por segmento de la Tag View. Si el nuevo nombre ya
      existe (merge sin deshacer) pide confirmación; tras aplicarlo el
      mapa se reconstruye en el mismo modal.
    - Buscador (textbox flotante): al escribir, resalta la RAMA COMPLETA
      bajo los nodos cuyo label coincide (substring case-insensitive),
      atenúa el resto y muestra un contador; Enter centra el primer
      match, Esc limpia el filtro.
    - El circulito de plegado de markmap se conserva (no choca con el
      click de label, que markmap deja libre); en las ramas izquierdas
      se mueve al borde exterior.
   ============================================================ */
(function () {
  "use strict";

  /* ---------- helpers puros (testables en node) ---------- */

  function escHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // idéntico a fileTags() del módulo MCP: tags inline + frontmatter, sin '#'
  function fileTags(app, file) {
    var c = app.metadataCache.getFileCache(file);
    var out = [];
    if (!c) return out;
    if (c.tags) for (var i = 0; i < c.tags.length; i++) out.push(String(c.tags[i].tag).replace(/^#/, ""));
    if (c.frontmatter && c.frontmatter.tags != null) {
      var arr = Array.isArray(c.frontmatter.tags) ? c.frontmatter.tags : [c.frontmatter.tags];
      for (var k = 0; k < arr.length; k++) if (arr[k] != null) out.push(String(arr[k]).replace(/^#/, "").trim());
    }
    return out;
  }

  // segmentos de un tag, sin '#' ni huecos (tags con '/' final existen)
  function splitSegs(t) {
    var raw = String(t || "").replace(/^#/, "").split("/"), out = [];
    for (var i = 0; i < raw.length; i++) { var s = raw[i].trim(); if (s) out.push(s); }
    return out;
  }

  // ¿el label del nodo coincide con el query? substring case-insensitive
  // sobre el nombre visible (último segmento). Query vacío = todo coincide.
  function matchLabel(name, query) {
    var q = String(query || "").trim().toLowerCase();
    if (!q) return true;
    return String(name || "").toLowerCase().indexOf(q) !== -1;
  }

  // subruta que cuelga DEBAJO de la raíz si segs la contiene (secuencia de
  // segmentos en cualquier posición, primera aparición de la raíz); "" = el
  // tag termina exactamente en la raíz; null si no matchea.
  function matchSub(segs, rsegs) {
    var rl = rsegs.length;
    if (segs.length < rl) return null;
    for (var k = 0; k + rl <= segs.length; k++) {
      var ok = true;
      for (var m = 0; m < rl; m++) { if (segs[k + m] !== rsegs[m]) { ok = false; break; } }
      if (ok) return segs.slice(k + rl).join("/");
    }
    return null;
  }

  // Map(subruta -> Map(path -> tagLiteral)) usando el MISMO criterio que la
  // Tag View del plugin (tagMatches). subruta = lo que cuelga DEBAJO de
  // rootTag en ese tag; "" = notas "directas". Una nota cuenta solo donde
  // termina su tag (decisión A+A). tagLiteral = el tag completo tal como
  // está escrito en la nota (sin '#'), necesario para localizar su línea al
  // abrirla: con matcheo por segmento puede diferir del subpath del nodo
  // (p.ej. "ia/agentes/hermes/recursos/mcp" para la raíz "hermes").
  function collectTagMap(app, rootTag) {
    var map = new Map();
    var rsegs = splitSegs(rootTag);
    var files = app.vault.getMarkdownFiles();
    function eat(seen, path, tag) {
      var sub = matchSub(splitSegs(tag), rsegs);
      if (sub == null || seen[sub]) return;
      seen[sub] = true;
      if (!map.has(sub)) map.set(sub, new Map());
      map.get(sub).set(path, tag);
    }
    for (var i = 0; i < files.length; i++) {
      var c = app.metadataCache.getFileCache(files[i]);
      if (!c) continue;
      var seen = {};
      if (c.tags) for (var j = 0; j < c.tags.length; j++) {
        eat(seen, files[i].path, String(c.tags[j].tag).replace(/^#/, ""));
      }
      if (c.frontmatter && c.frontmatter.tags != null) {
        var arr = Array.isArray(c.frontmatter.tags) ? c.frontmatter.tags : [c.frontmatter.tags];
        for (var k = 0; k < arr.length; k++) {
          if (arr[k] == null) continue;
          eat(seen, files[i].path, String(arr[k]).replace(/^#/, "").trim());
        }
      }
    }
    return map;
  }

  // Reemplaza la 1ª aparición de oldSegs (secuencia de segmentos, en
  // cualquier posición) por newSegs dentro de un tag literal; null si no
  // matchea. "ia/agentes/hermes/recursos/mcp" con oldSegs=[hermes,recursos]
  // y newSegs=[hermes,recursos2] → "ia/agentes/hermes/recursos2/mcp".
  function segReplace(literal, oldSegs, newSegs) {
    var segs = splitSegs(literal);
    var ol = oldSegs.length;
    if (!ol || segs.length < ol) return null;
    for (var k = 0; k + ol <= segs.length; k++) {
      var ok = true;
      for (var m = 0; m < ol; m++) { if (segs[k + m] !== oldSegs[m]) { ok = false; break; } }
      if (ok) return segs.slice(0, k).concat(newSegs, segs.slice(k + ol)).join("/");
    }
    return null;
  }

  // Map(path -> Set(tagLiteral)) de todas las notas afectadas por renombrar
  // la rama de oldTag (nodo + descendientes), según el matcheo por segmento.
  function renameBranchTargets(app, oldTag) {
    var subMap = collectTagMap(app, oldTag);
    var out = new Map();
    subMap.forEach(function (fm) {
      fm.forEach(function (tag, path) {
        if (!out.has(path)) out.set(path, new Set());
        out.get(path).add(tag);
      });
    });
    return out;
  }

  // línea (0-based) de la primera línea del frontmatter que contiene el tag
  // literal; null si no aparece. fmStart/fmEnd = rango inclusive según
  // frontmatterPosition del caché.
  function findTagLineInText(content, fmStart, fmEnd, tag) {
    if (content == null || !tag) return null;
    var lines = String(content).split("\n");
    var from = Math.max(0, fmStart | 0);
    var to = Math.min(lines.length - 1, fmEnd | 0);
    for (var i = from; i <= to; i++) {
      if (lines[i].indexOf(tag) !== -1) return i;
    }
    return null;
  }

  // Línea 0-based donde está el tag en la nota: 1ª aparición INLINE (caché,
  // posición exacta); si solo está en frontmatter, su línea dentro del YAML
  // (fallback: inicio del frontmatter). null si no se localiza → abrir sin
  // posicionar.
  async function resolveTagLine(app, file, tag) {
    if (!tag) return null;
    var c = app.metadataCache.getFileCache(file);
    if (c && c.tags) {
      for (var i = 0; i < c.tags.length; i++) {
        if (String(c.tags[i].tag).replace(/^#/, "") === tag && c.tags[i].position) {
          return c.tags[i].position.start.line;
        }
      }
    }
    var fm = c && c.frontmatterPosition;
    if (!fm) return null;
    try {
      var content = await app.vault.cachedRead(file);
      var line = findTagLineInText(content, fm.start.line, fm.end.line, tag);
      return line != null ? line : fm.start.line;
    } catch (e) { return fm.start.line; }
  }

  function labelHtml(name, count) {
    return '<span class="blg-mm-label' + (count === 0 ? " blg-mm-zero" : "") + '">'
      + escHtml(name) + '<span class="blg-mm-badge">' + count + "</span></span>";
  }

  function rootHtml(name, count) {
    return '<span class="blg-mm-root-label"><span class="blg-mm-root-name">' + escHtml(name)
      + '</span><span class="blg-mm-root-count">' + count + "</span></span>";
  }

  // Árbol markmap {content, payload:{tag,files}, children} via trie sobre las
  // subrutas. payload.tag = rootTag + "/" + subruta (solo informativo);
  // files = [{path, tag}] de las notas cuyo tag TERMINA exactamente en esa
  // subruta; tag = tag literal en la nota (para saltar a su línea al abrir).
  function buildTree(rootTag, subMap) {
    var rootName = splitSegs(rootTag).pop() || rootTag;
    var trie = { __sub: "", __name: rootName, __kids: {} };
    var subs = Array.from(subMap.keys()).sort();
    for (var i = 0; i < subs.length; i++) {
      var sub = subs[i];
      if (!sub) continue;
      var segs = sub.split("/"), cur = trie, curSub = "";
      for (var j = 0; j < segs.length; j++) {
        curSub = curSub ? curSub + "/" + segs[j] : segs[j];
        if (!cur.__kids[segs[j]]) cur.__kids[segs[j]] = { __sub: curSub, __name: segs[j], __kids: {} };
        cur = cur.__kids[segs[j]];
      }
    }
    function toNode(t, isRoot) {
      var filesMap = subMap.get(t.__sub);
      var files = [];
      if (filesMap) filesMap.forEach(function (tag, path) { files.push({ path: path, tag: tag }); });
      files.sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; });
      var keys = Object.keys(t.__kids).sort();
      var children = [];
      for (var i = 0; i < keys.length; i++) children.push(toNode(t.__kids[keys[i]], false));
      return {
        content: isRoot ? rootHtml(t.__name, files.length) : labelHtml(t.__name, files.length),
        payload: { tag: t.__sub ? rootTag + "/" + t.__sub : rootTag, files: files },
        children: children
      };
    }
    return toNode(trie, true);
  }

  /* ---------- layout bilateral (espejo post-render) ---------- */

  // altura visible de una rama (según state.rect de los nodos visibles)
  function subtreeSpan(d) {
    var min = Infinity, max = -Infinity;
    (function walk(n) {
      var r = n.state && n.state.rect;
      if (r) {
        if (r.y < min) min = r.y;
        if (r.y + r.height > max) max = r.y + r.height;
      }
      if (n.payload && n.payload.fold) return;
      var ch = n.children || [];
      for (var i = 0; i < ch.length; i++) walk(ch[i]);
    })(d);
    return max > min ? max - min : 1;
  }

  // Reparte las ramas top-level entre izquierda y derecha (greedy por
  // altura: cada rama va al lado con menos altura acumulada).
  // Devuelve Map(state.key -> "L"|"R") para todos los descendientes visibles.
  function assignSides(root) {
    var sides = new Map();
    if (!root || !root.children || !root.children.length) return sides;
    if (root.payload && root.payload.fold) return sides;
    var hL = 0, hR = 0;
    function mark(n, side) {
      sides.set(n.state.key, side);
      if (n.payload && n.payload.fold) return;
      var ch = n.children || [];
      for (var i = 0; i < ch.length; i++) mark(ch[i], side);
    }
    for (var i = 0; i < root.children.length; i++) {
      var k = root.children[i];
      var span = subtreeSpan(k);
      var side = hL < hR ? "L" : "R";
      if (side === "L") hL += span; else hR += span;
      mark(k, side);
    }
    return sides;
  }

  // Espeja las ramas "L" alrededor del centro X de la raíz y devuelve el
  // bbox {x1,y1,x2,y2} de TODO lo visible (coords del g de markmap).
  // Usa style.transform (CSS), que tiene prioridad sobre el atributo
  // transform que markmap reescribe en cada render → sin parpadeos ni
  // carreras con las transiciones de d3.
  function applySides(mm) {
    var root = mm.state && mm.state.data;
    var gNode = mm.g && mm.g.node ? mm.g.node() : null;
    if (!root || !root.state || !gNode) return null;
    var rr = root.state.rect;
    var ax = rr.x + rr.width / 2;
    var sides = assignSides(root);
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    function eat(x0, y0, w, h) {
      if (x0 < minX) minX = x0;
      if (y0 < minY) minY = y0;
      if (x0 + w > maxX) maxX = x0 + w;
      if (y0 + h > maxY) maxY = y0 + h;
    }
    var nodes = gNode.querySelectorAll("g.markmap-node");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i], d = el.__data__;
      if (!d || !d.state) continue;
      var r = d.state.rect, side = sides.get(d.state.key);
      if (side === "L") {
        var mx = 2 * ax - r.x - r.width;
        el.style.transform = "translate(" + mx + "px," + r.y + "px)";
        el.classList.add("blg-mm-left");
        var c = el.querySelector("circle");
        if (c) c.setAttribute("cx", 0);
        eat(mx, r.y, r.width, r.height);
      } else {
        el.style.transform = "";
        el.classList.remove("blg-mm-left");
        eat(r.x, r.y, r.width, r.height);
      }
    }
    var links = gNode.querySelectorAll("path.markmap-link");
    for (var j = 0; j < links.length; j++) {
      var le = links[j], ld = le.__data__;
      var t = ld && ld.target;
      if (t && sides.get(t.state.key) === "L") {
        le.style.transform = "translate(" + (2 * ax) + "px,0px) scale(-1,1)";
      } else {
        le.style.transform = "";
      }
    }
    if (!(maxX > minX)) return null;
    // margen por los circulitos de plegado (r=6) y la media línea inferior
    return { x1: minX - 8, y1: minY - 4, x2: maxX + 8, y2: maxY + 10 };
  }

  // hook de test en node (fuera de Obsidian no hay module.exports.default)
  if (typeof globalThis !== "undefined") {
    globalThis.__BLG_MM_TEST = {
      fileTags: fileTags, splitSegs: splitSegs, matchSub: matchSub,
      collectTagMap: collectTagMap, buildTree: buildTree,
      findTagLineInText: findTagLineInText, resolveTagLine: resolveTagLine,
      subtreeSpan: subtreeSpan, assignSides: assignSides,
      applySides: applySides,
      matchLabel: matchLabel,
      segReplace: segReplace,
      renameBranchTargets: renameBranchTargets,
      deleteBranchTargets: deleteBranchTargets,
      applyDeleteTags: applyDeleteTags,
      applyRenameToFiles: applyRenameToFiles
    };
  }

  /* ---------- guards ---------- */

  var PLUGIN_PROTO;
  try {
    PLUGIN_PROTO = module.exports && module.exports.default && module.exports.default.prototype;
  } catch (e) { return; }
  if (!PLUGIN_PROTO) { try { console.warn("[BLG Mindmap] no se encontró el prototipo del plugin"); } catch (_) {} return; }

  var Oe;
  try { Oe = require("obsidian"); } catch (e) { return; }
  var pathMod;
  try { pathMod = require("path"); } catch (e) { return; } // móvil: salir en silencio

  /* ---------- i18n ---------- */

  function langOf(plugin) {
    return (plugin && plugin.settings && plugin.settings.uiLang) === "en" ? "en" : "es";
  }
  var STR = {
    es: {
      cmdName: "Better Local Graph: mapa mental de tag",
      pickTitle: "Mapa mental por tag",
      pickPlaceholder: "Escribe para buscar un tag…",
      noNotes: "Este tag no tiene notas directas",
      noTags: "No hay tags en el vault",
      vendorMissing: "Mapa mental: no se encontró blg-vendor-markmap.js en la carpeta del plugin",
      pickNotePlaceholder: "Elige la nota a abrir…",
      zoomIn: "Acercar",
      zoomOut: "Alejar",
      fit: "Encajar todo el mapa",
      searchPlaceholder: "Buscar en el mapa…",
      noMatches: "Sin coincidencias",
      oneMatch: "1 coincidencia",
      nMatches: "%d coincidencias",
      renameMenu: "Renombrar tag %s",
      renameTitle: "Renombrar tag",
      renamePlaceholder: "Edita el tag completo (usa '/' para añadir subtags)…",
      invalidTagName: "Nombre de tag no válido (sin espacios ni caracteres prohibidos)",
      unchanged: "Sin cambios: el label no cambió",
      noTargets: "No hay notas con ese tag en la rama",
      renamedN: "Renombrado: %d nota(s) actualizada(s)",
      mergeTitle: "Aviso: no se puede deshacer",
      mergeWarn: "Renombrar %s a %s fusionará notas con el tag existente. Esto no se puede deshacer. ¿Continuar?",
      errPrefix: "Error al renombrar: ",
      ok: "Aceptar",
      cancel: "Cancelar",
      deleteMenu: "Eliminar tag %s",
      deleteTitle: "Eliminar tag",
      deleteWarn: "Se eliminará el tag %s de las notas que lo usen, sin tocar sus subtags. Esto no se puede deshacer. ¿Continuar?",
      deletedN: "Eliminado: %d nota(s) actualizada(s)"
    },
    en: {
      cmdName: "Better Local Graph: tag mindmap",
      pickTitle: "Tag mindmap",
      pickPlaceholder: "Type to search for a tag…",
      noNotes: "This tag has no direct notes",
      noTags: "No tags in the vault",
      vendorMissing: "Mindmap: blg-vendor-markmap.js not found in the plugin folder",
      pickNotePlaceholder: "Choose the note to open…",
      zoomIn: "Zoom in",
      zoomOut: "Zoom out",
      fit: "Fit the whole map",
      searchPlaceholder: "Search the map…",
      noMatches: "No matches",
      oneMatch: "1 match",
      nMatches: "%d matches",
      renameMenu: "Rename tag %s",
      renameTitle: "Rename tag",
      renamePlaceholder: "Edit the full tag (use '/' to add subtags)…",
      invalidTagName: "Invalid tag name (no spaces or forbidden characters)",
      unchanged: "Unchanged: label did not change",
      noTargets: "No notes with that tag in the branch",
      renamedN: "Renamed: %d file(s) updated",
      mergeTitle: "Warning: no undo",
      mergeWarn: "Renaming %s to %s will merge notes with the existing tag. This cannot be undone. Continue?",
      errPrefix: "Error renaming: ",
      ok: "Accept",
      cancel: "Cancel",
      deleteMenu: "Delete tag %s",
      deleteTitle: "Delete tag",
      deleteWarn: "Tag %s will be removed from the notes that use it, without touching its subtags. This cannot be undone. Continue?",
      deletedN: "Deleted: %d file(s) updated"
    }
  };
  function T(lang, key) { return (STR[lang] && STR[lang][key]) || STR.es[key] || key; }

  /* ---------- carga del vendor markmap (lazy, cacheada) ---------- */

  var _mm = null, _mmFailed = false;
  function loadMarkmap(plugin) {
    if (_mm) return _mm;
    if (_mmFailed) return null;
    try {
      var base = plugin.app.vault.adapter.getBasePath();
      var p = pathMod.join(base, plugin.manifest.dir, "blg-vendor-markmap.js");
      var m = require(p);
      if (!m || typeof m.Markmap === "undefined") throw new Error("vendor inválido");
      _mm = m;
      return _mm;
    } catch (e) {
      _mmFailed = true;
      try { console.warn("[BLG Mindmap] no se pudo cargar blg-vendor-markmap.js", e); } catch (_) {}
      return null;
    }
  }

  /* ---------- picker de tags (mismo estilo que BlgTagPick del bundle) ---------- */

  var BlgTagPickMM = class extends Oe.FuzzySuggestModal {
    constructor(app, plugin, onPick) {
      super(app);
      this._lang = langOf(plugin);
      this.onPickCb = onPick;
      this.setPlaceholder(T(this._lang, "pickPlaceholder"));
      this._title = T(this._lang, "pickTitle");
    }
    onOpen() {
      super.onOpen();
      try { this.titleEl && this.titleEl.setText(this._title); } catch (e) {}
    }
    getItems() {
      // igual que BlgTagPick.getItems(): tags completos + prefijos +
      // segmentos sueltos (así "hermes" de "ia/agentes/hermes/…" es elegible)
      var set = new Set(), mc = this.app.metadataCache;
      function addAll(x) {
        var segs = splitSegs(x);
        if (!segs.length) return;
        var acc = "";
        for (var s of segs) {
          acc = acc ? acc + "/" + s : s;
          set.add(acc); // tag completo + prefijos
          set.add(s);   // segmentos sueltos
        }
      }
      for (var f of this.app.vault.getMarkdownFiles()) {
        var c = mc.getFileCache(f);
        if (!c) continue;
        if (c.tags) for (var t of c.tags) addAll(t.tag.replace(/^#/, ""));
        var fm = c.frontmatter;
        if (fm && fm.tags) {
          var arr = Array.isArray(fm.tags) ? fm.tags : [fm.tags];
          for (var t2 of arr) { if (t2 == null) continue; addAll(String(t2).replace(/^#/, "").trim()); }
        }
      }
      return Array.from(set).sort(function (a, b) { return a.localeCompare(b); });
    }
    getItemText(t) { return "#" + t; }
    onChooseItem(t) { this.onPickCb && this.onPickCb(t); }
  };

  /* ---------- selector de notas (cuando un nodo tiene varias) ---------- */

  var BlgNotePick = class extends Oe.FuzzySuggestModal {
    constructor(app, plugin, entries, onPick) {
      super(app);
      this.entries = entries; // [{path, tag}]
      this.onPickCb = onPick;
      this.setPlaceholder(T(langOf(plugin), "pickNotePlaceholder"));
    }
    getItems() { return this.entries; }
    getItemText(e) {
      var f = this.app.vault.getAbstractFileByPath(e.path);
      var base = f ? f.basename : e.path;
      var dir = e.path.replace(/\/[^/]*$/, "");
      return dir && dir !== e.path ? base + "  —  " + dir : base;
    }
    onChooseItem(e) { this.onPickCb && this.onPickCb(e); }
  };

  /* ---------- modales de confirmación y prompt de rename ---------- */

  var TAG_SEGMENT_RE = /^[^\s\/'"!#$%&()*+,.:;<=>?@^`{|}~\[\]\\]+$/;

  var BlgConfirm = class extends Oe.Modal {
    constructor(app, title, messageHtml, okText, cancelText, onOk) {
      super(app);
      this._t = title; this._m = messageHtml;
      this._ok = okText; this._no = cancelText;
      this.onOk = onOk;
    }
    onOpen() {
      this.titleEl.setText(this._t);
      this.contentEl.createDiv().innerHTML = this._m;
      var bar = this.contentEl.createDiv();
      bar.style.cssText = "margin-top:16px;display:flex;gap:8px;justify-content:flex-end";
      var ok = bar.createEl("button", { text: this._ok, cls: "mod-cta mod-warning" });
      var no = bar.createEl("button", { text: this._no });
      var self = this;
      ok.onclick = function () { self.close(); self.onOk && self.onOk(); };
      no.onclick = function () { self.close(); };
    }
    onClose() { this.contentEl.empty(); }
  };

  var BlgRenamePrompt = class extends Oe.Modal {
    constructor(app, title, current, hint, placeholder, okText, cancelText, onOk) {
      super(app);
      this._t = title; this._cur = current || ""; this._hint = hint || "";
      this._ph = placeholder || ""; this._ok = okText; this._no = cancelText;
      this.onOk = onOk;
    }
    onOpen() {
      this.titleEl.setText(this._t);
      if (this._hint) {
        var hint = this.contentEl.createDiv();
        hint.textContent = "#" + this._hint;
        hint.style.cssText = "margin:0 0 4px;opacity:.55;font-size:.85em;word-break:break-all";
      }
      var input = this.contentEl.createEl("input", { type: "text" });
      input.value = this._cur;
      input.placeholder = this._ph;
      input.style.cssText = "width:100%;margin:8px 0 12px;box-sizing:border-box";
      var bar = this.contentEl.createDiv();
      bar.style.cssText = "display:flex;gap:8px;justify-content:flex-end";
      var ok = bar.createEl("button", { text: this._ok, cls: "mod-cta" });
      var no = bar.createEl("button", { text: this._no });
      var self = this;
      ok.onclick = function () {
        var v = input.value.trim();
        self.close();
        self.onOk && self.onOk(v);
      };
      no.onclick = function () { self.close(); };
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); ok.click(); }
        else if (e.key === "Escape") { e.preventDefault(); no.click(); }
      });
      setTimeout(function () { input.focus(); input.select(); }, 0);
    }
    onClose() { this.contentEl.empty(); }
  };

  // Reemplazo por posición en el cuerpo + reescritura del frontmatter vía
  // processFrontMatter (misma API que usa la costura del bundle, sin añadir
  // dependencia YAML). Devuelve nº de archivos modificados.
  // newTag = el tag COMPLETO nuevo (el campo de edición muestra el path
  // entero); la rama se reemplaza con segReplace(oldSegs -> newSegs).
  // Optimizaciones:
  //  - vault.read SOLO si el caché muestra candidatos inline (fuera del fm).
  //  - processFrontMatter SOLO si el pre-cálculo sobre los valores cacheados
  //    indica un cambio real (evita reescrituras no-op y eventos espurios).
  //  - Archivos procesados en lotes paralelos (paths distintos: sin carreras).
  async function applyRenameToFiles(app, oldTag, newTag) {
    var oldSegs = splitSegs(oldTag);
    var newSegs = splitSegs(newTag);
    var targets = renameBranchTargets(app, oldTag);
    var paths = Array.from(targets.keys()).sort();
    async function processOne(path) {
      var f = app.vault.getAbstractFileByPath(path);
      if (!f || (Oe && !(f instanceof Oe.TFile))) return 0;
      var c = app.metadataCache.getFileCache(f);
      var fmRange = (c && c.frontmatterPosition)
        ? { a: c.frontmatterPosition.start.line, b: c.frontmatterPosition.end.line } : null;
      var fileChanged = false;
      // Candidatos inline según el caché (excluye los que viven en el YAML).
      var toReplace = [];
      if (c && c.tags) {
        for (var j = 0; j < c.tags.length; j++) {
          var t = c.tags[j];
          if (!t || !t.position) continue;
          var lit = String(t.tag).replace(/^#/, "");
          if (fmRange && t.position.start.line >= fmRange.a && t.position.start.line <= fmRange.b) continue;
          var repl = segReplace(lit, oldSegs, newSegs);
          if (repl == null) continue;
          toReplace.push({ t: t, repl: repl });
        }
      }
      if (toReplace.length) {
        // Los offsets del caché apuntan al archivo ORIGINAL: reemplazar de
        // mayor a menor offset para no desalinear las posiciones restantes.
        toReplace.sort(function (a, b) { return b.t.position.start.offset - a.t.position.start.offset; });
        var text = await app.vault.read(f);
        var orig = text;
        for (var jj = 0; jj < toReplace.length; jj++) {
          var o = toReplace[jj];
          var s = o.t.position.start.offset, e = o.t.position.end.offset;
          if (text.slice(s, e) !== String(o.t.tag)) continue; // archivo cambiado; saltar
          text = text.slice(0, s) + "#" + o.repl + text.slice(e);
        }
        if (text !== orig) {
          await app.vault.modify(f, text);
          fileChanged = true;
        }
      }
      // Frontmatter: pre-calcular con los valores cacheados; processFrontMatter
      // re-serializa SIEMPRE, así que solo se invoca si hay cambio real.
      var fmEdited = false;
      if (c && c.frontmatter && c.frontmatter.tags != null) {
        var ftv = c.frontmatter.tags;
        var fmWillChange = false;
        if (Array.isArray(ftv)) {
          for (var q0 = 0; q0 < ftv.length; q0++) {
            if (typeof ftv[q0] !== "string") continue;
            var r0 = segReplace(ftv[q0].replace(/^#/, "").trim(), oldSegs, newSegs);
            if (r0 != null && r0 !== ftv[q0]) { fmWillChange = true; break; }
          }
        } else if (typeof ftv === "string") {
          var r0s = segReplace(ftv.replace(/^#/, "").trim(), oldSegs, newSegs);
          if (r0s != null && r0s !== ftv) fmWillChange = true;
        }
        if (fmWillChange) {
          try {
            await app.fileManager.processFrontMatter(f, function (fm) {
              var tv = fm.tags;
              if (Array.isArray(tv)) {
                for (var q = 0; q < tv.length; q++) {
                  if (typeof tv[q] !== "string") continue;
                  var r = segReplace(tv[q].replace(/^#/, "").trim(), oldSegs, newSegs);
                  if (r != null && r !== tv[q]) { tv[q] = r; fmEdited = true; }
                }
              } else if (typeof tv === "string") {
                var r2 = segReplace(tv.replace(/^#/, "").trim(), oldSegs, newSegs);
                if (r2 != null && r2 !== tv) { fm.tags = r2; fmEdited = true; }
              }
            });
          } catch (e) {
            try { console.warn("[BLG Mindmap] rename frontmatter", e); } catch (_) {}
          }
        }
      }
      return (fileChanged || fmEdited) ? 1 : 0;
    }
    var count = 0;
    var CHUNK = 8;
    for (var i = 0; i < paths.length; i += CHUNK) {
      var results = await Promise.all(paths.slice(i, i + CHUNK).map(processOne));
      for (var k = 0; k < results.length; k++) count += results[k];
    }
    return count;
  }

  function renameBranch(app, plugin, oldTag, newTagInput, lang, onDone) {
    newTagInput = String(newTagInput || "").trim();
    // El campo de edición contiene el tag COMPLETO nuevo; se permite '/' para
    // crear/mover subtags: cada segmento se valida por separado.
    var newParts = splitSegs(newTagInput);
    if (!newParts.length) { new Oe.Notice(T(lang, "invalidTagName")); return; }
    for (var pi = 0; pi < newParts.length; pi++) {
      if (!TAG_SEGMENT_RE.test(newParts[pi])) { new Oe.Notice(T(lang, "invalidTagName")); return; }
    }
    var oldSegs = splitSegs(oldTag);
    if (!oldSegs.length) return;
    var newSegs = newParts;
    var newTag = newSegs.join("/");
    if (String(oldTag).toLowerCase() === newTag.toLowerCase()) { new Oe.Notice(T(lang, "unchanged")); return; }
    var exists = false;
    try {
      var all = app.metadataCache.getTags();
      var nlower = newTag.toLowerCase();
      for (var k in all) {
        var kl = String(k).replace(/^#/, "").toLowerCase();
        if (kl === nlower || kl.indexOf(nlower + "/") === 0) { exists = true; break; }
      }
    } catch (e) {}
    function doRename() {
      applyRenameToFiles(app, oldTag, newTag).then(function (n) {
        new Oe.Notice(T(lang, "renamedN").replace("%d", n));
        if (onDone) onDone(newTag);
      }).catch(function (e) {
        try { console.error("[BLG Mindmap] rename", e); } catch (_) {}
        new Oe.Notice(T(lang, "errPrefix") + (e && e.message ? e.message : e));
      });
    }
    if (exists) {
      new BlgConfirm(app,
        T(lang, "mergeTitle"),
        T(lang, "mergeWarn").replace("%s", "#" + oldTag).replace("%s", "#" + newTag),
        T(lang, "ok"), T(lang, "cancel"), doRename).open();
      return;
    }
    doRename();
  }

  // Map(path -> Set(tagLiteral)) de las notas que tienen EXACTAMENTE el tag
  // oldTag (subruta "" bajo el nodo). NO incluye descendientes (subtags):
  // borrar un nodo no arrastra sus subtags, que son otros nodos.
  function deleteBranchTargets(app, oldTag) {
    var subMap = collectTagMap(app, oldTag);
    var out = new Map();
    var direct = subMap.get("");
    if (direct) direct.forEach(function (tag, path) {
      if (!out.has(path)) out.set(path, new Set());
      out.get(path).add(tag);
    });
    return out;
  }

  // Elimina el tag EXACTO del nodo (sin subtags) de las notas que lo usan,
  // inline y frontmatter. Devuelve nº de archivos modificados.
  async function applyDeleteTags(app, oldTag) {
    var targets = deleteBranchTargets(app, oldTag); // Map(path -> Set(tagLiteral))
    var paths = Array.from(targets.keys()).sort();
    var count = 0;
    for (var i = 0; i < paths.length; i++) {
      var f = app.vault.getAbstractFileByPath(paths[i]);
      if (!f || (Oe && !(f instanceof Oe.TFile))) continue;
      var tags = targets.get(paths[i]);
      var c = app.metadataCache.getFileCache(f);
      var fmRange = (c && c.frontmatterPosition)
        ? { a: c.frontmatterPosition.start.line, b: c.frontmatterPosition.end.line } : null;
      var fileChanged = false;
      var orig = await app.vault.read(f);
      var text = orig;
      if (c && c.tags) {
        var toRemove = [];
        for (var j = 0; j < c.tags.length; j++) {
          var t = c.tags[j];
          if (!t || !t.position) continue;
          var lit = String(t.tag).replace(/^#/, "");
          if (fmRange && t.position.start.line >= fmRange.a && t.position.start.line <= fmRange.b) continue;
          if (tags.has(lit)) toRemove.push(t);
        }
        // offsets del caché apuntan al archivo ORIGINAL: borrar de mayor a menor
        toRemove.sort(function (a, b) { return b.position.start.offset - a.position.start.offset; });
        for (var jj = 0; jj < toRemove.length; jj++) {
          var o = toRemove[jj];
          var s = o.position.start.offset, e = o.position.end.offset;
          if (text.slice(s, e) !== String(o.tag)) continue; // archivo cambiado; saltar
          text = text.slice(0, s) + text.slice(e);
          fileChanged = true;
        }
      }
      if (fileChanged && text !== orig) await app.vault.modify(f, text);
      var fmEdited = false;
      if (c && c.frontmatter && c.frontmatter.tags != null) {
        try {
          await app.fileManager.processFrontMatter(f, function (fm) {
            var tv = fm.tags;
            if (Array.isArray(tv)) {
              var newArr = [];
              for (var q = 0; q < tv.length; q++) {
                if (typeof tv[q] !== "string") { newArr.push(tv[q]); continue; }
                if (tags.has(tv[q].replace(/^#/, "").trim())) { fmEdited = true; continue; }
                newArr.push(tv[q]);
              }
              fm.tags = newArr;
            } else if (typeof tv === "string") {
              if (tags.has(tv.replace(/^#/, "").trim())) { fm.tags = []; fmEdited = true; }
            }
          });
        } catch (e) {
          try { console.warn("[BLG Mindmap] delete frontmatter", e); } catch (_) {}
        }
      }
      if (fileChanged || fmEdited) count++;
    }
    return count;
  }

  function deleteBranch(app, oldTag, lang, onDone) {
    function doDelete() {
      applyDeleteTags(app, oldTag).then(function (n) {
        new Oe.Notice(T(lang, "deletedN").replace("%d", n));
        if (onDone) onDone(oldTag);
      }).catch(function (e) {
        try { console.error("[BLG Mindmap] delete", e); } catch (_) {}
        new Oe.Notice(T(lang, "errPrefix") + (e && e.message ? e.message : e));
      });
    }
    new BlgConfirm(app,
      T(lang, "deleteTitle"),
      T(lang, "deleteWarn").replace("%s", "#" + oldTag),
      T(lang, "ok"), T(lang, "cancel"), doDelete).open();
  }

  /* ---------- modal del mapa mental ---------- */

  var BlgMindmapModal = class extends Oe.Modal {
    constructor(app, plugin, rootTag) {
      super(app);
      this.plugin = plugin;
      this.rootTag = rootTag;
      this.mm = null;
      this._rebuildTimer = null;
      this._rebuildCap = null;
      this._cacheRef = null;
    }
    onOpen() {
      var lang = langOf(this.plugin);
      var MM = loadMarkmap(this.plugin);
      if (!MM) { new Oe.Notice(T(lang, "vendorMissing")); this.close(); return; }

      var tagMap = collectTagMap(this.app, this.rootTag);
      var data = buildTree(this.rootTag, tagMap);

      this.modalEl.addClass("blg-mm-modal");
      this.setTitle("#" + this.rootTag);
      this.contentEl.empty();
      this.contentEl.addClass("blg-mm-content");

      // zona scrollable (patines nativos) + svg dimensionado por JS
      var scrollEl = this.contentEl.createDiv("blg-mm-scroll");
      var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "blg-mm-svg");
      scrollEl.appendChild(svg);

      var options = {
        autoFit: false,
        duration: 0,             // el espejado bilateral es instantáneo
        maxWidth: 320,
        paddingX: 14,
        spacingHorizontal: 70,
        spacingVertical: 10,
        initialExpandLevel: -1,  // todo expandido
        embedGlobalCSS: true,
        fitRatio: 0.92,
        maxInitialScale: 1.4,
        zoom: false,             // zoom/pan de markmap fuera:
        pan: false               // usamos scroll nativo + zoom propio
      };
      this.mm = MM.Markmap.create(svg, options, data);

      /* ----- viewport propio: scroll nativo + zoom con ancla ----- */
      var self = this;
      var vp = this._vp = { k: 1, tx: 0, ty: 0, bbox: null, ready: false };
      var PAD = 24;

      function place() {
        if (!vp.bbox) return;
        var k = vp.k, b = vp.bbox;
        var w = (b.x2 - b.x1) * k + PAD * 2;
        var h = (b.y2 - b.y1) * k + PAD * 2;
        // si el contenido cabe, se centra en vez de quedar arrinconado
        var extraX = Math.max(0, (scrollEl.clientWidth - w) / 2);
        var extraY = Math.max(0, (scrollEl.clientHeight - h) / 2);
        vp.tx = PAD - b.x1 * k + extraX;
        vp.ty = PAD - b.y1 * k + extraY;
        self.mm.g.attr("transform", "translate(" + vp.tx + "," + vp.ty + ") scale(" + k + ")");
        svg.style.width = Math.ceil(Math.max(w, scrollEl.clientWidth)) + "px";
        svg.style.height = Math.ceil(Math.max(h, scrollEl.clientHeight)) + "px";
      }
      function contentAt(sx, sy) { // punto del contenido bajo un punto de pantalla
        return { x: (scrollEl.scrollLeft + sx - vp.tx) / vp.k, y: (scrollEl.scrollTop + sy - vp.ty) / vp.k };
      }
      function scrollTo(c, sx, sy) {
        scrollEl.scrollLeft = c.x * vp.k + vp.tx - sx;
        scrollEl.scrollTop = c.y * vp.k + vp.ty - sy;
      }
      function centerAnchor() {
        var sx = scrollEl.clientWidth / 2, sy = scrollEl.clientHeight / 2;
        return { c: contentAt(sx, sy), sx: sx, sy: sy };
      }
      function zoomTo(k2, anchor) {
        k2 = Math.min(3, Math.max(0.2, k2));
        if (k2 === vp.k) return;
        vp.k = k2;
        place();
        if (anchor) scrollTo(anchor.c, anchor.sx, anchor.sy);
      }
      function fitAll() {
        if (!vp.bbox) return;
        var b = vp.bbox;
        vp.k = Math.min(2.5, Math.max(0.2, Math.min(
          scrollEl.clientWidth / Math.max(1, b.x2 - b.x1),
          scrollEl.clientHeight / Math.max(1, b.y2 - b.y1)
        ) * 0.94));
        place();
        scrollTo({ x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 },
          scrollEl.clientWidth / 2, scrollEl.clientHeight / 2);
      }

      /* ----- buscador: resalta la rama cuyo label coincide ----- */
      var searchWrap = document.createElement("div");
      searchWrap.className = "blg-mm-search";
      var input = document.createElement("input");
      input.type = "text";
      input.placeholder = T(lang, "searchPlaceholder");
      input.setAttribute("aria-label", T(lang, "searchPlaceholder"));
      var countEl = document.createElement("span");
      countEl.className = "blg-mm-search-count";
      searchWrap.appendChild(input);
      searchWrap.appendChild(countEl);
      this.contentEl.appendChild(searchWrap);

      // Marca en un Set los state.key de los nodos cuyo LABEL matchea y de
      // TODA su subrama (rama completa); el resto del mapa se atenúa.
      function applyFilter() {
        var q = input.value;
        var set = new Set();
        var hasQuery = q && q.trim();
        var root = self.mm && self.mm.state && self.mm.state.data;
        if (hasQuery && root) {
          (function walk(n) {
            var name = n.payload && n.payload.tag
              ? String(n.payload.tag).split("/").pop() : "";
            if (matchLabel(name, hasQuery)) {
              set.add(n.state.key);
              (function markDesc(c) {
                var ch = c.children || [];
                for (var i = 0; i < ch.length; i++) {
                  set.add(ch[i].state.key);
                  markDesc(ch[i]);
                }
              })(n);
            }
            var ch = n.children || [];
            for (var i = 0; i < ch.length; i++) walk(ch[i]);
          })(root);
        }
        var nodes = self.mm && self.mm.g && self.mm.g.node
          ? self.mm.g.node().querySelectorAll("g.markmap-node") : [];
        var visible = 0;
        for (var i = 0; i < nodes.length; i++) {
          var d = nodes[i].__data__;
          if (!d || !d.state) continue;
          var on = hasQuery && set.has(d.state.key);
          if (on) visible++;
          nodes[i].classList.toggle("blg-mm-hl", on);
          nodes[i].classList.toggle("blg-mm-dim", !!hasQuery && !on);
        }
        if (!hasQuery) countEl.textContent = "";
        else if (visible === 0) countEl.textContent = T(lang, "noMatches");
        else if (visible === 1) countEl.textContent = T(lang, "oneMatch");
        else countEl.textContent = T(lang, "nMatches").replace("%d", visible);
      }

      input.addEventListener("input", applyFilter);
      input.addEventListener("keydown", function (e) {
        if (e.key === "Escape") {
          if (!input.value) return; // sin texto: dejar cerrar el modal
          input.value = "";
          applyFilter();
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (e.key !== "Enter") return;
        // Enter → centrar el primer match visible (respetando el espejado L)
        var nodes = self.mm && self.mm.g && self.mm.g.node
          ? self.mm.g.node().querySelectorAll("g.markmap-node.blg-mm-hl") : [];
        if (!nodes.length) return;
        var d = nodes[0].__data__;
        if (!d || !d.state || !d.state.rect) return;
        var r = d.state.rect;
        var cx = r.x + r.width / 2, cy = r.y + r.height / 2;
        if (nodes[0].classList.contains("blg-mm-left")) {
          var rr = self.mm.state.data.state.rect;
          cx = 2 * (rr.x + rr.width / 2) - cx;
        }
        scrollTo({ x: cx, y: cy }, scrollEl.clientWidth / 2, scrollEl.clientHeight / 2);
      });

      // Re-aplicar el layout bilateral + viewport tras CADA render
      // (inicial, plegados y ResizeObserver interno de markmap).
      var origRender = this.mm.renderData.bind(this.mm);
      this.mm.renderData = function (t) {
        return origRender(t).then(function () {
          try {
            var anchor = vp.ready ? centerAnchor() : null;
            vp.bbox = applySides(self.mm);
            if (!vp.ready) {
              vp.ready = true;
              place();
              var rr = self.mm.state.data.state.rect;
              scrollTo({ x: rr.x + rr.width / 2, y: rr.y + rr.height / 2 },
                scrollEl.clientWidth / 2, scrollEl.clientHeight / 2);
            } else {
              place();
              if (anchor) scrollTo(anchor.c, anchor.sx, anchor.sy);
            }
            applyFilter();
          } catch (e) { try { console.warn("[BLG Mindmap] sides/viewport", e); } catch (_) {} }
        });
      };

      /* ----- botones: lupas + encajar ----- */
      var bar = document.createElement("div");
      bar.className = "blg-mm-zoom";
      function mkBtn(icon, label, fn) {
        var b = document.createElement("button");
        b.type = "button";
        b.title = label;
        b.setAttribute("aria-label", label);
        try { Oe.setIcon(b, icon); } catch (e) { b.textContent = label; }
        b.addEventListener("click", fn);
        bar.appendChild(b);
      }
      mkBtn("zoom-in", T(lang, "zoomIn"), function () { zoomTo(vp.k * 1.25, centerAnchor()); });
      mkBtn("zoom-out", T(lang, "zoomOut"), function () { zoomTo(vp.k / 1.25, centerAnchor()); });
      mkBtn("scan", T(lang, "fit"), fitAll);
      this.contentEl.appendChild(bar);

      /* ----- Ctrl+rueda = zoom anclado al cursor ----- */
      scrollEl.addEventListener("wheel", function (e) {
        if (!e.ctrlKey) return; // sin Ctrl: scroll nativo de los patines
        e.preventDefault();
        e.stopPropagation();
        var rect = scrollEl.getBoundingClientRect();
        var sx = e.clientX - rect.left, sy = e.clientY - rect.top;
        zoomTo(vp.k * (e.deltaY < 0 ? 1.25 : 0.8), { c: contentAt(sx, sy), sx: sx, sy: sy });
      }, { passive: false });

      /* ----- drag = pan (arrastrar para mover, sobre el scroll) -----
         OJO: el pointer capture se toma SOLO cuando el drag arranca
         (>4px). Si se capturara en pointerdown, Chromium retargetearía
         el `click` al <svg> y los labels dejarían de ser clicables. */
      var pan = null;
      svg.addEventListener("pointerdown", function (e) {
        if (e.button !== 0) return;
        pan = { x: e.clientX, y: e.clientY, sl: scrollEl.scrollLeft, st: scrollEl.scrollTop, on: false, id: e.pointerId };
      });
      svg.addEventListener("pointermove", function (e) {
        if (!pan) return;
        var dx = e.clientX - pan.x, dy = e.clientY - pan.y;
        if (!pan.on && Math.abs(dx) + Math.abs(dy) > 4) {
          pan.on = true;
          svg.classList.add("blg-mm-panning");
          try { svg.setPointerCapture(pan.id); } catch (_) {}
        }
        if (pan.on) {
          scrollEl.scrollLeft = pan.sl - dx;
          scrollEl.scrollTop = pan.st - dy;
        }
      });
      function endPan() {
        if (pan && pan.on) svg.classList.remove("blg-mm-panning");
        pan = null;
      }
      svg.addEventListener("pointerup", endPan);
      svg.addEventListener("pointercancel", endPan);

      // Click en label → abrir nota / selector.
      // Guardas: (1) ignorar el circulito de plegado (lo gestiona markmap),
      // (2) ignorar clicks que en realidad fueron un pan (drag).
      var downX = 0, downY = 0;
      svg.addEventListener("pointerdown", function (e) { downX = e.clientX; downY = e.clientY; }, true);
      svg.addEventListener("click", function (e) {
        if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 6) return; // era un pan
        var tgt = e.target;
        // Refuerzo: si el target quedó retargeteado al <svg> (p.ej. por un
        // pointer capture recién soltado), recuperamos el elemento real.
        if (!tgt || !tgt.closest || !tgt.closest("g.markmap-node")) {
          try {
            var el = document.elementFromPoint(e.clientX, e.clientY);
            if (el) tgt = el;
          } catch (_) {}
        }
        var tn = tgt && tgt.tagName ? String(tgt.tagName).toLowerCase() : "";
        if (tn === "circle") return; // plegado nativo
        var g = tgt && tgt.closest ? tgt.closest("g.markmap-node") : null;
        if (!g || !g.__data__) return;
        var files = (g.__data__.payload && g.__data__.payload.files) || [];
        if (files.length === 0) { new Oe.Notice(T(lang, "noNotes")); return; }
        if (files.length === 1) { self.openPath(files[0]); self.close(); return; }
        new BlgNotePick(self.app, self.plugin, files, function (e) { self.openPath(e); self.close(); }).open();
      });

      /* ----- click derecho en un nodo → renombrar tag de la rama ----- */
      svg.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        e.stopPropagation();
        var tgt = e.target;
        var tn = tgt && tgt.tagName ? String(tgt.tagName).toLowerCase() : "";
        if (tn === "circle") return; // circulito de plegado
        var g = tgt && tgt.closest ? tgt.closest("g.markmap-node") : null;
        if (!g || !g.__data__) return;
        var tag = g.__data__.payload && g.__data__.payload.tag;
        if (!tag) return;
        var menu = new Oe.Menu();
        menu.addItem(function (it) {
          it.setIcon("pencil")
            .setTitle(T(lang, "renameMenu").replace("%s", "#" + tag))
            .onClick(function () {
              new BlgRenamePrompt(self.app, T(lang, "renameTitle"), tag, self.rootTag, T(lang, "renamePlaceholder"),
                T(lang, "ok"), T(lang, "cancel"),
                function (v) {
                  renameBranch(self.app, self.plugin, tag, v, lang, function (newTag) {
                    // Solo se re-enraíza el mapa si se renombró el propio nodo
                    // raíz del filtro; si es una rama interna, el filtro sigue
                    // siendo el mismo y solo se refresca el árbol.
                    if (newTag && self.rootTag && tag === self.rootTag) self.rootTag = newTag;
                    self._scheduleRebuild();
                  });
                }).open();
            });
        });
        menu.showAtPosition({ x: e.clientX, y: e.clientY });
      });
    }
    // Abre la nota posicionada en la línea exacta del tag del nodo: 1ª
    // aparición inline en el cuerpo; si solo está en frontmatter, su línea
    // dentro del YAML. entry = {path, tag}.
    async openPath(entry) {
      var f = this.app.vault.getAbstractFileByPath(entry.path);
      if (!(f instanceof Oe.TFile)) return;
      var line = await resolveTagLine(this.app, f, entry.tag);
      var leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(f, line != null ? { eState: { line: line } } : undefined);
      if (line == null) return;
      var v = leaf.view;
      if (v && v.editor) {
        // refuerzo en modo edición: eState.line puede ignorarse al reusar
        // un leaf; en Reading View el salto es best-effort (sin editor)
        try {
          var pos = { line: line, ch: 0 };
          v.editor.setCursor(pos);
          v.editor.scrollIntoView({ from: pos, to: pos }, true);
        } catch (e) {}
      }
    }
    // Tras un rename: re-colecta tags, reconstruye el árbol y re-renderiza
    // (el renderData envuelto re-aplica layout bilateral + viewport).
    rebuildAfterRename() {
      try {
        var tagMap = collectTagMap(this.app, this.rootTag);
        var data = buildTree(this.rootTag, tagMap);
        if (this.mm) this.mm.setData(data);
        this.setTitle("#" + this.rootTag);
      } catch (e) { try { console.warn("[BLG Mindmap] rebuild", e); } catch (_) {} }
    }
    // Refresco forzado tras un rename: rebuild inmediato (feedback visual) +
    // rebuild diferido cuando el metadataCache termine de re-parsear las notas
    // modificadas (vault.modify/processFrontMatter actualizan el caché de
    // forma ASÍNCRONA; sin esto el árbol se reconstruía con tags obsoletos).
    // Debounce de 200ms tras el último evento "changed", con cap de 3s por si
    // no llega ninguno. Los timers/listener se limpian en onClose.
    _scheduleRebuild() {
      var self = this;
      this.rebuildAfterRename();
      this._clearRebuildWait();
      var done = false;
      var finish = function () {
        if (done) return;
        done = true;
        self._clearRebuildWait();
        self.rebuildAfterRename();
      };
      try {
        this._cacheRef = this.app.metadataCache.on("changed", function () {
          if (self._rebuildTimer) clearTimeout(self._rebuildTimer);
          self._rebuildTimer = setTimeout(finish, 200);
        });
      } catch (e) { this._cacheRef = null; }
      this._rebuildCap = setTimeout(finish, 3000);
    }
    _clearRebuildWait() {
      if (this._rebuildTimer) { clearTimeout(this._rebuildTimer); this._rebuildTimer = null; }
      if (this._rebuildCap) { clearTimeout(this._rebuildCap); this._rebuildCap = null; }
      if (this._cacheRef) {
        try { this.app.metadataCache.offref(this._cacheRef); } catch (e) {}
        this._cacheRef = null;
      }
    }
    onClose() {
      this._clearRebuildWait();
      try { this.mm && this.mm.destroy(); } catch (e) {}
      this.mm = null;
      this.contentEl.empty();
    }
  };

  /* ---------- inyección: envolver onload para registrar el comando ---------- */

  var _onload = PLUGIN_PROTO.onload;
  PLUGIN_PROTO.onload = async function () {
    await _onload.call(this);
    try {
      var self = this;
      this.addCommand({
        id: "tag-mindmap",
        name: T(langOf(this), "cmdName"),
        callback: function () {
          var lang = langOf(self);
          if (!loadMarkmap(self)) { new Oe.Notice(T(lang, "vendorMissing")); return; }
          new BlgTagPickMM(self.app, self, function (tag) {
            new BlgMindmapModal(self.app, self, tag).open();
          }).open();
        }
      });
    } catch (e) { try { console.warn("[BLG Mindmap] error registrando el comando", e); } catch (_) {} }
  };
})();
