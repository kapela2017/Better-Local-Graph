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
    - Click en nodo con 0 notas → Notice "sin notas directas".
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

  // Map(subruta -> Set(path)) usando el MISMO criterio que la Tag View del
  // plugin (tagMatches: secuencia de segmentos en cualquier posición).
  // subruta = lo que cuelga DEBAJO de rootTag en ese tag; "" = el tag termina
  // exactamente en la raíz (notas "directas"). Una nota cuenta solo donde
  // termina su tag (decisión A+A); primera aparición de la raíz por tag.
  function collectTagMap(app, rootTag) {
    var map = new Map();
    var rsegs = splitSegs(rootTag), rl = rsegs.length;
    var files = app.vault.getMarkdownFiles();
    for (var i = 0; i < files.length; i++) {
      var tags = fileTags(app, files[i]);
      var seen = {};
      for (var j = 0; j < tags.length; j++) {
        var segs = splitSegs(tags[j]);
        if (segs.length < rl) continue;
        for (var k = 0; k + rl <= segs.length; k++) {
          var ok = true;
          for (var m = 0; m < rl; m++) { if (segs[k + m] !== rsegs[m]) { ok = false; break; } }
          if (!ok) continue;
          var sub = segs.slice(k + rl).join("/");
          if (!seen[sub]) {
            seen[sub] = true;
            if (!map.has(sub)) map.set(sub, new Set());
            map.get(sub).add(files[i].path);
          }
          break; // solo la primera aparición de la raíz dentro del tag
        }
      }
    }
    return map;
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
  // files = notas cuyo tag TERMINA exactamente en esa subruta.
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
      var filesSet = subMap.get(t.__sub);
      var files = filesSet ? Array.from(filesSet).sort() : [];
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
      fileTags: fileTags, splitSegs: splitSegs, collectTagMap: collectTagMap,
      buildTree: buildTree, subtreeSpan: subtreeSpan, assignSides: assignSides,
      applySides: applySides
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
      fit: "Encajar todo el mapa"
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
      fit: "Fit the whole map"
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
    constructor(app, plugin, paths, onPick) {
      super(app);
      this.paths = paths;
      this.onPickCb = onPick;
      this.setPlaceholder(T(langOf(plugin), "pickNotePlaceholder"));
    }
    getItems() { return this.paths; }
    getItemText(p) {
      var f = this.app.vault.getAbstractFileByPath(p);
      var base = f ? f.basename : p;
      var dir = p.replace(/\/[^/]*$/, "");
      return dir && dir !== p ? base + "  —  " + dir : base;
    }
    onChooseItem(p) { this.onPickCb && this.onPickCb(p); }
  };

  /* ---------- modal del mapa mental ---------- */

  var BlgMindmapModal = class extends Oe.Modal {
    constructor(app, plugin, rootTag) {
      super(app);
      this.plugin = plugin;
      this.rootTag = rootTag;
      this.mm = null;
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
        new BlgNotePick(self.app, self.plugin, files, function (p) { self.openPath(p); self.close(); }).open();
      });
    }
    openPath(p) {
      var f = this.app.vault.getAbstractFileByPath(p);
      if (f instanceof Oe.TFile) this.app.workspace.getLeaf(false).openFile(f);
    }
    onClose() {
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
