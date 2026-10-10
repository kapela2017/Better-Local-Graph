/* ============================================================
   Better Local Graph — Pizarra de notas fijadas (inyectado).
   Añadir este módulo DESPUÉS de blg-tag-mindmap.js y ANTES de
   blg-folder-drops.js al regenerar main.js (drops debe quedar
   al final: test-folder-drops.js exige paridad marker→EOF).
   Desktop únicamente. Estado visual en settings.pinBoard (data.json);
   las relaciones creadas desde el board usan costuras reales del plugin.
   La pizarra es un MODO del mismo panel de BLG (no ItemView ni
   modal): cubre el área del grafo y se sale con el mismo botón.
   Refresco incremental: fijar/desfijar/editar parchea UNA
   tarjeta y sus aristas; jamás reconstruye el grafo ni mueve
   otras tarjetas o la cámara.
   ============================================================ */
(function () {
  "use strict";
  var PLUGIN_PROTO;
  try { PLUGIN_PROTO = module.exports && module.exports.default && module.exports.default.prototype; } catch (_) { return; }
  if (!PLUGIN_PROTO) return;
  var Oe;
  try { Oe = require("obsidian"); } catch (_) { return; } // móvil

  var pluginInstance = null, warned = false;
  function warn(e) { if (!warned) { warned = true; try { console.warn("[BLG PinBoard]", e); } catch (_) {} } }
  function T(key) { return typeof L === "function" ? L(key) : key; }
  function msg(key) { var x = T(key); return typeof x === "function" ? x.apply(null, Array.prototype.slice.call(arguments, 1)) : x; }
  function notice(key) { new Oe.Notice(msg.apply(null, arguments)); }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function svg(tag, parent, attrs) {
    var el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(el);
    return el;
  }

  var CARD_W = 220, CARD_H_EST = 150, SPOT_GAP = 26;
  var DEFAULT_DATE_FONT = '"Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';
  var DEFAULT_DATE_COLOR = "#8b6f47";

  /* Colores persistidos: solo hex de 6 dígitos (lo que emite el color picker). */
  function normalizeColor(v) {
    var s = String(v || "").trim();
    return /^#[0-9a-f]{6}$/i.test(s) ? s.toLowerCase() : null;
  }
  function edgeKey(from, to) { return from + "\0" + to; }
  /* Selección ordenada: 2 = primera→segunda; N = primera padre de todas o cadena. */
  function relationPairs(paths, mode) {
    var raw = Array.isArray(paths) ? paths : [];
    var ps = raw.filter(function (p, i) { return typeof p === "string" && p && raw.indexOf(p) === i; });
    var out = [];
    if (ps.length < 2) return out;
    if (ps.length === 2) return [[ps[0], ps[1]]];
    if (mode === "chain") {
      for (var i = 0; i < ps.length - 1; i++) out.push([ps[i], ps[i + 1]]);
    } else {
      for (var j = 1; j < ps.length; j++) out.push([ps[0], ps[j]]);
    }
    return out;
  }
  /* Misma semántica que el tooltip de la vista tag: aliases→alias, escalares
      como lista, valores vacíos omitidos, orden de la configuración. */
  function tooltipFieldNames(settings) {
    var ps = settings && settings.tooltipProps;
    return Array.isArray(ps) && ps.length ? ps.slice() : ["aliases"];
  }
  function frontmatterValues(fm, name) {
    if (!fm || !name) return [];
    var v = fm[name];
    if (name === "aliases" && v == null) v = fm.alias;
    if (v == null) return [];
    var ls = Array.isArray(v) ? v : [v];
    return ls.filter(function (x) { return x != null && String(x).length > 0; }).map(function (x) { return String(x); });
  }
  function parseFrontmatterBlock(content) {
    var m = String(content || "").match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
    if (!m) return null;
    try {
      var fm = typeof Oe.parseYaml === "function" ? Oe.parseYaml(m[1]) : null;
      return { frontmatter: fm && typeof fm === "object" ? fm : {}, body: String(content).slice(m[0].length) };
    } catch (_) { return { frontmatter: {}, body: String(content).slice(m[0].length) }; }
  }
  function formatMtime(mtime, lang) {
    var d = new Date(+mtime || 0);
    if (!(d.getTime() > 0)) return "—";
    try {
      return new Intl.DateTimeFormat(lang === "en" ? "en" : "es", { dateStyle: "medium", timeStyle: "short" }).format(d);
    } catch (_) {
      return d.toLocaleString();
    }
  }
  function dateFont(settings) {
    var f = String(settings && settings.pinDateFont || "").trim();
    return f || DEFAULT_DATE_FONT;
  }
  function dateColor(settings) { return normalizeColor(settings && settings.pinDateColor) || DEFAULT_DATE_COLOR; }

  /* ---------- utilidades puras (testeables en Node) ---------- */

  /* Pan que mantiene el punto del mundo bajo el cursor al pasar de z0 a z1
     (misma matemática que el zoom anclado de las gotas). */
  function anchorPan(pan, z0, z1, ax, ay) {
    var mx = (ax - pan.x) / z0, my = (ay - pan.y) / z0;
    return { x: ax - mx * z1, y: ay - my * z1 };
  }
  /* Curva S horizontal entre dos puntos (mismo estilo que el mapa mental). */
  function sewCurve(x1, y1, x2, y2) {
    var mx = (x1 + x2) / 2;
    return "M" + x1 + "," + y1 + " C" + mx + "," + y1 + " " + mx + "," + y2 + " " + x2 + "," + y2;
  }
  /* Punto sobre el borde de un rect (centrado en cx,cy, tamaño w×h, margen de
     4px) en la dirección de (tx,ty): la arista nace en el borde de la tarjeta. */
  function borderPoint(cx, cy, w, h, tx, ty) {
    var dx = tx - cx, dy = ty - cy;
    if (!dx && !dy) return { x: cx, y: cy };
    var hw = w / 2 + 4, hh = h / 2 + 4;
    var sx = dx ? hw / Math.abs(dx) : Infinity;
    var sy = dy ? hh / Math.abs(dy) : Infinity;
    var s = Math.min(sx, sy);
    return { x: cx + dx * s, y: cy + dy * s };
  }
  /* Estado persistido: versión + cámara + tarjetas {ruta:{x,y,z,color?}},
     estilos por arista y color propio del board. Limpia valores corruptos
     sin borrar silenciosamente lo rescatable. */
  function normalizeState(raw) {
    var st = { version: 1, camera: null, nextZ: 1, cards: {}, edgeStyles: {}, boardColor: null };
    if (!raw || typeof raw !== "object") return st;
    if (raw.camera && typeof raw.camera === "object") {
      var c = raw.camera, x = +c.x, y = +c.y, z = +c.z;
      if (isFinite(x) && isFinite(y) && isFinite(z) && z > 0) st.camera = { x: x, y: y, z: clamp(z, 0.2, 4) };
    }
    st.boardColor = normalizeColor(raw.boardColor);
    var cards = raw.cards && typeof raw.cards === "object" ? raw.cards : {};
    Object.keys(cards).forEach(function (p) {
      var e = cards[p];
      if (!e || typeof e !== "object") return;
      var x = +e.x, y = +e.y, z = Math.round(+e.z);
      if (!isFinite(x) || !isFinite(y)) return;
      if (!isFinite(z) || z < 1) z = 1;
      st.cards[p] = { x: x, y: y, z: z };
      var color = normalizeColor(e.color);
      if (color) st.cards[p].color = color;
      st.nextZ = Math.max(st.nextZ, z + 1);
    });
    var styles = raw.edgeStyles && typeof raw.edgeStyles === "object" ? raw.edgeStyles : {};
    Object.keys(styles).forEach(function (k) {
      var v = styles[k];
      if (!k || k.indexOf("\0") < 0 || !v || typeof v !== "object") return;
      var out = {};
      var color = normalizeColor(v.color);
      if (color) out.color = color;
      if (v.dash === "solid" || v.dash === "dash") out.dash = v.dash;
      if (Object.keys(out).length) st.edgeStyles[k] = out;
    });
    return st;
  }
  /* Renombrado/movido: la tarjeta conserva posición, z y color bajo la nueva
     ruta; sus estilos de arista migran con ella. Un renombrado de CARPETA
     migra todos sus descendientes (prefijo + "/"). */
  function migrateRename(state, oldPath, newPath) {
    var cards = state && state.cards || {}, changed = false;
    function mapped(p) {
      if (p === oldPath) return newPath;
      var pre = oldPath + "/";
      return p.indexOf(pre) === 0 ? newPath + "/" + p.slice(pre.length) : p;
    }
    if (Object.prototype.hasOwnProperty.call(cards, oldPath)) {
      cards[newPath] = cards[oldPath]; delete cards[oldPath]; changed = true;
    }
    var pre = oldPath + "/";
    Object.keys(cards).forEach(function (k) {
      if (k.indexOf(pre) === 0) {
        cards[newPath + "/" + k.slice(pre.length)] = cards[k]; delete cards[k]; changed = true;
      }
    });
    var styles = state && state.edgeStyles;
    if (styles && typeof styles === "object") {
      Object.keys(styles).forEach(function (k) {
        var parts = k.split("\0");
        if (parts.length !== 2) return;
        var from = mapped(parts[0]), to = mapped(parts[1]);
        if (from === parts[0] && to === parts[1]) return;
        styles[edgeKey(from, to)] = styles[k]; delete styles[k]; changed = true;
      });
    }
    return changed;
  }
  function removeEdgeStylesFor(state, path) {
    var styles = state && state.edgeStyles, changed = false;
    if (!styles || typeof styles !== "object") return false;
    Object.keys(styles).forEach(function (k) {
      var parts = k.split("\0");
      if (parts[0] === path || parts[1] === path) { delete styles[k]; changed = true; }
    });
    return changed;
  }
  /* Una .base queda oculta cuando el ajuste basesMode no la permite: conserva
     su pin y sus costuras, pero no se dibuja tarjeta ni aristas. */
  function baseHidden(plugin, path) {
    var B = basesApi(plugin);
    return !!(B && B.isVisible && isBasePath(path) && !B.isVisible(plugin, path));
  }
  /* Aristas visibles: costura dirigida fuente→destino cuando ambas notas
     están fijadas, más aristas consulta→nota para cada .base fijada. */
  function deriveEdges(paths, sewingOf, basesOf) {
    var set = new Set(paths), seen = new Set(), edges = [];
    function push(p, t, kind) {
      if (t === p || !set.has(t)) return;
      var k = edgeKey(p, t);
      if (seen.has(k)) return;
      seen.add(k);
      edges.push({ from: p, to: t, kind: kind });
    }
    paths.forEach(function (p) {
      var tg;
      try { tg = sewingOf(p); } catch (_) { return; }
      if (!tg) return;
      Array.from(tg).forEach(function (t) { push(p, t, "sewing"); });
    });
    paths.forEach(function (p) {
      if (!isBasePath(p) || !basesOf) return;
      var tg;
      try { tg = basesOf(p); } catch (_) { return; }
      (tg || []).forEach(function (t) { push(p, t, "base"); });
    });
    return edges;
  }
  /* Resultados de consulta de una .base, vacíos cuando está oculta por el filtro. */
  function visibleBaseResults(plugin, p) {
    var B = basesApi(plugin);
    if (!B) return [];
    if (B.isVisible && !B.isVisible(plugin, p)) return [];
    return B.resultsFor(plugin, p);
  }
  function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh, gap) {
    gap = gap || 0;
    return ax - gap < bx + bw && ax + aw + gap > bx && ay - gap < by + bh && ay + ah + gap > by;
  }
  /* Hueco para una tarjeta nueva: anillos cuadrados alrededor del centro
     visible hasta encontrar una celda que no solape a las existentes. Las
     tarjetas viejas NUNCA se mueven. */
  function findSpot(existing, center, w, h, gap) {
    gap = gap == null ? SPOT_GAP : gap;
    var stepX = w + gap, stepY = h + gap;
    var sx = Math.round((center.x - w / 2) / stepX), sy = Math.round((center.y - h / 2) / stepY);
    for (var ring = 0; ring < 48; ring++) {
      for (var dx = -ring; dx <= ring; dx++) {
        for (var dy = -ring; dy <= ring; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          var x = (sx + dx) * stepX, y = (sy + dy) * stepY, ok = true;
          for (var i = 0; i < existing.length; i++) {
            var e = existing[i];
            if (rectsOverlap(x, y, w, h, e.x, e.y, e.w, e.h, gap)) { ok = false; break; }
          }
          if (ok) return { x: x, y: y };
        }
      }
    }
    return { x: center.x - w / 2, y: center.y - h / 2 };
  }
  /* Cámara que encuadra todas las tarjetas con margen, zoom acotado. */
  function fitCamera(cards, viewport, margin) {
    margin = margin == null ? 60 : margin;
    if (!cards.length) return { x: viewport.w / 2, y: viewport.h / 2, z: 1 };
    var x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    cards.forEach(function (c) {
      x1 = Math.min(x1, c.x); y1 = Math.min(y1, c.y);
      x2 = Math.max(x2, c.x + c.w); y2 = Math.max(y2, c.y + c.h);
    });
    var w = Math.max(1, x2 - x1), h = Math.max(1, y2 - y1);
    var z = clamp(Math.min((viewport.w - margin * 2) / w, (viewport.h - margin * 2) / h), 0.2, 1.25);
    return { x: viewport.w / 2 - z * (x1 + x2) / 2, y: viewport.h / 2 - z * (y1 + y2) / 2, z: z };
  }
  /* Cámara para LEER una tarjeta (primer clic): siempre la centra. Si está
     lejos (z<0.8) acerca a ~1.1; si está tan cerca que desborda el viewport,
     aleja hasta encuadrarla; en rango legible conserva el zoom (solo centra). */
  function focusCam(rect, viewport, z, margin) {
    margin = margin == null ? 40 : margin;
    var zfit = Math.min(
      (viewport.w - margin * 2) / Math.max(1, rect.w),
      (viewport.h - margin * 2) / Math.max(1, rect.h));
    var tz = z;
    if (tz < 0.8) tz = 1.1;
    else if (tz > 2) tz = 1.5;
    if (tz > zfit) tz = zfit;
    tz = clamp(tz, 0.2, 3);
    return {
      x: viewport.w / 2 - tz * (rect.x + rect.w / 2),
      y: viewport.h / 2 - tz * (rect.y + rect.h / 2),
      z: tz
    };
  }
  /* Extracto en texto plano: utilidad pura conservada para contratos/tests;
     la cara de la tarjeta usa las propiedades configuradas del tooltip. */
  function previewText(md, max) {
    max = max || 200;
    var t = String(md || "");
    t = t.replace(/^﻿?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, "");
    t = t.replace(/```[\s\S]*?```/g, " ");
    t = t.replace(/`([^`]*)`/g, "$1");
    t = t.replace(/!\[\[[^\]]*\]\]/g, " ");
    t = t.replace(/\[\[([^\]|]+)\|([^\]]*)\]\]/g, "$2");
    t = t.replace(/\[\[([^\]]*)\]\]/g, "$1");
    t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
    t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
    t = t.replace(/^#{1,6}\s+/gm, "");
    t = t.replace(/^\s*(?:[-*+]|\d+\.)\s+\[[ xX]\]\s+/gm, "");
    t = t.replace(/^\s*>[ \t]?/gm, "");
    t = t.replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, "");
    t = t.replace(/(\*{1,3}|_{1,3}|~~)([^*_~]+)\1/g, "$2");
    t = t.replace(/<[^>]+>/g, " ");
    t = t.replace(/\s+/g, " ").trim();
    return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
  }
  function folderOf(path) {
    var i = String(path || "").lastIndexOf("/");
    return i < 0 ? "" : path.slice(0, i);
  }
  function baseOf(path) {
    return String(path || "").split("/").pop().replace(/\.(md|base)$/i, "");
  }
  function isBasePath(path) { return /\.base$/i.test(String(path || "")); }
  function basesApi(plugin) { return plugin && globalThis.__BLG_BASES || null; }

  /* ---------- TaskNotes: detección, plantilla y conversión (puras) ---------- */

  var DEFAULT_TASK_COLOR = "#00aa88";

  /* Configuración propia en settings (top-level, como pinDateFont): color del
     distintivo, icono de tarea y plantilla elegida en opciones. La plantilla
     es SOLO un grupo de propiedades YAML: se anexan, nunca reemplazan. */
  function taskSettings(settings) {
    settings = settings || {};
    return {
      enabled: settings.pinTasksEnabled !== false,
      color: normalizeColor(settings.pinTaskColor) || DEFAULT_TASK_COLOR,
      icon: String(settings.pinTaskIcon || "").trim(),
      template: String(settings.pinTaskTemplate || "").trim()
    };
  }
  /* TaskNotes solo cuenta cuando está INSTALADO Y ACTIVADO. Vía nativa:
     enabledPlugins (Set/Array). Pero gestores como Better Plugins Manager
     con carga diferida (DELAY) cargan la instancia SIN incluirla en
     enabledPlugins: entonces la prueba real es la instancia ya cargada
     (registro plugins o getPlugin). Un plugin solo instalado nunca cuenta. */
  function taskNotesEnabled(plugin) {
    try {
      var pl = plugin && plugin.app && plugin.app.plugins;
      if (!pl) return false;
      var en = pl.enabledPlugins;
      if (en && typeof en.has === "function" && en.has("tasknotes")) return true;
      if (Array.isArray(en) && en.indexOf("tasknotes") >= 0) return true;
      var reg = pl.plugins;
      if (reg && typeof reg.has === "function") { if (reg.has("tasknotes")) return true; }
      else if (reg && typeof reg === "object" && reg.tasknotes) return true;
      if (typeof pl.getPlugin === "function") {
        try { if (pl.getPlugin("tasknotes")) return true; } catch (_) {}
      }
      return false;
    } catch (_) { return false; }
  }
  function taskNotesPlugin(plugin) {
    try {
      if (!taskNotesEnabled(plugin)) return null;
      var pl = plugin.app.plugins;
      return typeof pl.getPlugin === "function" ? pl.getPlugin("tasknotes") : (pl.plugins && pl.plugins.tasknotes) || null;
    } catch (_) { return null; }
  }
  function taskNotesApi(plugin) {
    try {
      var api = taskNotesPlugin(plugin) && taskNotesPlugin(plugin).api;
      return api && +api.apiVersion >= 1 ? api : null;
    } catch (_) { return null; }
  }
  function taskNotesSettings(plugin) {
    try {
      var tn = taskNotesPlugin(plugin);
      if (tn && tn.settings) return tn.settings;
      var api = taskNotesApi(plugin);
      return api && api.settings && typeof api.settings.snapshot === "function" ? api.settings.snapshot() : null;
    } catch (_) { return null; }
  }
  /* El icono configurado en opciones se resuelve con el mismo resolver del
     bundle (Lucide, emoji, Notebook Navigator/Iconize) que el frontmatter icon. */
  function taskIconUri(plugin, settings, task) {
    try {
      var conf = taskSettings(settings);
      var icon = conf.icon;
      if (!icon && plugin) icon = taskIconFromSettings(taskNotesSettings(plugin), task);
      if (!icon || typeof _blgFmIcon !== "function") return null;
      return _blgFmIcon(icon, conf.color) || null;
    } catch (_) { return null; }
  }
  /* Prioriza el icono visual de BLG; si no hay, usa el icono del estado
     configurado en TaskNotes cuando exista. */
  function taskIconFromSettings(s, task) {
    var list = s && Array.isArray(s.customStatuses) ? s.customStatuses : [];
    var status = String(task && task.status || s && s.defaultTaskStatus || "");
    for (var i = 0; i < list.length; i++) {
      if (String(list[i] && list[i].value || "") === status && list[i].icon) return String(list[i].icon);
    }
    return "";
  }
  /* Modal "Asigne el Nombre de la Tarea": cuadro de texto + botón para usar
     el título de la nota. Resuelve el título elegido o null si se cancela
     (ESC/X/Cancelar): en ese caso la conversión NO toca la nota. Nivel de
     módulo con dependencias inyectadas para poder probar el contrato. */
  function askTaskTitle(OeX, app, file, prefill) {
    return new Promise(function (resolve) {
      var m = new OeX.Modal(app), settled = false;
      /* Resolver SIEMPRE antes de cerrar: Modal.close() dispara onClose y,
         si resolvemos después, la cancelación ganaría la carrera. */
      function done(v) { if (!settled) { settled = true; resolve(v); } }
      m.titleEl.setText(T("pinTaskTitleAsk"));
      var input = m.contentEl.createEl("input", { type: "text" });
      input.style.width = "100%";
      input.style.marginBottom = "12px";
      input.value = prefill || file.basename;
      function accept(v) { done(v); m.close(); }
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); accept(input.value.trim() || file.basename); }
      });
      var row = m.contentEl.createDiv({ cls: "blg-pin-color-actions" });
      var ok = row.createEl("button", { text: T("pinTaskTitleSave"), cls: "mod-cta" });
      ok.addEventListener("click", function () { accept(input.value.trim() || file.basename); });
      var useNote = row.createEl("button", { text: T("pinTaskTitleUseNote") });
      useNote.addEventListener("click", function () { accept(file.basename); });
      var cancel = row.createEl("button", { text: T("cancel") });
      cancel.addEventListener("click", function () { done(null); m.close(); });
      m.onClose = function () { done(null); };
      m.open();
      input.focus();
      input.select();
    });
  }
  /* Es tarea si TaskNotes ya la tiene en caché o si el frontmatter cumple el
     identificador configurado (tag, default "task"; también property). El tag
     funciona case-insensitive como Obsidian y admite subtags (#task/urgente).
     `settings` puede venir precargado para no consultar el plugin en cada tarjeta. */
  function isTaskNote(plugin, file, fm, task, settings) {
    try {
      if (task && typeof task === "object") return true;
      if (file && isBasePath(file.path || "")) return false;
      if (!fm) return false;
      var s = settings || taskNotesSettings(plugin);
      var method = String(s && s.taskIdentificationMethod || "tag");
      if (method === "property") {
        var pn = String(s && s.taskPropertyName || "").trim(), pv = String(s && s.taskPropertyValue || "").trim();
        if (!pn) return false;
        var v = fm[pn];
        if (v == null) return false;
        return !pv || String(v) === pv;
      }
      var root = String(s && s.taskTag || "task").trim().replace(/^#/, "").toLowerCase();
      if (!root) return false;
      if (!fm) return false;
      var tags = fm.tags != null ? fm.tags : fm.tag;
      if (tags == null) return false;
      var ls = Array.isArray(tags) ? tags : String(tags).split(/[\s,]+/);
      for (var i = 0; i < ls.length; i++) {
        var t = String(ls[i] == null ? "" : ls[i]).trim().replace(/^#/, "").toLowerCase();
        if (t && (t === root || t.indexOf(root + "/") === 0)) return true;
      }
      return false;
    } catch (_) { return false; }
  }
  /* Título visible de la tarea: caché de TaskNotes → propiedad `title` del
     frontmatter → nombre de la nota (basename). */
  function taskTitle(task, file, fm) {
    var title = task && typeof task.title === "string" ? task.title.trim() : "";
    if (title) return title;
    var v = fm && fm.title;
    if (v != null && String(v).trim()) return String(v).trim();
    return (file && file.basename) || "";
  }
  /* Estados completados configurados en TaskNotes (customStatuses con
     isCompleted=true). Lista vacía = no hay configuración: cae al convenio
     "done"/"completed". */
  function taskCompletedValues(settings) {
    var list = settings && Array.isArray(settings.customStatuses) ? settings.customStatuses : [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (s && s.isCompleted === true && s.value != null && String(s.value)) out.push(String(s.value));
    }
    return out;
  }
  /* Estado vigente de la tarea: caché de TaskNotes → frontmatter → estado
     por defecto configurado (misma prioridad que cardTaskInfo). */
  function taskStatusValue(task, fm, settings) {
    var v = task && task.status;
    if (v != null && v !== "") return String(v);
    v = fm && fm.status;
    if (v != null && v !== "") return String(v);
    v = settings && settings.defaultTaskStatus;
    return v != null && v !== "" ? String(v) : "";
  }
  /* ¿La tarea está completada? Prioriza el statusManager de TaskNotes (la
     misma regla que su UI), luego los customStatuses y por último el
     convenio: el check respeta estados personalizados. */
  function taskIsCompleted(plugin, status, settings) {
    try {
      var tn = plugin && taskNotesPlugin(plugin);
      if (tn && tn.statusManager && typeof tn.statusManager.isCompletedStatus === "function")
        return !!tn.statusManager.isCompletedStatus(status);
    } catch (_) {}
    var v = String(status == null ? "" : status);
    var done = taskCompletedValues(settings);
    if (done.length) return done.indexOf(v) >= 0;
    return v === "done" || v === "completed";
  }
  /* Marca la tarea completada (✅) o la reabre (pendiente) escribiendo COMO
     TaskNotes: su API pública (complete/uncomplete, que valida los estados
     configurados) y, sin ella, el toggle de la instancia (la misma acción
     que su lista). Devuelve {completed, unchanged} o null si no se pudo
     (TaskNotes ausente/desactivado, no es tarea o la escritura falló). La
     escritura toca el frontmatter → metadataCache "changed" → la tarjeta se
     repinta sola: ese mismo camino cubre TaskNotes → pizarra. */
  async function setTaskCompleted(plugin, file, completed) {
    try {
      if (!plugin || !plugin.app || !file || isBasePath(file.path || "")) return null;
      if (!taskSettings(plugin.settings).enabled) return null;
      var tnSettings = taskNotesSettings(plugin);
      if (!taskNotesEnabled(plugin) || !tnSettings) return null;
      var fm = ((plugin.app.metadataCache.getFileCache(file) || {}).frontmatter) || null;
      var tn = taskNotesPlugin(plugin), cached = null;
      var cm = tn && tn.cacheManager;
      if (cm && typeof cm.getCachedTaskInfoSync === "function") { try { cached = cm.getCachedTaskInfoSync(file.path); } catch (_) { cached = null; } }
      if (!isTaskNote(plugin, file, fm, cached, tnSettings)) return null;
      var done = taskIsCompleted(plugin, taskStatusValue(cached, fm, tnSettings), tnSettings);
      completed = !!completed;
      if (done === completed) return { completed: done, unchanged: true };
      var wrote = false;
      var api = taskNotesApi(plugin);
      if (api && api.tasks) {
        var fn = completed ? api.tasks.complete : api.tasks.uncomplete;
        if (typeof fn === "function") { await fn.call(api.tasks, file.path); wrote = true; }
      }
      if (!wrote) {
        /* Respaldo sin API: el toggle de la instancia (misma acción que su
           lista). Como ya devolvimos unchanged cuando el estado coincide,
           aquí el toggle siempre apunta al estado deseado. */
        var task = cached;
        if (!task && cm && typeof cm.getTaskInfo === "function") { try { task = await cm.getTaskInfo(file.path); } catch (_) {} }
        if (!task) task = { path: file.path, status: taskStatusValue(null, fm, tnSettings) };
        if (tn && typeof tn.toggleTaskStatus === "function") { await tn.toggleTaskStatus(task); wrote = true; }
      }
      if (!wrote) return null;
      return { completed: completed, unchanged: false };
    } catch (e) { warn(e); return null; }
  }
  /* Variante por ruta para el MCP: resuelve la nota y delega. */
  async function setTaskCompletedByPath(plugin, path, completed) {
    try {
      var f = plugin && plugin.app && plugin.app.vault.getAbstractFileByPath(path);
      if (!(f instanceof Oe.TFile)) return null;
      return await setTaskCompleted(plugin, f, completed);
    } catch (e) { warn(e); return null; }
  }
  /* ¿Hay que pedir el nombre de la tarea? Solo cuando la propiedad `title`
     existe en la nota O en la plantilla (aunque sea nula): TaskNotes la
     requiere. null = no preguntar; si no, devuelve el prefill (puede ser ""). */
  function taskTitleProp(fm, templateFm) {
    var has = (fm && typeof fm === "object" && Object.prototype.hasOwnProperty.call(fm, "title")) ||
              (templateFm && typeof templateFm === "object" && Object.prototype.hasOwnProperty.call(templateFm, "title"));
    if (!has) return null;
    var v = fm && fm.title;
    return { prefill: v != null && String(v).trim() ? String(v).trim() : "" };
  }
  /* Info de tarea de UNA tarjeta, síncrona y serializable (la usa boardState
     para el MCP, también con la pizarra cerrada): caché de TaskNotes si está
     lista; si no, el frontmatter basta. null cuando no es tarea o la
     integración está inactiva. */
  function cardTaskInfo(plugin, file) {
    try {
      if (!plugin || !file || isBasePath(file.path || "")) return null;
      if (!taskSettings(plugin.settings).enabled) return null;
      var tnS = taskNotesSettings(plugin);
      if (!tnS) return null;
      var fm = ((plugin.app.metadataCache.getFileCache(file) || {}).frontmatter) || null;
      var cached = null;
      var tn = taskNotesPlugin(plugin), cm = tn && tn.cacheManager;
      if (cm && typeof cm.getCachedTaskInfoSync === "function") cached = cm.getCachedTaskInfoSync(file.path);
      if (!isTaskNote(plugin, file, fm, cached, tnS)) return null;
      fm = fm || {};
      function pick() {
        for (var i = 0; i < arguments.length; i++) {
          var v = arguments[i];
          if (v != null && v !== "") return String(v);
        }
        return null;
      }
      var status = pick(cached && cached.status, fm.status, tnS.defaultTaskStatus);
      return {
        title: taskTitle(cached, file, fm),
        status: status,
        priority: pick(cached && cached.priority, fm.priority, tnS.defaultTaskPriority),
        due: pick(cached && cached.due, fm.due),
        scheduled: pick(cached && cached.scheduled, fm.scheduled),
        /* El check ✅ de la tarjeta: true cuando el estado es uno de los
           completados configurados en TaskNotes. */
        completed: taskIsCompleted(plugin, status, tnS)
      };
    } catch (_) { return null; }
  }
  /* La plantilla elegida en opciones es un GRUPO DE PROPIEDADES que se ANEXAN
     al frontmatter de la nota: jamás reemplaza un valor existente (ni "" ni
     false ni 0), nunca toca `sewing`, fusiona los tags de la plantilla con los
     propios (sin duplicar, case-insensitive) y añade el identificador que
     TaskNotes tenga configurado. Devuelve null si no hay nada que escribir
     (evita toques de archivo innecesarios). */
  function taskTemplatePatch(fm, templateFm, settings) {
    var current = fm || {}, out = null;
    function set(k, v) { if (!out) out = {}; out[k] = v; }
    function splitTags(v) {
      if (v == null) return [];
      var ls = Array.isArray(v) ? v.slice() : String(v).split(/[\s,]+/);
      return ls.map(function (t) { return String(t == null ? "" : t).trim(); }).filter(Boolean);
    }
    var tfm = templateFm && typeof templateFm === "object" ? templateFm : {};
    var tagAdds = [];
    Object.keys(tfm).forEach(function (k) {
      if (!k || k === "sewing") return;
      var v = tfm[k];
      if (typeof v === "function" || v === undefined) return;
      if (k === "tags" || k === "tag") { tagAdds = tagAdds.concat(splitTags(v)); return; }
      if (current[k] === undefined) set(k, v);
    });
    /* Tags propios (verbatim) + los de la plantilla (anexo) + identificador.
       Se escriben en la propiedad que la nota YA use (`tag` o `tags`, aunque
       esté nula); si no tiene ninguna, se crea `tags`. */
    var tagKey = current.tags !== undefined ? "tags" : (current.tag !== undefined ? "tag" : "tags");
    var tags = splitTags(current[tagKey]);
    var lows = tags.map(function (t) { return t.replace(/^#/, "").toLowerCase(); });
    var added = 0;
    function addTag(t) {
      t = String(t == null ? "" : t).trim().replace(/^#/, "");
      var l = t.toLowerCase();
      if (!l || lows.indexOf(l) >= 0) return;
      tags.push(t); lows.push(l); added++;
    }
    tagAdds.forEach(addTag);
    var s = settings || {};
    if (String(s.taskIdentificationMethod || "tag") === "property") {
      var pn = String(s.taskPropertyName || "").trim(), pv = String(s.taskPropertyValue || "").trim();
      if (pn && current[pn] === undefined) set(pn, pv || true);
    } else {
      var root = String(s.taskTag || "task").trim().replace(/^#/, "");
      if (root) {
        var lroot = root.toLowerCase(), has = false;
        lows.forEach(function (l) { if (l === lroot || l.indexOf(lroot + "/") === 0) has = true; });
        if (!has) addTag(root);
      }
    }
    if (added) set(tagKey, tags);
    return out;
  }
  function taskTemplatePath(path) {
    var p = String(path || "").trim().replace(/^\[\[|\]\]$/g, "");
    if (!p) return "";
    if (!/\.md$/i.test(p)) p += ".md";
    return p;
  }
  /* Plantillas .md disponibles: SOLO las de la carpeta configurada (ruta
     relativa, subcarpetas incluidas, comparación sin distinguir mayúsculas).
     Sin carpeta configurada devuelve []: jamás lista toda la bóveda. */
  function templateMarkdownFiles(app, folder) {
    var out = [];
    var dir = String(folder || "").trim().replace(/^\/+|\/+$/g, "").toLowerCase();
    if (!dir) return out;
    try {
      var files = app && app.vault && typeof app.vault.getMarkdownFiles === "function" ? app.vault.getMarkdownFiles() : [];
      var pre = dir + "/";
      files.forEach(function (f) {
        if (f && f.path && f.path.toLowerCase().indexOf(pre) === 0) out.push(f.path);
      });
    } catch (_) {}
    return out.sort(function (a, b) { return a.localeCompare(b); });
  }
  /* Autocompletado de carpetas EXISTENTES para el ajuste "Carpeta de
     plantillas": prefijo primero, substring después, tope 20. */
  function attachFolderSuggest(app, inputEl) {
    try {
      var folders = [];
      (app.vault.getAllLoadedFiles() || []).forEach(function (f) {
        if (f instanceof Oe.TFolder && f.path !== "/") folders.push(f.path);
      });
      folders.sort(function (a, b) { return a.localeCompare(b); });
      var Sug = class extends Oe.AbstractInputSuggest {
        getSuggestions(query) {
          var q = String(query || "").trim().toLowerCase();
          if (!q) return folders.slice(0, 20);
          var pre = [], sub = [];
          folders.forEach(function (p) {
            var lp = p.toLowerCase();
            if (lp.indexOf(q) === 0) pre.push(p);
            else if (lp.indexOf(q) >= 0) sub.push(p);
          });
          return pre.concat(sub).slice(0, 20);
        }
        renderSuggestion(p, el) { el.setText(p); }
        selectSuggestion(p) {
          inputEl.value = p;
          inputEl.dispatchEvent(new Event("input"));
          this.close();
        }
      };
      return new Sug(app, inputEl);
    } catch (_) { return null; }
  }

  /* ---------- estado y persistencia ---------- */

  /* Vive en settings.pinBoard: saveSettings() del bundle lo conserva al ser
     el mismo objeto, y aquí se guarda con saveData(settings) SIN pasar por
     saveSettings (que reconstruiría el cliente de IA y re-aplicaría estilos
     en cada gesto de arrastre). */
  function ensureState(plugin) {
    var s = plugin.settings;
    if (!s.pinBoard || s.pinBoard.version !== 1 || !s.pinBoard.cards || typeof s.pinBoard.cards !== "object") {
      s.pinBoard = normalizeState(s.pinBoard);
    } else {
      if (!s.pinBoard.edgeStyles || typeof s.pinBoard.edgeStyles !== "object") s.pinBoard.edgeStyles = {};
      if (normalizeColor(s.pinBoard.boardColor) !== s.pinBoard.boardColor) s.pinBoard.boardColor = normalizeColor(s.pinBoard.boardColor);
    }
    return s.pinBoard;
  }
  var saveTimer = null;
  function saveState(plugin, soon) {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (soon) {
      saveTimer = setTimeout(function () { saveTimer = null; saveState(plugin); }, 400);
      return;
    }
    try { Promise.resolve(plugin.saveData(plugin.settings)).catch(warn); } catch (e) { warn(e); }
  }
  function isPinned(plugin, path) {
    if (!plugin || !plugin.settings) return false;
    var s = plugin.settings.pinBoard;
    return !!(s && s.cards && Object.prototype.hasOwnProperty.call(s.cards, path));
  }
  /* Costuras salientes resueltas a rutas (misma semántica que el bundle y el
     mapa mental: frontmatter sewing, escalar o lista, alias/heading vía
     getFirstLinkpathDest). */
  function sewingTargets(app, path) {
    var out = new Set();
    var f = app.vault.getAbstractFileByPath(path);
    if (!(f instanceof Oe.TFile)) return out;
    if (isBasePath(path)) {
      var B = basesApi(pluginInstance);
      if (B && B.sew && B.sew.targets) { try { return B.sew.targets(app, f); } catch (_) {} }
      return out;
    }
    var c = app.metadataCache.getFileCache(f);
    var fm = c && c.frontmatter, sv = fm && fm.sewing;
    if (sv == null) return out;
    var ls = Array.isArray(sv) ? sv : [sv];
    for (var i = 0; i < ls.length; i++) {
      var it = ls[i];
      if (typeof it !== "string") continue;
      var m = it.match(/\[\[([^\]|#]+)/), lt = (m ? m[1] : it).trim();
      if (!lt) continue;
      var tf = app.metadataCache.getFirstLinkpathDest(lt, path);
      if (tf) out.add(tf.path);
    }
    return out;
  }

  function handleOf(plugin) { return plugin._blgPin && plugin._blgPin.attached; }
  function syncButtons(plugin) { var h = handleOf(plugin); if (h) h.syncButton(); }

  /* ---------- acciones públicas ---------- */

  function pinFile(plugin, file) {
    if (!(file instanceof Oe.TFile) || ["md", "base"].indexOf(file.extension.toLowerCase()) === -1) return;
    var st = ensureState(plugin);
    if (st.cards[file.path]) return;
    var h = handleOf(plugin), center = { x: 0, y: 0 }, existing = [];
    Object.keys(st.cards).forEach(function (p) {
      var e = st.cards[p];
      var dom = h && h.cardSize(p);
      existing.push({ x: e.x, y: e.y, w: dom ? dom.w : CARD_W, h: dom ? dom.h : CARD_H_EST });
    });
    if (h && h.active()) center = h.viewCenter();
    var spot = findSpot(existing, center, CARD_W, CARD_H_EST, SPOT_GAP);
    st.cards[file.path] = { x: spot.x, y: spot.y, z: st.nextZ++ };
    saveState(plugin);
    notice("pinAdded", file.basename);
    if (h) h.cardAdded(file.path);
    syncButtons(plugin);
  }
  function unpinPath(plugin, path) {
    var st = ensureState(plugin);
    if (!st.cards[path]) return;
    var name = baseOf(path);
    delete st.cards[path];
    removeEdgeStylesFor(st, path);
    saveState(plugin);
    notice("pinRemoved", name);
    var h = handleOf(plugin);
    if (h) h.cardRemoved(path);
    syncButtons(plugin);
  }
  /* Inserción en el menú cxttap compartido (vista local y vista tag), mismo
     patrón que BLG-DROPS: el bundle llama con {plugin, view, file}. */
  function addPinMenu(menu, opts) {
    opts = opts || {};
    var plugin = opts.plugin || pluginInstance;
    if (!plugin || plugin.session) return;
    var file = opts.file;
    if (!(file instanceof Oe.TFile) || ["md", "base"].indexOf(file.extension.toLowerCase()) === -1) return;
    var pinned = isPinned(plugin, file.path);
    menu.addItem(function (item) {
      item.setIcon(pinned ? "pin-off" : "pin").setTitle(T(pinned ? "ctxUnpinNote" : "ctxPinNote")).onClick(function () {
        if (pinned) unpinPath(plugin, file.path);
        else pinFile(plugin, file);
      });
    });
  }
  /* Abrir robusto (lo usa el MCP): si el panel BLG aún no existe, lo abre y
     espera el attach (que corre en layout-change y en dos reintentos del
     módulo). Devuelve true solo si la pizarra quedó activa. Con el panel ya
     adjunto el enter sigue siendo inmediato (no hay awaits antes). */
  async function openBoard(plugin, tries) {
    plugin = plugin || pluginInstance;
    if (!plugin) return false;
    var h = handleOf(plugin);
    if (h && h.active()) return true;
    if (!h) {
      try { if (plugin.activateView) await plugin.activateView(); } catch (_) {}
      var n = tries == null ? 25 : tries;
      for (var i = 0; i < n && !handleOf(plugin); i++) {
        await new Promise(function (r) { setTimeout(r, 100); });
      }
      h = handleOf(plugin);
    }
    if (!h) return false;
    if (!h.active()) h.enter();
    return !!h.active();
  }
  function closeBoard(plugin) {
    var h = handleOf(plugin || pluginInstance);
    if (h && h.active()) h.exit();
    return true;
  }
  function focusBoardCard(plugin, path) {
    var h = handleOf(plugin || pluginInstance);
    return !!(h && h.active() && typeof h.focus === "function" && h.focus(path));
  }
  function fitBoard(plugin) {
    var h = handleOf(plugin || pluginInstance);
    if (!h || !h.active() || typeof h.fit !== "function") return false;
    h.fit();
    return true;
  }
  /* Estado completo y serializable para el MCP: funciona con la pizarra
     cerrada (lee settings.pinBoard) y no muta nada. */
  function boardState(plugin) {
    plugin = plugin || pluginInstance;
    if (!plugin || !plugin.settings || !plugin.app) return null;
    var st = ensureState(plugin), app = plugin.app;
    var h = handleOf(plugin);
    var paths = Object.keys(st.cards).sort(function (a, b) { return st.cards[a].z - st.cards[b].z; });
    var cards = paths.map(function (p) {
      var e = st.cards[p];
      var f = app.vault.getAbstractFileByPath(p);
      var ok = f instanceof Oe.TFile;
      var ti = ok ? cardTaskInfo(plugin, f) : null;
      return {
        path: p,
        basename: ok ? f.basename : baseOf(p),
        folder: folderOf(p),
        x: Math.round(e.x * 100) / 100, y: Math.round(e.y * 100) / 100, z: e.z,
        color: normalizeColor(e.color),
        available: ok,
        visible: !baseHidden(plugin, p),
        isTask: !!ti,
        task: ti
      };
    });
    var visMap = {};
    cards.forEach(function (c) { visMap[c.path] = c.visible; });
    var edges = deriveEdges(paths, function (p) { return sewingTargets(app, p); }, function (p) { return visibleBaseResults(plugin, p); })
      .filter(function (e) { return visMap[e.from] !== false && visMap[e.to] !== false; })
      .map(function (e) {
      var es = st.edgeStyles[edgeKey(e.from, e.to)] || {};
      return { from: e.from, to: e.to, kind: e.kind, color: normalizeColor(es.color), dash: es.dash === "solid" ? "solid" : "dash" };
    });
    var BB0 = basesApi(plugin);
    return {
      active: !!(h && h.active()),
      pinnedCount: cards.length,
      basesMode: BB0 && BB0.mode ? BB0.mode(plugin.settings) : "all",
      camera: st.camera ? { x: st.camera.x, y: st.camera.y, z: st.camera.z } : null,
      boardColor: st.boardColor || null,
      selected: h && typeof h.selected === "function" ? h.selected() : [],
      cards: cards,
      edges: edges
    };
  }

  /* ---------- ajustes propios: fecha manuscrita de las tarjetas ---------- */
  function injectPinSettings(plugin, containerEl) {
    var nav = containerEl.querySelector(".blg-settings-tabs");
    var panelsHost = containerEl.querySelector(".blg-settings-panels");
    if (!panelsHost) { panelsHost = containerEl; nav = null; }
    var TAB_KEY = "pinboard", myBtn = null, myPanel = null;
    if (nav) {
      myBtn = nav.createEl("button", { cls: "blg-settings-tab", text: T("pinTab") });
      myPanel = panelsHost.createDiv({ cls: "blg-settings-panel" });
      myBtn.addEventListener("click", function () {
        containerEl.querySelectorAll(".blg-settings-tab").forEach(function (b) { b.removeClass("active"); });
        containerEl.querySelectorAll(".blg-settings-panel").forEach(function (p) { p.removeClass("active"); });
        myBtn.addClass("active"); myPanel.addClass("active");
        try { plugin.settings.lastSettingsTab = TAB_KEY; plugin.saveSettings(); } catch (e) { warn(e); }
      });
      nav.querySelectorAll(".blg-settings-tab").forEach(function (b) {
        if (b === myBtn) return;
        b.addEventListener("click", function () { myBtn.removeClass("active"); myPanel.removeClass("active"); });
      });
    } else {
      myPanel = panelsHost.createDiv({ cls: "blg-bg-section" });
      myPanel.style.cssText = "margin-top:18px;border-top:1px solid var(--background-modifier-border);padding-top:12px";
    }
    myPanel.createEl("h3", { text: T("pinSettingsTitle") });
    new Oe.Setting(myPanel).setName(T("pinDateFont")).setDesc(T("pinDateFontDesc")).addText(function (t) {
      t.setPlaceholder(DEFAULT_DATE_FONT).setValue(plugin.settings.pinDateFont || "")
        .onChange(async function (v) { plugin.settings.pinDateFont = v.trim(); await plugin.saveSettings(); });
    });
    new Oe.Setting(myPanel).setName(T("pinDateColor")).setDesc(T("pinDateColorDesc")).addColorPicker(function (c) {
      c.setValue(dateColor(plugin.settings))
        .onChange(async function (v) { plugin.settings.pinDateColor = normalizeColor(v) || DEFAULT_DATE_COLOR; await plugin.saveSettings(); });
    });
    if (taskNotesPlugin(plugin)) {
      myPanel.createEl("h3", { text: T("pinTaskSettingsTitle") });
      new Oe.Setting(myPanel).setName(T("pinTasksEnabled")).setDesc(T("pinTasksEnabledDesc")).addToggle(function (t) {
        t.setValue(plugin.settings.pinTasksEnabled !== false)
          .onChange(async function (v) { plugin.settings.pinTasksEnabled = !!v; await plugin.saveSettings(); });
      });
      new Oe.Setting(myPanel).setName(T("pinTaskColor")).setDesc(T("pinTaskColorDesc")).addColorPicker(function (c) {
        c.setValue(taskSettings(plugin.settings).color)
          .onChange(async function (v) { plugin.settings.pinTaskColor = normalizeColor(v) || DEFAULT_TASK_COLOR; await plugin.saveSettings(); });
      });
      new Oe.Setting(myPanel).setName(T("pinTaskIcon")).setDesc(T("pinTaskIconDesc")).addText(function (t) {
        t.setPlaceholder("list-checks").setValue(plugin.settings.pinTaskIcon || "")
          .onChange(async function (v) { plugin.settings.pinTaskIcon = v.trim(); await plugin.saveSettings(); });
      });
      /* Carpeta de plantillas: la búsqueda se limita a ella (nunca toda la
         bóveda). Cambiarla limpia la plantilla elegida si queda fuera. */
      var tplSetting = null;
      function rebuildTemplateDropdown() {
        if (!tplSetting) return;
        var dir = String(plugin.settings.pinTaskTemplateFolder || "").trim();
        var files = templateMarkdownFiles(plugin.app, dir);
        var cur = taskTemplatePath(plugin.settings.pinTaskTemplate || "");
        if (dir && cur && files.indexOf(cur) < 0) {
          plugin.settings.pinTaskTemplate = ""; cur = "";
          try { Promise.resolve(plugin.saveSettings()).catch(warn); } catch (e) { warn(e); }
        }
        tplSetting.controlEl.empty();
        tplSetting.addDropdown(function (d) {
          d.addOption("", dir ? T("pinTaskTemplateNone") : T("pinTaskTemplatePickFolder"));
          files.forEach(function (p) { d.addOption(p, p); });
          d.setValue(cur);
          d.selectEl.style.maxWidth = "280px";
          d.onChange(async function (v) { plugin.settings.pinTaskTemplate = v; await plugin.saveSettings(); });
        });
      }
      new Oe.Setting(myPanel).setName(T("pinTaskTemplateFolder")).setDesc(T("pinTaskTemplateFolderDesc")).addText(function (t) {
        t.setPlaceholder("Templater").setValue(plugin.settings.pinTaskTemplateFolder || "")
          .onChange(async function (v) {
            plugin.settings.pinTaskTemplateFolder = v.trim().replace(/^\/+|\/+$/g, "");
            await plugin.saveSettings();
            rebuildTemplateDropdown();
          });
        attachFolderSuggest(plugin.app, t.inputEl);
      });
      tplSetting = new Oe.Setting(myPanel).setName(T("pinTaskTemplate")).setDesc(T("pinTaskTemplateDesc"));
      rebuildTemplateDropdown();
    }
    var wasActive = false;
    try { wasActive = plugin.settings.lastSettingsTab === TAB_KEY; } catch (e) {}
    if (myBtn && wasActive) {
      containerEl.querySelectorAll(".blg-settings-tab").forEach(function (b) { b.removeClass("active"); });
      containerEl.querySelectorAll(".blg-settings-panel").forEach(function (p) { p.removeClass("active"); });
      myBtn.addClass("active"); myPanel.addClass("active");
    } else if (myBtn) {
      myBtn.removeClass("active"); myPanel.removeClass("active");
    }
  }
  function hookPinSettingTab(plugin) {
    var orig = plugin.addSettingTab.bind(plugin);
    plugin.addSettingTab = function (tab) {
      try {
        if (tab && tab.plugin === plugin && typeof tab.display === "function" && !tab._blgPinHooked) {
          var display = tab.display;
          tab.display = function () {
            var r = display.apply(this, arguments);
            try { injectPinSettings(plugin, this.containerEl); } catch (e) { warn(e); }
            return r;
          };
          tab._blgPinHooked = true;
        }
      } catch (e) { warn(e); }
      return orig(tab);
    };
  }

  var sharedApi = { addPinMenu: addPinMenu, isPinned: isPinned, pin: pinFile, unpin: unpinPath,
    openBoard: openBoard, closeBoard: closeBoard, boardState: boardState,
    focusCard: focusBoardCard, fitBoard: fitBoard,
    /* El check ✅ de la tarjeta también desde el MCP (misma escritura que el
       clic: API de TaskNotes → toggle de la instancia). */
    setTaskCompleted: setTaskCompletedByPath,
    layoutButtons: function () { if (pluginInstance) syncButtons(pluginInstance); } };
  if (typeof globalThis !== "undefined") globalThis.__BLG_PINBOARD = sharedApi;

  /* ---------- modo pizarra dentro de la vista ---------- */

  function attachView(plugin, view) {
    if (!view || !view.graphEl || !view.contentEl || view._blgPinAttached) return null;
    view._blgPinAttached = true;
    var host = view.contentEl, graph = view.graphEl, settings = plugin.settings;
    var board = host.createDiv({ cls: "blg-pinboard" });
    board.hidden = true; board.tabIndex = -1;
    var dots = board.createDiv({ cls: "blg-pinboard-dots" });
    var world = board.createDiv({ cls: "blg-pinboard-world" });
    var edgeSvg = svg("svg", world, { class: "blg-pinboard-edges", "aria-hidden": "true" });
    var edgeG = svg("g", edgeSvg);
    var cardLayer = world.createDiv({ cls: "blg-pinboard-cards" });
    var empty = board.createDiv({ cls: "blg-pinboard-empty" });
    var controls = board.createDiv({ cls: "blg-pinboard-controls" });
    var fitBtn = controls.createEl("button", { cls: "blg-pinboard-fit" });
    fitBtn.type = "button";
    try { Oe.setIcon(fitBtn, "scan"); } catch (_) {}
    fitBtn.title = T("pinFit"); fitBtn.setAttribute("aria-label", T("pinFit"));
    var button = host.createEl("button", { cls: "blg-pin-toggle" });
    button.type = "button";

    var st = {
      active: false, x: 0, y: 0, z: 1, dom: new Map(), edges: [], edgeRaf: null,
      edgeTimer: null, camTimer: null, camAnim: null, destroyers: [],
      destroying: false, selected: []
    };
    function rememberDestroyer(fn) { st.destroyers.push(fn); return fn; }
    function forgetDestroyer(fn) { var i = st.destroyers.indexOf(fn); if (i >= 0) st.destroyers.splice(i, 1); }

    /* El botón vive en contentEl (sigue visible por encima de la pizarra) pero
       se alinea al borde inferior DEL GRAFO, igual que el de directorios. */
    function layoutTop() { board.style.top = (graph.offsetTop || 0) + "px"; }
    function layoutButton() {
      var h = host.clientHeight || 0;
      var g = (graph.offsetTop || 0) + (graph.offsetHeight || 0);
      button.style.bottom = Math.max(6, h - g + 12) + "px";
    }
    var ro = new ResizeObserver(function () { layoutTop(); layoutButton(); });
    ro.observe(graph); layoutTop(); layoutButton();

    function viewport() { return { w: board.clientWidth || 1, h: board.clientHeight || 1 }; }
    function applyCam() {
      world.style.transform = "translate(" + st.x + "px," + st.y + "px) scale(" + st.z + ")";
      dots.style.backgroundPosition = st.x + "px " + st.y + "px";
    }
    function setCam(x, y, z) { st.x = x; st.y = y; st.z = clamp(z, 0.2, 4); applyCam(); }
    function saveCamSoon() {
      var state = ensureState(plugin);
      state.camera = { x: st.x, y: st.y, z: st.z };
      if (st.camTimer) clearTimeout(st.camTimer);
      st.camTimer = setTimeout(function () { st.camTimer = null; saveState(plugin, true); }, 250);
    }
    function cancelCamAnim() {
      if (st.camAnim != null) { cancelAnimationFrame(st.camAnim); st.camAnim = null; }
    }
    /* Transición suave de cámara (~220 ms, easeOutCubic) para el enfoque. */
    function tweenCam(tx, ty, tz) {
      cancelCamAnim();
      var x0 = st.x, y0 = st.y, z0 = st.z, t0 = performance.now();
      function step(t) {
        var k = Math.min(1, (t - t0) / 220);
        var e = 1 - Math.pow(1 - k, 3);
        st.x = x0 + (tx - x0) * e; st.y = y0 + (ty - y0) * e; st.z = z0 + (tz - z0) * e;
        applyCam();
        if (k < 1 && !st.destroying) st.camAnim = requestAnimationFrame(step);
        else { st.camAnim = null; saveCamSoon(); }
      }
      st.camAnim = requestAnimationFrame(step);
    }
    function viewCenter() {
      var v = viewport();
      return { x: (v.w / 2 - st.x) / st.z, y: (v.h / 2 - st.y) / st.z };
    }
    function cardRects() {
      var state = ensureState(plugin), out = [];
      Object.keys(state.cards).forEach(function (p) {
        if (baseHidden(plugin, p)) return;
        var e = state.cards[p], rec = st.dom.get(p);
        out.push({ x: e.x, y: e.y, w: rec ? rec.el.offsetWidth || CARD_W : CARD_W, h: rec ? rec.el.offsetHeight || CARD_H_EST : CARD_H_EST });
      });
      return out;
    }
    function cardSize(p) {
      var rec = st.dom.get(p);
      return rec ? { w: rec.el.offsetWidth || CARD_W, h: rec.el.offsetHeight || CARD_H_EST } : null;
    }
    function applyBoardStyle() {
      var state = ensureState(plugin);
      board.style.background = state.boardColor || "";
      board.style.setProperty("--blg-pin-sew-color", settings.mmSewingColor || "#e0245e");
      board.style.setProperty("--blg-pin-date-font", dateFont(settings));
      board.style.setProperty("--blg-pin-date-color", dateColor(settings));
    }
    function applyHandwriting(rec) {
      rec.dateEl.style.fontFamily = dateFont(settings);
      rec.dateEl.style.color = dateColor(settings);
    }
    function applyCardColor(rec) {
      var state = ensureState(plugin), e = state.cards[rec.path];
      var color = e && normalizeColor(e.color);
      if (color) {
        rec.el.style.setProperty("--blg-pin-card-bg", color);
        rec.el.style.setProperty("--blg-pin-card-border", color);
      } else {
        rec.el.style.removeProperty("--blg-pin-card-bg");
        rec.el.style.removeProperty("--blg-pin-card-border");
      }
    }

    function updateEmpty() {
      var cards = ensureState(plugin).cards;
      var has = Object.keys(cards).some(function (p) { return !baseHidden(plugin, p); });
      empty.hidden = has;
      if (!has) {
        empty.empty();
        var ic = empty.createDiv({ cls: "blg-pinboard-empty-icon" });
        try { Oe.setIcon(ic, "pin"); } catch (_) {}
        empty.createDiv({ cls: "blg-pinboard-empty-title", text: T("pinEmptyTitle") });
        empty.createDiv({ cls: "blg-pinboard-empty-hint", text: T("pinEmptyHint") });
      }
    }

    /* --- aristas de costura: diff por lista, redibujado de rutas en un RAF --- */
    function reconcileEdges() {
      var state = ensureState(plugin);
      st.edges = deriveEdges(Object.keys(state.cards), function (p) { return sewingTargets(plugin.app, p); }, function (p) { return visibleBaseResults(plugin, p); });
      drawEdges();
    }
    function edgesSoon() {
      if (st.edgeTimer) clearTimeout(st.edgeTimer);
      st.edgeTimer = setTimeout(function () { st.edgeTimer = null; if (st.active && !st.destroying) reconcileEdges(); }, 500);
    }
    function scheduleDraw() {
      if (st.edgeRaf != null) return;
      st.edgeRaf = requestAnimationFrame(function () { st.edgeRaf = null; drawEdgesNow(); });
    }
    function drawEdges() { scheduleDraw(); }
    function drawEdgesNow() {
      if (st.destroying) return;
      var state = ensureState(plugin);
      edgeG.empty();
      st.edges.forEach(function (e) {
        var a = state.cards[e.from], b = state.cards[e.to];
        if (!a || !b) return;
        var ra = st.dom.get(e.from), rb = st.dom.get(e.to);
        if ((!ra && isBasePath(e.from)) || (!rb && isBasePath(e.to))) return;
        var aw = ra ? ra.el.offsetWidth || CARD_W : CARD_W, ah = ra ? ra.el.offsetHeight || CARD_H_EST : CARD_H_EST;
        var bw = rb ? rb.el.offsetWidth || CARD_W : CARD_W, bh = rb ? rb.el.offsetHeight || CARD_H_EST : CARD_H_EST;
        var ac = { x: a.x + aw / 2, y: a.y + ah / 2 }, bc = { x: b.x + bw / 2, y: b.y + bh / 2 };
        var p1 = borderPoint(ac.x, ac.y, aw, ah, bc.x, bc.y);
        var p2 = borderPoint(bc.x, bc.y, bw, bh, ac.x, ac.y);
        var d = sewCurve(p1.x, p1.y, p2.x, p2.y), key = edgeKey(e.from, e.to);
        var es = state.edgeStyles[key] || {};
        var B = basesApi(plugin);
        var isBaseEdge = e.kind === "base";
        var color = normalizeColor(es.color) || (isBaseEdge && B ? B.color(settings) : settings.mmSewingColor || "#e0245e");
        var solid = es.dash === "solid" || isBaseEdge;
        var hit = svg("path", edgeG, { class: "blg-pinboard-edge-hit", d: d, "vector-effect": "non-scaling-stroke" });
        hit.addEventListener("contextmenu", function (ev) { ev.preventDefault(); ev.stopPropagation(); edgeMenu(ev, e); });
        var line = svg("path", edgeG, { class: "blg-pinboard-edge", d: d, "vector-effect": "non-scaling-stroke" });
        line.classList.toggle("is-solid", solid);
        line.classList.toggle("is-base", isBaseEdge);
        line.style.setProperty("--blg-pin-sew-color", color);
        line.style.setProperty("--blg-pin-base-color", color);
        line.style.setProperty("stroke-dasharray", solid ? "none" : "7 5");
        var ang = Math.atan2(bc.y - p2.y, bc.x - p2.x), size = 8;
        var a1 = ang + Math.PI * 0.8, a2 = ang - Math.PI * 0.8;
        var arrow = svg("polygon", edgeG, { class: "blg-pinboard-arrow", points:
          p2.x + "," + p2.y + " " + (p2.x + size * Math.cos(a1)) + "," + (p2.y + size * Math.sin(a1)) +
          " " + (p2.x + size * Math.cos(a2)) + "," + (p2.y + size * Math.sin(a2)) });
        arrow.style.setProperty("--blg-pin-sew-color", color);
        arrow.style.setProperty("fill", color);
      });
    }

    /* --- tarjetas --- */
    /* Icono de la nota (frontmatter `icon`): reutiliza el resolver del bundle
       (Lucide, emoji, Notebook Navigator/Iconize). Tinte = color de la fecha,
       para que la fila manuscrita se vea coherente. Null si no hay icono o el
       resolver aún no está listo (la tarjeta se rellena de nuevo al asentarse
       la caché de metadatos). */
    function cardIconUri(file) {
      try {
        var B = basesApi(plugin);
        if (B && file && file.extension && file.extension.toLowerCase() === "base") return B.icon(settings, dateColor(settings)) || null;
        if (typeof _blgFmIcon !== "function") return null;
        var fm = (plugin.app.metadataCache.getFileCache(file) || {}).frontmatter;
        if (!fm || fm.icon == null) return null;
        return _blgFmIcon(fm.icon, dateColor(settings)) || null;
      } catch (_) { return null; }
    }
    /* Lectura única por relleno: la caché de TaskNotes completa el título, pero
       el frontmatter ya basta para el distintivo si la caché aún no está lista. */
    function taskInfoFor(file, fm) {
      var out = { isTask: false, task: null, settings: taskNotesSettings(plugin) };
      if (!taskSettings(settings).enabled || !file || !out.settings) return out;
      var tn = taskNotesPlugin(plugin), cached = null;
      try {
        var cm = tn && tn.cacheManager;
        if (cm && typeof cm.getCachedTaskInfoSync === "function") cached = cm.getCachedTaskInfoSync(file.path);
      } catch (_) { cached = null; }
      out.task = cached || null;
      if (!cached) {
        var api = taskNotesApi(plugin);
        if (api && api.tasks && typeof api.tasks.get === "function") {
          try {
            var maybe = api.tasks.get(file.path);
            if (maybe && typeof maybe.then === "function") maybe.then(function (task) {
              if (task && !st.destroying) {
                var cur = st.dom.get(file.path);
                if (cur) fillCard(cur, plugin.app.vault.getAbstractFileByPath(file.path));
              }
            }).catch(function () {});
          } catch (_) {}
        }
      }
      out.isTask = isTaskNote(plugin, file, fm, out.task, out.settings);
      return out;
    }
    function taskMenuPopulate(menu, rec, file) {
      var api = taskNotesApi(plugin);
      if (!api || !api.ui || !api.ui.taskMenu || typeof api.ui.taskMenu.populate !== "function") return false;
      Promise.resolve(api.ui.taskMenu.populate(menu, {
        taskPath: file.path,
        onUpdate: function () { var r = st.dom.get(rec.path); if (r && !st.destroying) fillCard(r, plugin.app.vault.getAbstractFileByPath(rec.path)); }
      })).catch(warn);
      return true;
    }
    function askCardTaskTitle(file, prefill) { return askTaskTitle(Oe, plugin.app, file, prefill); }
    /* El check del encabezado: marca ✅ o reabre la tarea con la MISMA
       escritura que TaskNotes. Bidireccional: la escritura toca frontmatter
       (metadataCache "changed" repinta la tarjeta) y TaskNotes emite
       "task-updated" (suscripción en attachView); los cambios hechos desde
       TaskNotes llegan por ese mismo camino. */
    async function toggleCardTask(rec) {
      var file = currentFile(rec);
      if (!file || isBasePath(file.path)) return;
      var fm = ((plugin.app.metadataCache.getFileCache(file) || {}).frontmatter) || null;
      var ti = taskInfoFor(file, fm);
      if (!ti.isTask) return;
      var done = taskIsCompleted(plugin, taskStatusValue(ti.task, fm, ti.settings), ti.settings);
      var r = await setTaskCompleted(plugin, file, !done);
      if (!r) { notice("pinTaskNotesUnavailable"); return; }
      fillCard(rec, file);
      /* La caché de TaskNotes se asienta asíncrona: un repintado diferido
         asegura el estado final aunque el primero leyera la caché vieja. */
      setTimeout(function () {
        if (st.destroying) return;
        var cur = st.dom.get(rec.path);
        if (cur) fillCard(cur, plugin.app.vault.getAbstractFileByPath(rec.path));
      }, 350);
    }
    /* Convierte la nota de ESA tarjeta: conserva ruta, costuras, cuerpo y
       propiedades; solo ANEXA las propiedades de la plantilla elegida en
       opciones (las existentes nunca se reemplazan). Si la nota o la
       plantilla tienen la propiedad `title` (TaskNotes la requiere), primero
       pide el nombre de la tarea y lo guarda en `title`. */
    async function convertCardToTask(rec) {
      var file = currentFile(rec);
      if (!file || isBasePath(file.path)) return;
      var tnSettings = taskNotesSettings(plugin);
      if (!taskNotesEnabled(plugin) || !tnSettings) { notice("pinTaskNotesUnavailable"); return; }
      var fm = ((plugin.app.metadataCache.getFileCache(file) || {}).frontmatter) || {};
      var conf = taskSettings(settings), templateFm = null;
      if (conf.template) {
        var tf = plugin.app.vault.getAbstractFileByPath(taskTemplatePath(conf.template));
        if (!(tf instanceof Oe.TFile)) { notice("pinTaskTemplateMissing", taskTemplatePath(conf.template)); return; }
        var parsed = parseFrontmatterBlock(await plugin.app.vault.read(tf)) || { frontmatter: {} };
        templateFm = parsed.frontmatter;
      }
      var ask = taskTitleProp(fm, templateFm);
      var patch = taskTemplatePatch(fm, templateFm, tnSettings) || {};
      if (ask) {
        var title = await askCardTaskTitle(file, ask.prefill);
        if (title == null) return;
        patch.title = title;
      }
      var changed = false;
      if (Object.keys(patch).length) {
        if (plugin.app.fileManager && typeof plugin.app.fileManager.processFrontMatter === "function") {
          await plugin.app.fileManager.processFrontMatter(file, function (frontmatter) {
            Object.keys(patch).forEach(function (k) { frontmatter[k] = patch[k]; });
          });
        } else {
          throw new Error("processFrontMatter unavailable");
        }
        changed = true;
      }
      notice("pinTaskConverted", file.basename);
      fillCard(rec, file);
      if (changed && view && typeof view._scheduleRefresh === "function") view._scheduleRefresh(true);
    }
    function renderBaseCard(rec, file) {
      rec.previewEl.empty();
      var B = basesApi(plugin), count = B ? B.resultsFor(plugin, rec.path).length : 0;
      var line = rec.previewEl.createDiv({ cls: "blg-pin-card-base-meta" });
      var ic = line.createSpan({ cls: "blg-pin-card-base-icon" });
      try { Oe.setIcon(ic, "database"); } catch (_) {}
      line.createSpan({ text: (settings.uiLang === "en" ? "Base · " : "Base · ") + count + (count === 1 ? (settings.uiLang === "en" ? " result" : " resultado") : (settings.uiLang === "en" ? " results" : " resultados")) });
    }
    function renderCardProps(rec, file) {
      rec.previewEl.empty();
      var fm = (plugin.app.metadataCache.getFileCache(file) || {}).frontmatter;
      var names = tooltipFieldNames(settings), any = false;
      names.forEach(function (nm) {
        var vals = frontmatterValues(fm, nm);
        if (!vals.length) return;
        any = true;
        var line = rec.previewEl.createDiv({ cls: "blg-pin-card-prop" });
        line.createSpan({ cls: "blg-pin-card-prop-name", text: nm + ":" });
        line.createSpan({ text: " " + vals.join(", ") });
      });
      if (!any) rec.previewEl.createDiv({ cls: "blg-pin-card-prop is-empty", text: "—" });
    }
    function fillCard(rec, file) {
      var ok = file instanceof Oe.TFile;
      var isBase = ok && file.extension && file.extension.toLowerCase() === "base";
      var B = basesApi(plugin);
      var fm = ok ? ((plugin.app.metadataCache.getFileCache(file) || {}).frontmatter || null) : null;
      var taskInfo = ok && !isBase ? taskInfoFor(file, fm) : { isTask: false, task: null, settings: null };
      var task = taskInfo.isTask;
      rec.isTask = task;
      rec.el.classList.toggle("is-unavailable", !ok);
      rec.el.classList.toggle("is-base", isBase);
      rec.el.classList.toggle("is-task", task);
      /* Check ✅ del encabezado: solo en tareas; refleja el estado real de
         TaskNotes (statusManager → customStatuses → convenio). */
      var taskDone = !!task && taskIsCompleted(plugin, taskStatusValue(taskInfo.task, fm, taskInfo.settings), taskInfo.settings);
      rec.el.classList.toggle("is-done", taskDone);
      rec.checkEl.hidden = !task;
      if (task) {
        rec.checkEl.setAttribute("aria-pressed", taskDone ? "true" : "false");
        var checkLbl = T(taskDone ? "pinTaskReopen" : "pinTaskDone");
        rec.checkEl.title = checkLbl;
        rec.checkEl.setAttribute("aria-label", checkLbl);
      }
      rec.el.style.setProperty("--blg-pin-base-color", B ? B.color(settings) : "#8b5cf6");
      rec.el.style.setProperty("--blg-pin-task-color", taskSettings(settings).color);
      rec.titleEl.setText(ok ? file.basename : baseOf(rec.path));
      var folder = folderOf(rec.path);
      rec.folderEl.setText(folder || T("moveRoot"));
      rec.folderEl.title = folder || T("moveRoot");
      var fc = task ? taskSettings(settings).color : (isBase && B ? B.color(settings) : (settings.dropsFolderColors || {})[folder] || settings.dropsColor || "#63bfe7");
      rec.dot.style.background = fc;
      rec.openBtn.disabled = !ok;
      applyHandwriting(rec);
      applyCardColor(rec);
      /* Encabezado superior: las tareas muestran el TÍTULO de TaskNotes;
         el resto conserva la fecha de última edición manuscrita. */
      rec.dateTextEl.setText(ok ? (task ? taskTitle(taskInfo.task, file, fm) : formatMtime(file.stat && file.stat.mtime, settings.uiLang)) : "—");
      rec.dateEl.title = ok && task ? T("pinTaskTitle") : T("pinModified");
      var iconUri = ok ? (task ? (taskIconUri(plugin, settings, taskInfo.task) || cardIconUri(file)) : cardIconUri(file)) : null;
      if (iconUri) {
        rec.dateIconEl.hidden = false;
        rec.dateIconEl.style.backgroundImage = "url(\"" + iconUri + "\")";
      } else {
        rec.dateIconEl.hidden = true;
        rec.dateIconEl.style.backgroundImage = "";
      }
      if (!ok) {
        rec.previewEl.empty();
        rec.previewEl.setText(T("pinUnavailable"));
        scheduleDraw();
        return;
      }
      if (isBase) renderBaseCard(rec, file);
      else renderCardProps(rec, file);
      scheduleDraw();
    }
    function bringToFront(rec) {
      var state = ensureState(plugin), e = state.cards[rec.path];
      if (!e) return;
      e.z = state.nextZ++;
      rec.el.style.zIndex = e.z;
      saveState(plugin, true);
    }
    /* Primer clic sobre la tarjeta = "quiero leerla": la centra siempre;
       acerca solo si está lejos y encuadra lo mínimo si está demasiado cerca. */
    function focusCard(rec) {
      var state = ensureState(plugin), ce = state.cards[rec.path];
      if (!ce) return;
      bringToFront(rec);
      var t = focusCam({ x: ce.x, y: ce.y,
        w: rec.el.offsetWidth || CARD_W, h: rec.el.offsetHeight || CARD_H_EST },
        viewport(), st.z);
      tweenCam(t.x, t.y, t.z);
    }
    function openNote(path) {
      var f = plugin.app.vault.getAbstractFileByPath(path);
      if (!(f instanceof Oe.TFile)) return;
      var ws = plugin.app.workspace, leaf = null;
      var recent = ws.getMostRecentLeaf && ws.getMostRecentLeaf();
      if (recent && recent.view && recent.view.getViewType && recent.view.getViewType() === "markdown") leaf = recent;
      if (!leaf) { var md = ws.getLeavesOfType("markdown"); if (md.length) leaf = md[md.length - 1]; }
      if (!leaf) leaf = ws.getLeaf("tab");
      leaf.openFile(f).catch(warn);
      if (ws.revealLeaf) ws.revealLeaf(leaf);
    }
    function cardDown(e, rec) {
      if (e.button !== 0) return;
      if (e.target.closest(".blg-pin-card-btn")) return;
      e.preventDefault(); e.stopPropagation();
      var state = ensureState(plugin), ce = state.cards[rec.path];
      if (!ce) return;
      bringToFront(rec);
      var sx = e.clientX, sy = e.clientY, ox = ce.x, oy = ce.y, moved = false;
      function mv(ev) {
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
        moved = true;
        rec.el.classList.add("is-dragging");
        ce.x = ox + (ev.clientX - sx) / st.z;
        ce.y = oy + (ev.clientY - sy) / st.z;
        rec.el.style.transform = "translate(" + ce.x + "px," + ce.y + "px)";
        drawEdges();
      }
      function up() {
        cleanup();
        rec.el.classList.remove("is-dragging");
        if (moved) {
          /* El click que sigue al pointerup no debe re-enfocar tras arrastrar. */
          rec._dragged = true;
          setTimeout(function () { rec._dragged = false; }, 0);
          if (!st.destroying) saveState(plugin);
        }
      }
      function cleanup() {
        window.removeEventListener("pointermove", mv, true);
        window.removeEventListener("pointerup", up, true);
        forgetDestroyer(cleanup);
      }
      window.addEventListener("pointermove", mv, true);
      window.addEventListener("pointerup", up, true);
      rememberDestroyer(cleanup);
    }

    function currentFile(rec) {
      var f = plugin.app.vault.getAbstractFileByPath(rec.path);
      return f instanceof Oe.TFile ? f : null;
    }
    function toggleSelected(rec) {
      var i = st.selected.indexOf(rec.path);
      if (i >= 0) st.selected.splice(i, 1); else st.selected.push(rec.path);
      rec.el.classList.toggle("is-selected", i < 0);
    }
    function clearSelection() {
      st.selected.forEach(function (p) { var r = st.dom.get(p); if (r) r.el.classList.remove("is-selected"); });
      st.selected = [];
    }
    function pickColor(title, initial, cb) {
      var m = new Oe.Modal(plugin.app), value = normalizeColor(initial) || "#63bfe7";
      m.titleEl.setText(title);
      new Oe.Setting(m.contentEl).setName(title).addColorPicker(function (c) {
        c.setValue(value).onChange(function (v) { value = normalizeColor(v) || value; });
      });
      var row = m.contentEl.createDiv({ cls: "blg-pin-color-actions" });
      var ok = row.createEl("button", { text: T("pinApply"), cls: "mod-cta" });
      ok.addEventListener("click", function () { m.close(); cb(value); });
      var cancel = row.createEl("button", { text: T("cancel") });
      cancel.addEventListener("click", function () { m.close(); });
      m.open();
    }
    function setCardColor(rec, color) {
      var state = ensureState(plugin), e = state.cards[rec.path];
      if (!e) return;
      var c = normalizeColor(color);
      if (c) e.color = c; else delete e.color;
      saveState(plugin); applyCardColor(rec);
    }
    async function sewPairs(pairs) {
      var done = 0;
      for (var i = 0; i < pairs.length; i++) {
        var a = plugin.app.vault.getAbstractFileByPath(pairs[i][0]);
        var b = plugin.app.vault.getAbstractFileByPath(pairs[i][1]);
        if (!(a instanceof Oe.TFile) || !(b instanceof Oe.TFile) || a.path === b.path) continue;
        try { await plugin.coserInmediata(a, b, true); done++; }
        catch (e) { warn(e); }
      }
      clearSelection();
      if (done) notice("sewBySelection", done);
      edgesSoon();
    }
    function confirmSelectedRelations() {
      var paths = st.selected.filter(function (p) { return !!ensureState(plugin).cards[p]; });
      if (paths.length < 2) return;
      var files = paths.map(function (p) { return plugin.app.vault.getAbstractFileByPath(p); })
        .filter(function (f) { return f instanceof Oe.TFile; });
      if (files.length !== paths.length) { notice("pinUnavailable"); return; }
      if (paths.length === 2) {
        var a = files[0], b = files[1];
        if (typeof Vq === "function") new Vq(plugin.app, msg("pinSewTwo", a.basename, b.basename), function () { sewPairs(relationPairs(paths)); }).open();
        else sewPairs(relationPairs(paths));
        return;
      }
      var m = new Oe.Modal(plugin.app);
      m.titleEl.setText(msg("pinRelateCount", paths.length));
      var box = m.contentEl.createDiv({ cls: "blg-pin-relate-actions" });
      var all = box.createEl("button", { text: msg("pinSewParentAll", files[0].basename, paths.length - 1), cls: "mod-cta" });
      all.addEventListener("click", function () { m.close(); sewPairs(relationPairs(paths, "parent")); });
      var chain = box.createEl("button", { text: T("pinSewChain") });
      chain.addEventListener("click", function () { m.close(); sewPairs(relationPairs(paths, "chain")); });
      var cancel = box.createEl("button", { text: T("cancel") });
      cancel.addEventListener("click", function () { m.close(); });
      m.open();
    }
    function cardMenu(e, rec) {
      e.preventDefault(); e.stopPropagation(); bringToFront(rec);
      var menu = new Oe.Menu(), file = currentFile(rec), state = ensureState(plugin);
      if (file && !isBasePath(file.path) && taskSettings(settings).enabled) {
        var fm = ((plugin.app.metadataCache.getFileCache(file) || {}).frontmatter) || null;
        var ti = taskInfoFor(file, fm);
        if (ti.isTask) taskMenuPopulate(menu, rec, file);
        else if (ti.settings) {
          menu.addItem(function (item) {
            item.setTitle(T("pinConvertTask")).setIcon("list-checks").onClick(function () { convertCardToTask(rec).catch(warn); });
          });
        }
        menu.addSeparator();
      }
      if (file && typeof Wq === "function") {
        menu.addItem(function (item) {
          item.setTitle(T("ctxEditYaml")).setIcon("pencil").onClick(function () { new Wq(plugin.app, file, view).open(); });
        });
      }
      menu.addItem(function (item) {
        item.setTitle(T("pinCardColor")).setIcon("palette").onClick(function () {
          var cur = state.cards[rec.path] && state.cards[rec.path].color;
          pickColor(T("pinCardColor"), cur || settings.dropsColor || "#63bfe7", function (c) { setCardColor(rec, c); });
        });
      });
      if (state.cards[rec.path] && state.cards[rec.path].color) {
        menu.addItem(function (item) {
          item.setTitle(T("pinResetColor")).setIcon("rotate-ccw").onClick(function () { setCardColor(rec, null); });
        });
      }
      if (st.selected.length >= 2) {
        menu.addItem(function (item) {
          item.setTitle(msg("pinRelateCount", st.selected.length)).setIcon("git-merge").onClick(confirmSelectedRelations);
        });
      }
      menu.addItem(function (item) {
        item.setTitle(T("pinUnpin")).setIcon("pin-off").onClick(function () { unpinPath(plugin, rec.path); });
      });
      menu.showAtPosition({ x: e.clientX, y: e.clientY });
    }
    function setEdgeStyle(edge, patch) {
      var state = ensureState(plugin), key = edgeKey(edge.from, edge.to);
      var out = Object.assign({}, state.edgeStyles[key] || {});
      if (Object.prototype.hasOwnProperty.call(patch, "color")) {
        var c = normalizeColor(patch.color);
        if (c) out.color = c; else delete out.color;
      }
      if (patch.dash) out.dash = patch.dash === "solid" ? "solid" : "dash";
      if (Object.keys(out).length) state.edgeStyles[key] = out; else delete state.edgeStyles[key];
      saveState(plugin); drawEdges();
    }
    function edgeMenu(e, edge) {
      var menu = new Oe.Menu(), state = ensureState(plugin), es = state.edgeStyles[edgeKey(edge.from, edge.to)] || {};
      menu.addItem(function (item) {
        item.setTitle(T("pinEdgeColor")).setIcon("palette").onClick(function () {
          pickColor(T("pinEdgeColor"), es.color || settings.mmSewingColor || "#e0245e", function (c) { setEdgeStyle(edge, { color: c }); });
        });
      });
      menu.addItem(function (item) {
        item.setTitle(T("pinLineSolid")).setIcon("minus").onClick(function () { setEdgeStyle(edge, { dash: "solid" }); });
      });
      menu.addItem(function (item) {
        item.setTitle(T("pinLineDashed")).setIcon("ellipsis").onClick(function () { setEdgeStyle(edge, { dash: "dash" }); });
      });
      if (Object.keys(es).length) {
        menu.addItem(function (item) {
          item.setTitle(T("pinResetStyle")).setIcon("rotate-ccw").onClick(function () {
            var state2 = ensureState(plugin); delete state2.edgeStyles[edgeKey(edge.from, edge.to)]; saveState(plugin); drawEdges();
          });
        });
      }
      menu.showAtPosition({ x: e.clientX, y: e.clientY });
    }
    function setBoardColor(color) {
      var state = ensureState(plugin);
      state.boardColor = normalizeColor(color);
      saveState(plugin); applyBoardStyle();
    }
    function boardMenu(e) {
      var menu = new Oe.Menu(), state = ensureState(plugin);
      menu.addItem(function (item) {
        item.setTitle(T("pinBoardColor")).setIcon("palette").onClick(function () {
          pickColor(T("pinBoardColor"), state.boardColor || "#1e1e1e", function (c) { setBoardColor(c); });
        });
      });
      if (state.boardColor) {
        menu.addItem(function (item) {
          item.setTitle(T("pinResetColor")).setIcon("rotate-ccw").onClick(function () { setBoardColor(null); });
        });
      }
      if (st.selected.length) {
        menu.addItem(function (item) { item.setTitle(T("pinClearSelection")).setIcon("x").onClick(clearSelection); });
      }
      menu.showAtPosition({ x: e.clientX, y: e.clientY });
    }
    function buildCard(path, entering) {
      var state = ensureState(plugin), e = state.cards[path];
      if (!e || st.dom.has(path)) return st.dom.get(path) || null;
      if (baseHidden(plugin, path)) return null;
      var file = plugin.app.vault.getAbstractFileByPath(path);
      var el = cardLayer.createDiv({ cls: "blg-pin-card" });
      el.tabIndex = 0;
      el.style.transform = "translate(" + e.x + "px," + e.y + "px)";
      el.style.zIndex = e.z;
      var dateEl = el.createDiv({ cls: "blg-pin-card-date" });
      /* Check de tarea (solo tarjetas TaskNotes): pendiente = casilla vacía;
         completada = ✅. Va junto al título, en la fila superior. */
      var checkEl = dateEl.createEl("button", { cls: "blg-pin-card-btn blg-pin-card-check" });
      checkEl.type = "button"; checkEl.hidden = true;
      checkEl.setAttribute("aria-pressed", "false");
      var dateIconEl = dateEl.createSpan({ cls: "blg-pin-card-date-icon" });
      dateIconEl.hidden = true;
      var dateTextEl = dateEl.createSpan({ cls: "blg-pin-card-date-text" });
      var head = el.createDiv({ cls: "blg-pin-card-head" });
      var dot = head.createSpan({ cls: "blg-pin-card-dot" });
      var titleEl = head.createSpan({ cls: "blg-pin-card-title" });
      var openBtn = head.createEl("button", { cls: "blg-pin-card-btn blg-pin-card-open" });
      openBtn.type = "button";
      try { Oe.setIcon(openBtn, "external-link"); } catch (_) {}
      openBtn.title = T("pinOpen"); openBtn.setAttribute("aria-label", T("pinOpen"));
      var unpinBtn = head.createEl("button", { cls: "blg-pin-card-btn blg-pin-card-unpin" });
      unpinBtn.type = "button";
      try { Oe.setIcon(unpinBtn, "pin-off"); } catch (_) {}
      unpinBtn.title = T("pinUnpin"); unpinBtn.setAttribute("aria-label", T("pinUnpin"));
      var folderEl = el.createDiv({ cls: "blg-pin-card-folder" });
      var previewEl = el.createDiv({ cls: "blg-pin-card-preview" });
      var rec = { path: path, el: el, head: head, dot: dot, titleEl: titleEl, folderEl: folderEl,
        previewEl: previewEl, dateEl: dateEl, dateIconEl: dateIconEl, dateTextEl: dateTextEl,
        checkEl: checkEl, openBtn: openBtn, rev: 0 };
      st.dom.set(path, rec);
      if (st.selected.indexOf(path) >= 0) el.classList.add("is-selected");
      fillCard(rec, file);
      el.addEventListener("pointerdown", function (e2) {
        if (e2.button !== 0 || !(e2.ctrlKey || e2.metaKey) || e2.target.closest(".blg-pin-card-btn")) return;
        e2.preventDefault(); e2.stopPropagation(); toggleSelected(rec); bringToFront(rec);
      }, true);
      head.addEventListener("pointerdown", function (e2) { cardDown(e2, rec); });
      el.addEventListener("contextmenu", function (e2) { cardMenu(e2, rec); });
      openBtn.addEventListener("click", function (e2) { e2.stopPropagation(); openNote(rec.path); });
      unpinBtn.addEventListener("click", function (e2) { e2.stopPropagation(); unpinPath(plugin, rec.path); });
      /* El check no abre ni arrastra la tarjeta: alterna el estado de la
         tarea escribiendo como TaskNotes (bidireccional). */
      checkEl.addEventListener("click", function (e2) {
        e2.preventDefault(); e2.stopPropagation();
        toggleCardTask(rec);
      });
      el.addEventListener("dblclick", function (e2) {
        if (e2.target.closest(".blg-pin-card-btn") || e2.ctrlKey || e2.metaKey) return;
        openNote(rec.path);
      });
      el.addEventListener("keydown", function (e2) {
        if (e2.key === "Enter") { e2.preventDefault(); openNote(rec.path); }
      });
      /* Rueda sobre la tarjeta: recorre sus propiedades (vertical; con Shift,
         horizontal si desbordan, como en el tooltip). Si NO hay desborde, el
         evento sigue hasta la pizarra y conserva el zoom con rueda. */
      el.addEventListener("wheel", function (e2) {
        var pv = rec.previewEl;
        var canY = pv.scrollHeight > pv.clientHeight + 1;
        var canX = pv.scrollWidth > pv.clientWidth + 1;
        if (e2.shiftKey ? !canX : !canY) return;
        e2.preventDefault(); e2.stopPropagation();
        if (e2.shiftKey) pv.scrollLeft += e2.deltaY || e2.deltaX;
        else pv.scrollTop += e2.deltaY;
      }, { passive: false });
      /* Primer clic (sin arrastrar, sin Ctrl, fuera de botones): enfocar. */
      el.addEventListener("click", function (e2) {
        if (e2.button !== 0) return;
        if (e2.target.closest(".blg-pin-card-btn")) return;
        if (e2.ctrlKey || e2.metaKey) return;
        if (rec._dragged) return;
        focusCard(rec);
      });
      var roz = new ResizeObserver(function () { scheduleDraw(); });
      roz.observe(el);
      rec.roz = roz;
      rec.cleanup = rememberDestroyer(function () { roz.disconnect(); });
      if (entering) {
        el.classList.add("is-entering");
        setTimeout(function () { el.classList.remove("is-entering"); }, 260);
      }
      return rec;
    }
    function removeCard(path) {
      var rec = st.dom.get(path);
      if (!rec) return;
      st.dom.delete(path);
      if (rec.cleanup) { forgetDestroyer(rec.cleanup); rec.cleanup(); rec.cleanup = null; }
      if (rec.roz) rec.roz = null;
      var si = st.selected.indexOf(path);
      if (si >= 0) st.selected.splice(si, 1);
      rec.el.classList.add("is-leaving");
      setTimeout(function () { rec.el.remove(); scheduleDraw(); }, 160);
      scheduleDraw();
    }
    function buildAll() {
      st.dom.forEach(function (rec) {
        if (rec.cleanup) { forgetDestroyer(rec.cleanup); rec.cleanup(); rec.cleanup = null; }
        if (rec.roz) rec.roz = null;
      });
      cardLayer.empty(); st.dom.clear();
      var state = ensureState(plugin);
      st.selected = st.selected.filter(function (p) { return !!state.cards[p]; });
      Object.keys(state.cards).sort(function (a, b) { return state.cards[a].z - state.cards[b].z; })
        .forEach(function (p) { buildCard(p, false); });
      scheduleDraw();
    }

    /* --- entrada/salida del modo --- */
    function enter() {
      if (st.active || plugin.session) return;
      // Las gotas siguen al grafo; salir de ellas antes de cubrirlo.
      var dt = graph.querySelector(".blg-drops-toggle.is-active");
      if (dt) dt.click();
      st.active = true;
      board.hidden = false;
      layoutTop(); applyBoardStyle();
      buildAll();
      cancelCamAnim();
      var f = fitCamera(cardRects(), viewport(), 70);
      setCam(f.x, f.y, f.z); saveCamSoon();
      reconcileEdges(); updateEmpty(); syncButton();
      try { board.focus({ preventScroll: true }); } catch (_) {}
    }
    function exit() {
      if (!st.active) return;
      st.active = false;
      clearSelection();
      var state = ensureState(plugin);
      state.camera = { x: st.x, y: st.y, z: st.z };
      saveState(plugin);
      board.hidden = true;
      syncButton();
      try { button.focus({ preventScroll: true }); } catch (_) {}
    }
    button.addEventListener("click", function () { if (st.active) exit(); else enter(); });

    /* --- pan / zoom / fit --- */
    board.addEventListener("wheel", function (e) {
      e.preventDefault(); e.stopPropagation();
      cancelCamAnim();
      var rect = board.getBoundingClientRect();
      var ax = e.clientX - rect.left, ay = e.clientY - rect.top;
      var z1 = clamp(st.z * (1 - e.deltaY * 0.001), 0.2, 3);
      var p = anchorPan({ x: st.x, y: st.y }, st.z, z1, ax, ay);
      st.x = p.x; st.y = p.y; st.z = z1;
      applyCam(); saveCamSoon();
    }, { passive: false });
    board.addEventListener("pointerdown", function (e) {
      if (e.button !== 0 && e.button !== 1) return;
      if (e.target.closest(".blg-pin-card") || e.target.closest(".blg-pinboard-controls")) return;
      e.preventDefault();
      cancelCamAnim();
      var sx = e.clientX, sy = e.clientY, ox = st.x, oy = st.y, moved = false;
      function mv(ev) {
        var dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (!moved && Math.hypot(dx, dy) < 4) return;
        moved = true;
        board.classList.add("is-panning");
        st.x = ox + dx; st.y = oy + dy;
        applyCam();
      }
      function up() {
        cleanup();
        board.classList.remove("is-panning");
        if (moved) saveCamSoon();
      }
      function cleanup() {
        window.removeEventListener("pointermove", mv, true);
        window.removeEventListener("pointerup", up, true);
        forgetDestroyer(cleanup);
      }
      window.addEventListener("pointermove", mv, true);
      window.addEventListener("pointerup", up, true);
      rememberDestroyer(cleanup);
    });
    board.addEventListener("dblclick", function (e) {
      if (e.target.closest(".blg-pin-card") || e.target.closest(".blg-pinboard-controls")) return;
      cancelCamAnim();
      var f = fitCamera(cardRects(), viewport(), 70);
      setCam(f.x, f.y, f.z); saveCamSoon();
    });
    board.addEventListener("contextmenu", function (e) {
      if (e.target.closest(".blg-pin-card") || e.target.closest(".blg-pinboard-controls")) return;
      e.preventDefault(); e.stopPropagation(); boardMenu(e);
    });
    fitBtn.addEventListener("click", function () {
      cancelCamAnim();
      var f = fitCamera(cardRects(), viewport(), 70);
      setCam(f.x, f.y, f.z); saveCamSoon();
    });
    board.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); exit(); }
    });

    function syncButton() {
      button.hidden = !!plugin.session;
      var state = ensureState(plugin);
      var n = Object.keys(state.cards).length;
      button.classList.toggle("is-active", st.active);
      button.empty();
      var ic = button.createSpan({ cls: "blg-pin-toggle-icon" });
      try { Oe.setIcon(ic, "pin"); } catch (_) {}
      if (n) { var badge = button.createSpan({ cls: "blg-pin-toggle-count", text: String(n) }); badge.setAttribute("aria-hidden", "true"); }
      var dt = graph.querySelector(".blg-drops-toggle");
      var dropsShown = dt && !dt.hidden && !st.active;
      button.classList.toggle("is-with-drops", !!dropsShown);
      layoutButton();
      button.style.right = "";
      button.title = T(st.active ? "pinBtnHide" : "pinBtnShow") + " · " + msg("pinCount", n);
      button.setAttribute("aria-label", button.title);
    }

    /* --- envolturas de refresco: solo re-sincronizan el botón; el grafo
       sigue su curso normal debajo de la pizarra. Si empieza una sesión de
       costura, la pizarra se cierra. --- */
    var oMode = view.renderMode, oLocal = view.renderLocalGraph, oTag = view.renderTagGraph,
      oSched = view._scheduleRefresh, oRef = view.refreshLocal;
    function after() { if (plugin.session && st.active) exit(); syncButton(); }
    view.renderMode = function () { var r = oMode.apply(this, arguments); after(); return r; };
    view.refreshLocal = function () { var r = oRef.apply(this, arguments); after(); return r; };
    view.renderLocalGraph = function () { var r = oLocal.apply(this, arguments); after(); return r; };
    view.renderTagGraph = function () { var r = oTag.apply(this, arguments); after(); return r; };
    view._scheduleRefresh = function () { var r = oSched.apply(this, arguments); after(); return r; };

    var handle = {
      active: function () { return st.active; },
      enter: enter, exit: exit,
      viewCenter: viewCenter, cardSize: cardSize,
      syncButton: syncButton,
      /* API para el MCP: selección actual, foco de una tarjeta y encuadre. */
      selected: function () { return st.selected.slice(); },
      focus: function (path) { var rec = st.dom.get(path); if (!rec) return false; focusCard(rec); return true; },
      fit: function () { cancelCamAnim(); var f = fitCamera(cardRects(), viewport(), 70); setCam(f.x, f.y, f.z); saveCamSoon(); },
      edgesSoon: edgesSoon,
      /* parches incrementales: nunca tocan cámara ni otras tarjetas */
      cardAdded: function (path) {
        syncButton();
        if (!st.active) return;
        buildCard(path, true);
        updateEmpty(); reconcileEdges();
      },
      cardRemoved: function (path) {
        syncButton();
        if (!st.active) return;
        removeCard(path);
        updateEmpty();
        edgesSoon();
      },
      cardUpdated: function (path) {
        if (!st.active) return;
        var rec = st.dom.get(path);
        if (!rec) return;
        fillCard(rec, plugin.app.vault.getAbstractFileByPath(path));
      },
      basesSoon: function () {
        if (!st.active) return;
        st.dom.forEach(function (rec) { if (isBasePath(rec.path)) fillCard(rec, plugin.app.vault.getAbstractFileByPath(rec.path)); });
        edgesSoon();
      },
      /* Cambio en basesMode/basesCustom: reconstruye tarjetas (las .base
         ocultas no se dibujan pero conservan su pin) y recalcula aristas. */
      visibilityChanged: function () {
        syncButton();
        if (!st.active) return;
        buildAll();
        updateEmpty();
        reconcileEdges();
      },
      settingsChanged: function () {
        applyBoardStyle();
        if (!st.active) return;
        st.dom.forEach(function (rec) { fillCard(rec, plugin.app.vault.getAbstractFileByPath(rec.path)); });
        drawEdges();
      },
      availability: function (path, ok) {
        if (!st.active) return;
        var rec = st.dom.get(path);
        if (rec) fillCard(rec, ok ? plugin.app.vault.getAbstractFileByPath(path) : null);
        edgesSoon();
      },
      renamed: function (oldPath, newPath) {
        var si = st.selected.indexOf(oldPath);
        if (si >= 0) st.selected[si] = newPath;
        if (!st.active) return;
        var rec = st.dom.get(oldPath);
        if (rec) {
          st.dom.delete(oldPath);
          rec.path = newPath;
          st.dom.set(newPath, rec);
          fillCard(rec, plugin.app.vault.getAbstractFileByPath(newPath));
        }
        edgesSoon();
      },
      destroy: function () {
        st.destroying = true;
        if (st.edgeRaf != null) cancelAnimationFrame(st.edgeRaf);
        if (st.edgeTimer) clearTimeout(st.edgeTimer);
        if (st.camTimer) clearTimeout(st.camTimer);
        cancelCamAnim();
        st.destroyers.slice().forEach(function (fn) { try { fn(); } catch (_) {} });
        st.destroyers = [];
        ro.disconnect();
        view.renderMode = oMode; view.renderLocalGraph = oLocal; view.renderTagGraph = oTag;
        view._scheduleRefresh = oSched; view.refreshLocal = oRef;
        board.remove(); button.remove();
        view._blgPinAttached = false;
      }
    };
    // El cierre de la vista destruye Cytoscape y contentEl se vacía.
    if (view.cy && view.cy.on) view.cy.on("destroy", function () {
      if (plugin._blgPin && plugin._blgPin.attached === handle) {
        handle.destroy(); plugin._blgPin.attached = null;
      }
    });
    /* Bidireccional: cuando TaskNotes cambia una tarea (su UI, su API o su
       propio MCP) su emisor avisa y se repinta SOLO esa tarjeta. El
       frontmatter escrito también dispara metadataCache "changed" (onload),
       que cubre las ediciones manuales de la nota. */
    try {
      var tn0 = taskNotesPlugin(plugin);
      if (tn0 && tn0.emitter && typeof tn0.emitter.on === "function") {
        var tnOff = tn0.emitter.on("task-updated", function (ev) {
          try {
            if (st.destroying || !st.active) return;
            var p = ev && (ev.path || (ev.updatedTask && ev.updatedTask.path) ||
              (ev.task && ev.task.path) || (ev.originalTask && ev.originalTask.path));
            if (!p) return;
            var rec = st.dom.get(p);
            if (rec) fillCard(rec, plugin.app.vault.getAbstractFileByPath(p));
          } catch (_) {}
        });
        if (typeof tnOff === "function") rememberDestroyer(tnOff);
      }
    } catch (_) {}
    syncButton();
    return handle;
  }

  /* ---------- ciclo de vida del plugin ---------- */

  var _onload = PLUGIN_PROTO.onload, _onunload = PLUGIN_PROTO.onunload;
  PLUGIN_PROTO.onload = async function () {
    pluginInstance = this;
    this._blgPin = { attached: null };
    try { hookPinSettingTab(this); } catch (e) { warn(e); }
    await _onload.call(this);
    try {
      var plugin = this;
      ensureState(plugin);
      function h() { return plugin._blgPin && plugin._blgPin.attached; }
      if (!plugin._blgPinSaveWrapped) {
        var originalSaveSettings = plugin.saveSettings;
        plugin.saveSettings = async function () {
          var r = await originalSaveSettings.apply(this, arguments);
          var hh = h(); if (hh) hh.settingsChanged();
          return r;
        };
        plugin._blgPinSaveWrapped = true;
      }
      /* Identidad: el renombrado migra rutas conservando posición; borrar
         marca la tarjeta como no disponible (sin perder su sitio); crearla
         de nuevo la revive. Funciona también con la pizarra cerrada. */
      plugin.registerEvent(plugin.app.vault.on("rename", function (file, oldPath) {
        try {
          var st = ensureState(plugin);
          if (migrateRename(st, oldPath, file.path)) {
            saveState(plugin);
            var hh = h(); if (hh) hh.renamed(oldPath, file.path);
          }
        } catch (e) { warn(e); }
      }));
      /* Borrar una nota la quita de la pizarra: conservar el pin como
         "no disponible" era más confuso que útil. Funciona también con la
         pizarra cerrada (unpinPath notifica al handle si existe). */
      plugin.registerEvent(plugin.app.vault.on("delete", function (file) {
        try {
          if (!(file instanceof Oe.TFile)) return;
          if (!isPinned(plugin, file.path)) return;
          unpinPath(plugin, file.path);
        } catch (e) { warn(e); }
      }));
      plugin.registerEvent(plugin.app.vault.on("create", function (file) {
        try {
          if (!(file instanceof Oe.TFile)) return;
          if (!isPinned(plugin, file.path)) return;
          var hh = h(); if (hh) hh.availability(file.path, true);
        } catch (e) { warn(e); }
      }));
      /* Metadatos: actualizar SOLO la tarjeta afectada y reconciliar aristas
         cuando la caché se asiente (nunca reconstruir la pizarra entera). */
      plugin.registerEvent(plugin.app.metadataCache.on("changed", function (file) {
        try {
          if (!file || !file.path) return;
          if (!isPinned(plugin, file.path)) return;
          var hh = h(); if (hh) { hh.cardUpdated(file.path); hh.edgesSoon(); }
        } catch (e) { warn(e); }
      }));
      plugin.registerEvent(plugin.app.metadataCache.on("resolved", function () {
        try { var hh = h(); if (hh) hh.edgesSoon(); } catch (e) { warn(e); }
      }));
      function tryAttach() {
        try {
          var v = plugin.getView && plugin.getView();
          if (!v || !v.graphEl) return;
          if (plugin._blgPin.attached && plugin._blgPin.attached.view !== v) {
            plugin._blgPin.attached.destroy(); plugin._blgPin.attached = null;
          }
          if (!plugin._blgPin.attached) {
            var hh = attachView(plugin, v);
            if (hh) { hh.view = v; plugin._blgPin.attached = hh; }
          }
        } catch (e) { warn(e); }
      }
      plugin.registerEvent(plugin.app.workspace.on("layout-change", tryAttach));
      plugin.registerEvent(plugin.app.workspace.on("active-leaf-change", tryAttach));
      setTimeout(tryAttach, 250); setTimeout(tryAttach, 1100);
    } catch (e) { warn(e); }
  };
  PLUGIN_PROTO.onunload = function () {
    try { if (this._blgPin && this._blgPin.attached) this._blgPin.attached.destroy(); } catch (e) { warn(e); }
    this._blgPin = null; pluginInstance = null;
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (typeof globalThis !== "undefined" && globalThis.__BLG_PINBOARD === sharedApi) delete globalThis.__BLG_PINBOARD;
    return _onunload.call(this);
  };
})();
