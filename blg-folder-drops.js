/* ============================================================
   Better Local Graph — Gotas de ubicación y Mover A (inyectado).
   Añadir este módulo DESPUÉS de blg-pin-board.js al regenerar main.js.
   Desktop únicamente. Ajustes drops* en data.json; no toca frontmatter.
   Un solo filtro SVG y un solo RAF propio; reduce blur, satélites y
   reflejos/leyenda, por ese orden, si cae el rendimiento.
   ============================================================ */
(function () {
  "use strict";
  var PLUGIN_PROTO;
  try { PLUGIN_PROTO = module.exports && module.exports.default && module.exports.default.prototype; } catch (_) { return; }
  if (!PLUGIN_PROTO) return;
  var Oe;
  try { require("path"); Oe = require("obsidian"); } catch (_) { return; } // móvil

  var pluginInstance = null, warned = false, nextId = 0;
  function warn(e) { if (!warned) { warned = true; try { console.warn("[BLG Drops]", e); } catch (_) {} } }
  function T(key) { return typeof L === "function" ? L(key) : key; }
  function msg(key) { var x = T(key); return typeof x === "function" ? x.apply(null, Array.prototype.slice.call(arguments, 1)) : x; }
  function notice(key) { new Oe.Notice(msg.apply(null, arguments)); }
  function defaults() { return {
    dropsColor: "#63bfe7", dropsOpacity: 0.22, dropsSize: 1,
    dropsBorderColor: "#63bfe7", dropsBorderWidth: 1, dropsGooBlur: 10,
    dropsSpeed: 1, dropsLabels: true, dropsLabelSize: 0.85, dropsLegend: false,
    dropsZoomOut: true, dropsMinZoom: 0.5, dropsCopyMod: "Ctrl", dropsMaxFolders: 15,
    dropsFolderColors: {}
  }; }
  function applyDefaults(plugin) { var d = defaults(), changed = false; Object.keys(d).forEach(function (k) {
    if (plugin.settings[k] == null) { plugin.settings[k] = d[k]; changed = true; }
  }); return changed; }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  /* Pan que mantiene el punto del modelo bajo el cursor (ax, ay en píxeles del
     contenedor) al pasar de z0 a z1. Zoom in y zoom out van hacia/desde el
     cursor, no hacia el centro del viewport. */
  function anchorPan(pan, z0, z1, ax, ay) {
    var mx = (ax - pan.x) / z0, my = (ay - pan.y) / z0;
    return { x: ax - mx * z1, y: ay - my * z1 };
  }
  /* Cytoscape devuelve SIEMPRE el mismo objeto de posición (por referencia):
     guardarlo tal cual en st.target / st.saved hace que la base se mueva con
     el nodo (deriva en espiral al soltar gotas y destino de salida corrupto).
     Toda posición persistida se guarda como copia independiente. */
  function clonePos(p) { return { x: p.x, y: p.y }; }
  function capturePositions(cy) { var m = new Map(); cy.nodes().forEach(function (n) { m.set(n.id(), clonePos(n.position())); }); return m; }
  function fold(s) { return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
  function folderPath(file) { var p = file && file.parent && file.parent.path; return !p || p === "/" ? "" : p; }
  function folderName(p) { return p || T("moveRoot"); }
  function dropLabel(p) { return p ? p.split("/").pop() : T("moveRoot"); }
  function excluded(plugin, p) { return (plugin.settings.excludedFolders || []).some(function (e) {
    e = String(e || "").replace(/^\/+|\/+$/g, ""); return e && (p === e || p.indexOf(e + "/") === 0);
  }); }
  /* Misma coincidencia de tags que la Tag View del bundle (segmento en
     cualquier posición), para detectar si cambió la topología visible. */
  function tagMatches(candidate, wanted) {
    var x = String(candidate || "").replace(/^#/, ""), w = String(wanted || "").replace(/^#/, "");
    if (x === w) return true;
    if (x.indexOf(w + "/") === 0) return true;
    var seg = x.split("/"), ws = w.split("/"), wl = ws.length;
    for (var i = 0; i + wl <= seg.length; i++) {
      var ok = true;
      for (var j = 0; j < wl; j++) if (seg[i + j] !== ws[j]) { ok = false; break; }
      if (ok) return true;
    }
    return false;
  }
  function tagGraphNodeIds(plugin, wanted) {
    var out = new Set(), mc = plugin.app.metadataCache;
    plugin.app.vault.getMarkdownFiles().forEach(function (f) {
      var c = mc.getFileCache(f), hit = false;
      if (!c) return;
      if (c.tags) for (var i = 0; i < c.tags.length; i++) if (tagMatches(c.tags[i].tag, wanted)) { hit = true; break; }
      if (!hit && c.frontmatter && c.frontmatter.tags) {
        var arr = Array.isArray(c.frontmatter.tags) ? c.frontmatter.tags : [c.frontmatter.tags];
        for (var k = 0; k < arr.length; k++) if (arr[k] != null && tagMatches(String(arr[k]), wanted)) { hit = true; break; }
      }
      if (hit) out.add(f.path);
    });
    return out;
  }
  /* Aristas de la Tag View entre nodos YA visibles. Permite actualizar
     costuras/enlaces sin reconstruir nodos, layout, cámara ni selección. */
  function tagEdgeDescriptors(plugin, pathSet) {
    var els = [], seen = new Map(), mc = plugin.app.metadataCache;
    function pushEdge(A, B, cls) {
      if (!A || !B || A === B || !pathSet.has(A) || !pathSet.has(B)) return;
      var k = A < B ? A + "\0" + B : B + "\0" + A;
      if (seen.has(k)) {
        if (cls.indexOf("sewing") !== -1) {
          var ex = seen.get(k);
          if (ex.classes.indexOf("sewing") === -1) ex.classes += " sewing";
        }
        return;
      }
      var el = { data: { id: "e_" + k, source: A, target: B }, classes: cls };
      seen.set(k, el); els.push(el);
    }
    var RL = mc.resolvedLinks || {};
    pathSet.forEach(function (src) {
      var tgts = RL[src]; if (!tgts) return;
      Object.keys(tgts).forEach(function (dst) { if (pathSet.has(dst)) pushEdge(src, dst, "tagedge"); });
    });
    pathSet.forEach(function (src) {
      var f = plugin.app.vault.getAbstractFileByPath(src);
      if (!(f instanceof Oe.TFile) || !plugin._sewingTargets) return;
      plugin._sewingTargets(f).forEach(function (dst) { pushEdge(src, dst, "tagedge sewing"); });
    });
    return els;
  }
  function hex(h) { var m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(h || defaults().dropsColor);
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : hex(defaults().dropsColor); }
  function rgba(h, a) { return "rgba(" + hex(h).join(",") + "," + a + ")"; }
  function colors(plugin) {
    var s = plugin.settings, light = document.body.classList.contains("theme-light"), op = clamp(+s.dropsOpacity || 0, 0.05, 0.6);
    return { fill: s.dropsColor, border: s.dropsBorderColor,
      fillAlpha: light ? op * 0.8 : op, borderAlpha: clamp(op * (light ? 2.2 : 1.8), 0.25, 0.7),
      ink: rgba(s.dropsBorderColor, light ? 0.65 : 0.55), shine: rgba(s.dropsColor, light ? 0.18 : 0.3) };
  }
  /* Colores efectivos de UNA gota: la asignación por carpeta (ruta completa)
     prevalece sobre el color global; sin asignación, el global. */
  function dropColors(plugin, p) {
    var s = plugin.settings, map = s.dropsFolderColors || {}, own = map[p];
    var base = /^#[0-9a-f]{6}$/i.test(own || "") ? own : s.dropsColor;
    var light = document.body.classList.contains("theme-light"), op = clamp(+s.dropsOpacity || 0, 0.05, 0.6);
    return { fill: base, border: base,
      fillAlpha: light ? op * 0.8 : op, borderAlpha: clamp(op * (light ? 2.2 : 1.8), 0.25, 0.7),
      shine: rgba(base, light ? 0.18 : 0.3) };
  }
  function fullPath(dir, name) { return dir ? dir + "/" + name : name; }
  function rootOrFolder(app, p) { return p ? app.vault.getAbstractFileByPath(p) : app.vault.getRoot(); }
  function resolveFile(view, id) {
    var path = view && view._blgDropsAlias && view._blgDropsAlias.get(id);
    var file = path && view.app.vault.getAbstractFileByPath(path);
    return file instanceof Oe.TFile ? file : null;
  }
  function fileForNode(app, id, aliases) {
    var file = app.vault.getAbstractFileByPath(id);
    if (!(file instanceof Oe.TFile) && aliases.has(id)) file = app.vault.getAbstractFileByPath(aliases.get(id));
    return file;
  }
  function validFolderPath(p) { return p !== "/" && !/(^|\/)\.{1,2}(\/|$)|[\\:*?"<>|]/.test(p) && !/\/\//.test(p) && p === p.trim() && !p.endsWith("/"); }
  function confirm(app, title, body, accept, yes) {
    var modal = new Oe.Modal(app);
    modal.onOpen = function () {
      modal.titleEl.setText(title); modal.contentEl.createEl("p", { text: body });
      var row = modal.contentEl.createDiv({ cls: "blg-drops-confirm" });
      row.createEl("button", { text: T("cancel") }).onclick = function () { modal.close(); };
      row.createEl("button", { text: accept, cls: "mod-cta" }).onclick = function () { modal.close(); yes(); };
    };
    modal.onClose = function () { modal.contentEl.empty(); };
    modal.open();
  }

  /* Todas las carpetas cargadas, prefijo primero y substring después. La
     carpeta actual se antepone solamente cuando también coincide. */
  function openFolderPicker(opts) {
    var plugin = opts.plugin || pluginInstance, app = plugin.app, current = opts.current || "";
    var counts = new Map(); app.vault.getMarkdownFiles().forEach(function (f) {
      var p = folderPath(f); counts.set(p, (counts.get(p) || 0) + 1);
    });
    var folders = app.vault.getAllLoadedFiles().filter(function (f) { return f instanceof Oe.TFolder && !excluded(plugin, f.path === "/" ? "" : f.path); });
    if (!folders.some(function (f) { return f.path === "/"; })) folders.push(app.vault.getRoot());
    var modal = new Oe.Modal(app), input, create, suggest;
    function pathOf(f) { return f.path === "/" ? "" : f.path; }
    function choose(p) { modal.close(); opts.onChoose(p); }
    function matches(q) {
      q = fold(q.trim());
      return folders.filter(function (f) { return fold(folderName(pathOf(f))).indexOf(q) !== -1; })
        .sort(function (a, b) {
          var x = pathOf(a), y = pathOf(b), ax = x === current ? -1 : fold(x).startsWith(q) ? 0 : 1;
          var by = y === current ? -1 : fold(y).startsWith(q) ? 0 : 1;
          return ax - by || x.localeCompare(y);
        });
    }
    async function createFolder(p) {
      try {
        if (!validFolderPath(p) || excluded(plugin, p)) { notice("moveBadFolder"); return; }
        var acc = "";
        for (var seg of p.split("/")) {
          acc = fullPath(acc, seg);
          var existing = app.vault.getAbstractFileByPath(acc);
          if (existing && !(existing instanceof Oe.TFolder)) throw new Error(msg("moveExists", acc));
          if (!existing) await app.vault.createFolder(acc);
        }
        choose(p);
      } catch (e) { notice("moveError", e.message || String(e)); }
    }
    modal.onOpen = function () {
      modal.titleEl.setText(T("moveFolderTitle"));
      input = modal.contentEl.createEl("input", { type: "text", cls: "blg-drops-search", placeholder: T("moveFolderPicker") });
      create = modal.contentEl.createEl("button", { cls: "blg-drops-create" });
      function updateCreate() {
        var p = input.value.trim().replace(/^\/+|\/+$/g, "");
        var exists = folders.some(function (f) { return pathOf(f) === p; });
        create.hidden = !p || exists || !validFolderPath(p) || excluded(plugin, p);
        create.setText(msg("moveNewFolder", p));
      }
      create.onclick = function () {
        var p = input.value.trim().replace(/^\/+|\/+$/g, "");
        if (!p || !validFolderPath(p) || excluded(plugin, p)) { notice("moveBadFolder"); return; }
        confirm(app, T("moveNewFolderTitle"), msg("moveNewFolderBody", p), T("moveCreate"), function () { createFolder(p); });
      };
      var Sug = class extends Oe.AbstractInputSuggest {
        getSuggestions(query) { return matches(query).slice(0, 40); }
        renderSuggestion(f, el) {
          var p = pathOf(f); el.createSpan({ text: folderName(p), cls: "blg-drops-folder-name" });
          el.createSpan({ text: msg("moveFolderCount", counts.get(p) || 0) + (p === current ? " " + T("moveCurrent") : ""), cls: "blg-drops-folder-count" });
        }
        selectSuggestion(f) { this.close(); choose(pathOf(f)); }
      };
      suggest = new Sug(app, input);
      input.addEventListener("input", updateCreate); input.addEventListener("keydown", function (e) {
        if (e.key === "Escape") { suggest.close(); modal.close(); }
      });
      updateCreate(); setTimeout(function () { if (input.isConnected) { input.focus(); suggest.open(); } }, 0);
    };
    modal.onClose = function () { if (suggest) suggest.close(); modal.contentEl.empty(); };
    modal.open();
  }

  /* Mover/copiar nota por nota. Jamás reescribir contenido o renombrar el
     basename; la copia usa Vault.copy y falla cerrada si no está disponible. */
  async function moveFiles(files, dest, opts) {
    opts = opts || {}; var plugin = opts.plugin || pluginInstance, app = plugin.app;
    var target = rootOrFolder(app, dest), result = { moved: 0, skipped: 0, paths: new Map(), errors: [] };
    files = Array.from(files || []);
    if (!(target instanceof Oe.TFolder) || excluded(plugin, dest)) {
      notice("moveBadFolder"); result.skipped = files.length; return result;
    }
    var used = new Set();
    for (var entry of files) {
      var file = typeof entry === "string" ? app.vault.getAbstractFileByPath(entry) : entry;
      if (!(file instanceof Oe.TFile) || file.extension.toLowerCase() !== "md" || used.has(file.path)) { result.skipped++; continue; }
      var oldPath = file.path; used.add(oldPath);
      if (folderPath(file) === dest) { result.skipped++; continue; }
      var destination = fullPath(dest, file.name);
      if (opts.copy) {
        if (typeof app.vault.copy !== "function") { result.skipped++; result.errors.push(T("copyUnavailable")); continue; }
        var stem = file.basename, i = 1;
        while (app.vault.getAbstractFileByPath(destination)) destination = fullPath(dest, stem + " " + (i++) + "." + file.extension);
      } else if (app.vault.getAbstractFileByPath(destination)) {
        result.skipped++; result.errors.push(msg("moveExists", destination)); continue;
      }
      try {
        if (opts.copy) await app.vault.copy(file, destination);
        else await app.fileManager.renameFile(file, destination);
        result.moved++; result.paths.set(oldPath, destination);
        var activeView = opts.view || (plugin.getView && plugin.getView());
        if (!opts.copy && activeView && activeView._blgDropsAlias) activeView._blgDropsAlias.set(oldPath, destination);
      } catch (e) { result.skipped++; result.errors.push(msg("moveError", e && e.message || String(e))); }
    }
    if (!opts.silent) {
      if (files.length === 1 && result.moved) notice(opts.copy ? "moveCopied" : "moveDone", folderName(dest));
      else if (files.length === 1 && result.errors.length) new Oe.Notice(result.errors[0]);
      else if (files.length > 1) {
        notice(opts.copy ? "copyResult" : "moveResult", result.moved, result.skipped);
        if (result.errors.includes(T("copyUnavailable"))) notice("copyUnavailable");
      }
      else if (result.skipped) notice("noChanges");
    }
    var v = opts.view || (plugin.getView && plugin.getView());
    if (result.moved && v && v._blgDropsMoved) v._blgDropsMoved(result, !!opts.copy);
    if (result.moved && v && v._scheduleRefresh) v._scheduleRefresh(true);
    return result;
  }

  function addMoveToMenu(menu, opts) {
    opts = opts || {}; var plugin = opts.plugin || pluginInstance;
    if (!plugin || (opts.source !== "mindmap" && plugin.session)) return;
    var entries = opts.source === "mindmap" ? (opts.files || []) : [opts.file];
    if (!entries.length || !entries[0]) return;
    menu.addItem(function (item) { item.setIcon("folder-input").setTitle(T("ctxMoveTo")).onClick(function () {
      var f = opts.source === "mindmap" ? plugin.app.vault.getAbstractFileByPath(entries[0].path) : entries[0];
      openFolderPicker({ plugin: plugin, current: opts.source === "mindmap" ? "" : folderPath(f), onChoose: function (dest) {
        if (opts.source === "mindmap") {
          var names = entries.slice(0, 5).map(function (e) { var n = plugin.app.vault.getAbstractFileByPath(e.path); return n instanceof Oe.TFile ? n.basename : e.path; });
          var detail = msg("mmMoveBody", entries.length, opts.tag, folderName(dest)) + "\n" + names.join(" · ") + (entries.length > 5 ? "…" : "");
          confirm(plugin.app, T("mmMoveTitle"), detail, T("mmMoveOk"), async function () {
            var result = await moveFiles(entries.map(function (e) { return e.path; }), dest, { plugin: plugin, silent: true });
            notice("mmMoveResult", result.moved, result.skipped);
            if (result.moved && opts.onDone) opts.onDone();
          });
        } else moveFiles([f], dest, { plugin: plugin, view: opts.view });
      } });
    }); });
  }

  var sharedApi = {
    addMoveToMenu: addMoveToMenu, openFolderPicker: openFolderPicker, moveFiles: moveFiles,
    resolveFile: resolveFile, colors: colors
  };
  if (typeof globalThis !== "undefined") globalThis.__BLG_DROPS = sharedApi;

  /* Ajustes: el hook debe instalarse ANTES del onload del bundle, pues allí
     se registra la pestaña original. Cada control repinta la vista abierta. */
  function settingsTab(plugin, container, tab) {
    var nav = container.querySelector(".blg-settings-tabs"), host = container.querySelector(".blg-settings-panels") || container;
    var btn = nav && nav.createEl("button", { cls: "blg-settings-tab", text: T("n_drops") });
    var panel = host.createDiv({ cls: nav ? "blg-settings-panel blg-drops-section" : "blg-drops-section" });
    if (btn) {
      btn.addEventListener("click", function () {
        container.querySelectorAll(".blg-settings-tab,.blg-settings-panel").forEach(function (el) { el.removeClass("active"); });
        btn.addClass("active"); panel.addClass("active"); plugin.settings.lastSettingsTab = "drops"; plugin.saveSettings();
      });
      nav.querySelectorAll(".blg-settings-tab").forEach(function (b) { if (b !== btn) b.addEventListener("click", function () { btn.removeClass("active"); panel.removeClass("active"); }); });
      if (plugin.settings.lastSettingsTab === "drops") {
        container.querySelectorAll(".blg-settings-tab,.blg-settings-panel").forEach(function (el) { el.removeClass("active"); });
        btn.addClass("active"); panel.addClass("active");
      }
    }
    panel.createEl("h3", { text: T("n_drops") }); panel.createEl("p", { text: T("d_drops"), cls: "blg-drops-settings-desc" });
    async function changed(k, v) {
      plugin.settings[k] = v;
      var view = plugin._blgDrops && plugin._blgDrops.attached;
      if (view) view.settingsChanged(k);
      await plugin.saveSettings();
    }
    function color(k, name, desc) { var s = new Oe.Setting(panel).setName(T(name));
      if (desc) s.setDesc(T(desc)); s.addColorPicker(function (c) { c.setValue(plugin.settings[k]).onChange(function (v) { changed(k, v); }); }); }
    function slider(k, name, a, b, step) { new Oe.Setting(panel).setName(T(name)).addSlider(function (s) {
      s.setLimits(a, b, step).setValue(plugin.settings[k]).setDynamicTooltip().onChange(function (v) { changed(k, v); });
    }); }
    function toggle(k, name) { new Oe.Setting(panel).setName(T(name)).addToggle(function (t) {
      t.setValue(!!plugin.settings[k]).onChange(function (v) { changed(k, v); });
    }); }
    color("dropsColor", "n_dropsColor", "d_dropsColor");
    slider("dropsOpacity", "n_dropsOpacity", 0.05, 0.6, 0.01);
    slider("dropsSize", "n_dropsSize", 0.7, 1.8, 0.05);
    color("dropsBorderColor", "n_dropsBorderColor");
    slider("dropsBorderWidth", "n_dropsBorderWidth", 0, 3, 0.1);
    slider("dropsGooBlur", "n_dropsGoo", 4, 20, 1);
    slider("dropsSpeed", "n_dropsSpeed", 0.5, 2, 0.1);
    toggle("dropsLabels", "n_dropsLabels"); toggle("dropsLegend", "n_dropsLegend");
    new Oe.Setting(panel).setName(T("n_dropsLabelSize")).setDesc(T("d_dropsLabelSize"))
      .addSlider(function (s) { s.setLimits(0.65, 1.35, 0.05).setValue(plugin.settings.dropsLabelSize)
        .setDynamicTooltip().onChange(function (v) { changed("dropsLabelSize", v); }); });
    toggle("dropsZoomOut", "n_dropsZoomOut");
    slider("dropsMinZoom", "n_dropsMinZoom", 0.2, 1, 0.05);
    new Oe.Setting(panel).setName(T("n_dropsCopyMod")).addDropdown(function (d) {
      d.addOption("Ctrl", T("dropsCopyCtrl")).addOption("Alt", T("dropsCopyAlt"))
        .addOption("none", T("dropsCopyNone")).setValue(plugin.settings.dropsCopyMod)
        .onChange(function (v) { changed("dropsCopyMod", v); });
    });
    slider("dropsMaxFolders", "n_dropsMaxFolders", 5, 50, 1);
    new Oe.Setting(panel).addButton(function (b) { b.setButtonText(T("dropsReset")).onClick(async function () {
      Object.assign(plugin.settings, defaults()); await plugin.saveSettings();
      if (plugin._blgDrops && plugin._blgDrops.attached) plugin._blgDrops.attached.settingsChanged("dropsSize");
      tab.display();
    }); });
  }
  function hookSettingTab(plugin) {
    var orig = plugin.addSettingTab.bind(plugin);
    plugin.addSettingTab = function (tab) {
      if (tab && tab.plugin === plugin && typeof tab.display === "function" && !tab._blgDropsHooked) {
        var display = tab.display;
        tab.display = function () { var r = display.apply(this, arguments);
          try { settingsTab(plugin, this.containerEl, this); } catch (e) { warn(e); } return r; };
        tab._blgDropsHooked = true;
      }
      return orig(tab);
    };
  }

  /* Vista y motor SVG. Las coordenadas de gotas/nodos son del MODELO; el
     viewport SVG replica exactamente zoom/pan de Cytoscape. Las etiquetas
     se dibujan después del filtro, en píxeles de pantalla. */
  var NS = "http://www.w3.org/2000/svg";
  function svg(tag, parent, attrs) { var el = document.createElementNS(NS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(el); return el;
  }
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
  function dropPath(d, t, breathe, pull, accel) {
    var out = ""; var R = d.r * breathe, phase = d.seed / 4294967296 * Math.PI * 2;
    var ax = accel ? accel.x : 0, ay = accel ? accel.y : 0;
    var aa = Math.hypot(ax, ay), lean = clamp(aa * 0.22, 0, 0.34);
    var ux = aa > 0.0001 ? ax / aa : 1, uy = aa > 0.0001 ? ay / aa : 0;
    for (var i = 0; i <= 40; i++) {
      var a = -Math.PI / 2 + i * Math.PI * 2 / 40, wobble =
        0.08 * Math.sin(a + phase + t * 0.00031) +
        0.05 * Math.sin(2 * a + phase * 1.7 - t * 0.00024) +
        0.03 * Math.sin(3 * a + phase * 0.7 + t * 0.00038);
      var r = R * (1 + wobble), ca = Math.cos(a), sa = Math.sin(a);
      /* Dipolo direccional: el borde en el sentido de la inercia se ESTIRA y
         el opuesto se recoge (g es impar en "along", así que la dirección
         importa). El centro nunca se mueve; sólo cambia la silueta. */
      var along = ca * ux + sa * uy, g = 1 + lean * along;
      var x = ca * r * (1 + 0.16 * sa) * g;
      var y = sa * r * 1.07 * (1 + 0.04 * sa) * g;
      if (pull) { var da = Math.atan2(Math.sin(a - pull.angle), Math.cos(a - pull.angle));
        var f = pull.amount * Math.exp(-da * da / 0.23); x += ca * f; y += sa * f; }
      out += (i ? "L" : "M") + (d.x + x) + "," + (d.y + y);
    }
    return out + "Z";
  }
  /* Resorte amortiguado EXACTAMENTE para el conjunto arrastrado. Recibe la
     velocidad objetivo y devuelve una "aceleración" visual acotada: arrancar
     opone la forma, frenar la adelanta y cambiar de sentido la recoloca. El
     estado se amortigua a cero; NO mueve el centro ni hace rebotar la gota. */
  function jellyStep(st, target, dt) {
    var cap = 7, c = 11, k = 95;
    var dts = clamp(dt || 16, 0, 50) / 1000;
    var len = Math.hypot(target.x, target.y);
    if (len > cap) { target = { x: target.x * cap / len, y: target.y * cap / len }; }
    if (st.x == null) { st.x = 0; st.y = 0; st.vx = target.x; st.vy = target.y; return { x: 0, y: 0 }; }
    var fx = k * (target.x - st.x) - c * st.vx, fy = k * (target.y - st.y) - c * st.vy;
    st.vx += fx * dts; st.vy += fy * dts; st.x += st.vx * dts; st.y += st.vy * dts;
    var out = Math.hypot(st.x, st.y), max = cap * 1.12;
    if (out > max) { st.x *= max / out; st.y *= max / out; }
    return { x: st.x, y: st.y };
  }
  function resetJelly(d) { return d.jelly = { x: 0, y: 0, vx: 0, vy: 0 }; }
  /* Velocidad del arrastre medida por el DESPLAZAMIENTO real del conjunto en
     cada fotograma, no por los eventos del ratón. Así, frenar con el botón
     aún pulsado también se detecta: el centro deja de moverse y la velocidad
     cae a cero, que es lo que hace reaccionar a la masa. */
  function dragVelocity(drg, x, y, dt) {
    if (drg.fx == null) { drg.fx = x; drg.fy = y; }
    var m = Math.max(1, dt || 16), ivx = (x - drg.fx) / m, ivy = (y - drg.fy) / m;
    drg.fx = x; drg.fy = y;
    var a = 1 - Math.exp(-m / 42);
    drg.vx = (drg.vx || 0) + (ivx - (drg.vx || 0)) * a;
    drg.vy = (drg.vy || 0) + (ivy - (drg.vy || 0)) * a;
    return { x: drg.vx, y: drg.vy };
  }
  function hoverStep(cur, target, dt, reduced) {
    if (reduced) return target;
    if (cur == null) return target ? 0.25 : 0;
    var step = (dt || 16) / (target > cur ? 130 : 210);
    return target > cur ? Math.min(target, cur + step) : Math.max(target, cur - step);
  }
  function collect(plugin, view, alias) {
    var groups = new Map(), skipped = false, totals = new Map(), positions = new Map();
    plugin.app.vault.getMarkdownFiles().forEach(function (f) { var p = folderPath(f); totals.set(p, (totals.get(p) || 0) + 1); });
    view.cy.nodes().forEach(function (n) {
      if (!n.visible() || n.style("display") === "none") return;
      var file = fileForNode(plugin.app, n.id(), alias);
      if (!(file instanceof Oe.TFile) || file.extension.toLowerCase() !== "md") return;
      var p = folderPath(file); if (excluded(plugin, p)) { skipped = true; return; }
      if (!groups.has(p)) groups.set(p, { path: p, nodes: [], total: totals.get(p) || 0, seed: hash(p), x: 0, y: 0 });
      groups.get(p).nodes.push(n); positions.set(n.id(), n.position());
    });
    return { groups: Array.from(groups.values()), skipped: skipped, positions: positions };
  }
  function arrange(groups, view, settings) {
    var center = view.currentPath && groups.find(function (g) { return g.nodes.some(function (n) { return n.id() === view.currentPath; }); });
    var compact = groups.length > settings.dropsMaxFolders;
    groups.sort(function (a, b) { return (a === center ? -1 : b === center ? 1 : b.nodes.length - a.nodes.length) || a.path.localeCompare(b.path); });
    var scale = +settings.dropsSize || 1, largest = 0, gap = compact ? 9 : 14;
    groups.forEach(function (d) {
      // El máximo es suave: si una carpeta contiene muchas notas, expandir
      // su ÚNICA gota evita expulsarlas o mezclarlas con otra carpeta.
      d.r = Math.max(compact ? 56 : 70, 38 + Math.sqrt(d.nodes.length) * (compact ? 31 : 38)) * scale;
      largest = Math.max(largest, d.r);
    });
    if (!groups.length) return { positions: new Map(), compact: compact };
    groups[0].x = 0; groups[0].y = 0;
    var placed = [groups[0]];
    for (var i = 1; i < groups.length; i++) {
      var d = groups[i], found = false;
      for (var ring = 1; ring <= groups.length + 1 && !found; ring++) {
        var rad = Math.max(groups[0].r + d.r + gap, ring * (2 * largest + gap));
        var slots = Math.max(8, Math.floor(2 * Math.PI * rad / (d.r * 2 + gap)));
        for (var j = 0; j < slots; j++) {
          var angle = 2 * Math.PI * (j / slots) + ring * 0.17;
          var x = rad * Math.cos(angle), y = rad * Math.sin(angle);
          if (placed.every(function (p) { return Math.hypot(x - p.x, y - p.y) >= d.r + p.r + gap; })) {
            d.x = x; d.y = y; found = true; break;
          }
        }
      }
      if (!found) { d.x = (groups.length + 2) * (2 * largest + gap); d.y = 0; }
      placed.push(d);
    }
    var positions = new Map();
    groups.forEach(function (d) {
      d.nodes.sort(function (a, b) { return a.id().localeCompare(b.id()); });
      d.nodes.forEach(function (n, i) {
        var a = i * 2.399963229728653, r = i === 0 ? 0 : d.r * 0.66 * Math.sqrt((i + 0.3) / d.nodes.length);
        positions.set(n.id(), { x: d.x + r * Math.cos(a), y: d.y + d.r * 0.1 + r * Math.sin(a) });
      });
    });
    return { positions: positions, compact: compact };
  }
  /* Hit-test puro para agarrar una gota entera. `model` es el puntero en
     coordenadas del modelo, `screen` en píxeles del contenedor. Devuelve la
     gota si el puntero cae en su etiqueta o en agua vacía (no sobre un nodo). */
  function hitDrop(groups, model, screen, z, pan, settings) {
    var size = +settings.dropsLabelSize || 0.85;
    for (var i = 0; i < groups.length; i++) {
      var d = groups[i];
      if (settings.dropsLabels !== false && (d.labelFade == null || d.labelFade > 0.3)) {
        var w = Math.min(330, dropLabel(d.path).length * 6.6 * size + 18 * size);
        var lx = d.x * z + pan.x, ly = (d.y - d.r * 0.6) * z + pan.y;
        if (screen.x >= lx - w / 2 && screen.x <= lx + w / 2 && screen.y >= ly - 17 * size && screen.y <= ly + 5 * size) return d;
      }
    }
    for (var j = 0; j < groups.length; j++) {
      var g = groups[j];
      if (Math.hypot(model.x - g.x, (model.y - g.y) / 1.07) >= g.r * 0.98) continue;
      var overNode = g.nodes.some(function (n) {
        var p = n.position(), half = (typeof n.width === "function" ? n.width() : 42) / 2 + 6;
        return Math.hypot(model.x - p.x, model.y - p.y) < half;
      });
      return overNode ? null : g;
    }
    return null;
  }
  /* Hover para desvanecer el rótulo y para el menú contextual: a diferencia de
     hitDrop, el agua cuenta INCLUYENDO los nodos que hay dentro — precisamente
     el rótulo se oculta para poder verlos. La píldora sólo cuenta visible. */
  function hoverDrop(groups, model, screen, z, pan, settings) {
    var size = +settings.dropsLabelSize || 0.85;
    for (var i = 0; i < groups.length; i++) {
      var d = groups[i];
      if (settings.dropsLabels !== false && (d.labelFade == null || d.labelFade > 0.3)) {
        var w = Math.min(330, dropLabel(d.path).length * 6.6 * size + 18 * size);
        var lx = d.x * z + pan.x, ly = (d.y - d.r * 0.6) * z + pan.y;
        if (screen.x >= lx - w / 2 && screen.x <= lx + w / 2 && screen.y >= ly - 17 * size && screen.y <= ly + 5 * size) return d;
      }
    }
    for (var j = 0; j < groups.length; j++) {
      var g = groups[j];
      if (Math.hypot(model.x - g.x, (model.y - g.y) / 1.07) < g.r * 0.98) return g;
    }
    return null;
  }
  function camera(view, groups, saved, settings, viewport) {
    if (!settings.dropsZoomOut || !groups.length) return { zoom: saved.zoom, pan: saved.pan, overflow: false };
    var rgb = hex(settings.dropsColor), luminance = (rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722) / 255;
    var visualPad = (1 - settings.dropsOpacity) * 8 + (document.body.classList.contains("theme-light") ? luminance : 1 - luminance) * 6;
    var blur = +settings.dropsGooBlur || 10, margin = blur * 2 + (+settings.dropsBorderWidth || 0) + 22 + visualPad;
    var x1 = Infinity, x2 = -Infinity, y1 = Infinity, y2 = -Infinity;
    groups.forEach(function (d) { x1 = Math.min(x1, d.x - d.r - margin); x2 = Math.max(x2, d.x + d.r + margin);
      y1 = Math.min(y1, d.y - d.r * 1.12 - margin - (settings.dropsLabels ? 28 * settings.dropsLabelSize : 0)); y2 = Math.max(y2, d.y + d.r * 1.12 + margin); });
    var panel = settings.dropsLegend ? 280 : 0;
    var ideal = Math.min(saved.zoom, (viewport.w - 90 - panel) / Math.max(1, x2 - x1), (viewport.h - 92) / Math.max(1, y2 - y1));
    var floor = clamp(+settings.dropsMinZoom || 0.5, 0.2, 1), zoom = Math.max(floor, ideal);
    return { zoom: zoom, pan: { x: (viewport.w + panel) / 2 - zoom * (x1 + x2) / 2,
      y: viewport.h / 2 - zoom * (y1 + y2) / 2 }, overflow: zoom > ideal + 0.001 };
  }

  function attachView(plugin, view) {
    if (!view || !view.cy || !view.graphEl || view._blgDropsAttached) return null;
    view._blgDropsAttached = true;
    var cy = view.cy, graph = view.graphEl, settings = plugin.settings, id = ++nextId;
    graph.style.position = "relative";
    var layer = svg("svg", graph, { class: "blg-drops-layer", "aria-hidden": "true" });
    layer.setAttribute("hidden", "");
    var defs = svg("defs", layer), filterId = "blg-drops-goo-" + id;
    var grad = svg("radialGradient", defs, { id: "blg-drops-gradient-" + id });
    var stop1 = svg("stop", grad, { offset: "0%" }), stop2 = svg("stop", grad, { offset: "100%" });
    var filter = svg("filter", defs, { id: filterId, x: "-25%", y: "-25%", width: "150%", height: "150%" });
    var blur = svg("feGaussianBlur", filter, { in: "SourceGraphic", stdDeviation: settings.dropsGooBlur });
    svg("feColorMatrix", filter, { mode: "matrix", values: "1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -8" });
    var world = svg("g", layer), water = svg("g", world), goo = svg("g", water, { filter: "url(#" + filterId + ")" });
    var outlines = svg("g", world), highlights = svg("g", world), labels = svg("g", layer);
    var filament = [];
    for (var fi = 0; fi < 6; fi++) filament.push(svg("circle", goo, { r: 0 }));
    var blob = svg("circle", goo, { r: 0 }), residual = svg("circle", goo, { r: 0 });
    var ghosts = [];
    for (var gi = 0; gi < 60; gi++) ghosts.push(svg("circle", goo, { r: 0 }));
    var bubbleLabel = svg("g", labels, { visibility: "hidden" });
    var bubblePill = svg("rect", bubbleLabel, { rx: 8, ry: 8 });
    var bubbleText = svg("text", bubbleLabel);
    var button = graph.createEl("button", { cls: "blg-drops-toggle" });
    button.type = "button";
    var legend = graph.createDiv({ cls: "blg-drops-legend" });
    var legendHead = legend.createEl("button", { cls: "blg-drops-legend-head" });
    var legendHint = legend.createDiv({ cls: "blg-drops-legend-hint", text: T("dropsPanHint") });
    var legendRows = legend.createDiv({ cls: "blg-drops-legend-rows" });
    var st = { active: false, phase: "idle", groups: [], target: new Map(), saved: null, tween: null,
      alias: new Map(), changed: false, dirty: false, raf: null, drag: null, effects: [], mods: { ctrl: false, alt: false },
      pointer: null, graphRect: null, hoverRestore: null, dropBusy: false, pending: new Set(), groupReturn: null, dropDrag: null,
      viewport: { w: 1, h: 1 }, reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
      blur: +settings.dropsGooBlur || 10, satellites: 3, shine: true, fps: 0, layerMs: 0,
      frameCost: 0, frameCount: 0, lastFps: 0, lastFrame: 0,
      hidden: new Map(), drops: [], compactNotice: false, excludedNotice: false, overflowNotice: false, lastMode: "", centerPath: null,
      wraf: null, wheelRunning: false, wax: 0, way: 0, wtz: 1 };
    view._blgDropsAlias = st.alias;
    function resize() { st.viewport.w = graph.clientWidth || 1; st.viewport.h = graph.clientHeight || 1;
      st.graphRect = graph.getBoundingClientRect();
      layer.setAttribute("viewBox", "0 0 " + st.viewport.w + " " + st.viewport.h);
      if (st.active && st.saved) { var cam = camera(view, st.groups, st.saved, settings, st.viewport);
        setOverflow(cam); if (!st.drag) { cy.zoom(cam.zoom); cy.pan(cam.pan); syncZoom(); } }
    }
    var ro = new ResizeObserver(resize); ro.observe(graph); resize();
    function syncZoom() { if (view._sz) { view._sz.z = cy.zoom(); view._sz.tz = cy.zoom(); view._sz.running = false; } }
    function mode() { return plugin.session ? "sewing" : plugin.tagView ? "tag:" + plugin.tagView.tag : "local"; }
    function overLimit() { return !!graph.querySelector(".coser-overlimit"); }
    function maxN() { return +settings.maxNodes || 30; }
    function nodeCount() { return view.cy ? view.cy.nodes().length : 0; }
    function syncButton() {
      // Sin nodos, vista vacía o por encima de maxNodes no hay nada que agrupar.
      // La vista de tag queda exenta del tope por conteo: allí el botón siempre
      // está disponible (nunca muestra el aviso .coser-overlimit de la vista local).
      var n = nodeCount(), tag = !!plugin.tagView;
      var allowed = !plugin.session && !overLimit() && n > 0 && (tag || n <= maxN());
      button.hidden = !allowed; button.classList.toggle("is-active", st.active);
      var text = T(st.active ? "dropsBtnHide" : "dropsBtnShow"); button.empty();
      try { Oe.setIcon(button, "folder"); } catch (_) {}
      button.title = text + " · " + msg("dropsCopyHint", settings.dropsCopyMod) +
        (settings.uiLang === "en" ? " · Shift: drag group" : " · Shift: arrastrar grupo");
      button.setAttribute("aria-label", button.title);
      // Aviso al pinboard: ambos botones comparten la misma esquina inferior.
      try { var pb = globalThis.__BLG_PINBOARD; if (pb && pb.layoutButtons) pb.layoutButtons(); } catch (_) {}
    }
    function paintSettings() { var c = colors(plugin);
      stop1.setAttribute("stop-color", c.fill); stop1.setAttribute("stop-opacity", 1);
      stop2.setAttribute("stop-color", c.fill); stop2.setAttribute("stop-opacity", 0.73);
      legend.style.setProperty("--blg-drops-color", c.fill);
      bubblePill.setAttribute("fill", "var(--background-primary)"); bubblePill.setAttribute("stroke", c.border);
      bubbleText.setAttribute("fill", "var(--text-normal)");
      blur.setAttribute("stdDeviation", st.blur);
      layer.style.setProperty("--blg-drops-label-font-size", 11 * settings.dropsLabelSize + "px");
      filament.concat([blob, residual]).concat(ghosts).forEach(function (b) { b.setAttribute("fill", c.fill); b.setAttribute("fill-opacity", c.fillAlpha); });
      st.drops.forEach(function (d) { var dc = dropColors(plugin, d.path); d.colors = dc;
        d.gStop1.setAttribute("stop-color", dc.fill); d.gStop1.setAttribute("stop-opacity", 1);
        d.gStop2.setAttribute("stop-color", dc.fill); d.gStop2.setAttribute("stop-opacity", 0.73);
        d.membrane.setAttribute("fill", "url(#" + d.gradId + ")"); d.membrane.setAttribute("fill-opacity", dc.fillAlpha);
        d.sat.forEach(function (b) { b.setAttribute("fill", dc.fill); b.setAttribute("fill-opacity", dc.fillAlpha); });
        d.outline.setAttribute("stroke", dc.border); d.outline.setAttribute("stroke-opacity", dc.borderAlpha);
        d.glow.setAttribute("stroke", dc.border); d.glow.setAttribute("stroke-opacity", 0);
        d.highlight.setAttribute("fill", dc.shine);
        d.wave.setAttribute("stroke", dc.border);
        d.labelRect.setAttribute("stroke", dc.border); });
    }
    function caption(d) { return dropLabel(d.path); }
    function rebuildLegend() {
      legendRows.empty(); legend.hidden = !settings.dropsLegend || !st.active || !st.shine;
      legendHint.hidden = !st.overflow;
      legendHead.setText(T("dropsLegendTitle"));
      legendHead.title = T(legendRows.hidden ? "dropsLegendExpand" : "dropsLegendCollapse");
      st.groups.forEach(function (d) { var row = legendRows.createEl("button", { cls: "blg-drops-legend-row" });
        var sw = row.createSpan({ cls: "blg-drops-swatch" }); sw.style.setProperty("--blg-drops-color", (d.colors || dropColors(plugin, d.path)).fill);
        row.createSpan({ text: folderName(d.path) + " · " + msg("dropsCount", d.nodes.length, d.total) });
        row.title = folderName(d.path); row.onclick = function () { var z = Math.max(settings.dropsMinZoom, Math.min(1, cy.zoom() * 1.2));
          st.tween = { start: performance.now(), duration: st.reduced ? 0 : 420, fromZoom: cy.zoom(), toZoom: z,
            fromPan: cy.pan(), toPan: { x: st.viewport.w / 2 - z * d.x, y: st.viewport.h / 2 - z * d.y }, from: new Map(), to: new Map() }; };
      });
    }
    function setOverflow(cam) {
      st.overflow = !!cam.overflow; legendHint.hidden = !st.overflow;
      if (st.overflow && !st.overflowNotice) { notice("dropsPanHint"); st.overflowNotice = true; }
    }
    legendHead.onclick = function () { legendRows.hidden = !legendRows.hidden;
      legendHead.title = T(legendRows.hidden ? "dropsLegendExpand" : "dropsLegendCollapse"); };
    function buildDrops() {
      st.drops.forEach(function (d) { d.membrane.remove(); d.glow.remove(); d.outline.remove(); d.highlight.remove(); d.wave.remove(); d.label.remove(); d.grad.remove(); d.sat.forEach(function (b) { b.remove(); }); });
      st.drops = [];
      st.groups.forEach(function (d) {
        d.membrane = svg("path", goo); d.sat = [];
        for (var i = 0; i < 3; i++) d.sat.push(svg("circle", goo, { r: 0 }));
        d.glow = svg("path", outlines, { fill: "none", "stroke-linecap": "round", "stroke-opacity": 0 });
        d.outline = svg("path", outlines, { fill: "none" });
        d.highlight = svg("ellipse", highlights);
        d.wave = svg("circle", highlights, { fill: "none", r: 0 });
        d.gradId = "blg-drops-gradient-" + id + "-" + st.drops.length;
        d.grad = svg("radialGradient", defs, { id: d.gradId });
        d.gStop1 = svg("stop", d.grad, { offset: "0%" }); d.gStop2 = svg("stop", d.grad, { offset: "100%" });
        if (d.labelFade == null) d.labelFade = 1;
        var size = +settings.dropsLabelSize || 0.85;
        d.label = svg("g", labels, { class: "blg-drops-label" });
        d.labelRect = svg("rect", d.label, { rx: 9 * size, ry: 9 * size, fill: "var(--background-primary)", "fill-opacity": 0.88 });
        d.labelText = svg("text", d.label, { fill: "var(--text-normal)" });
        d.labelText.textContent = caption(d);
        svg("title", d.label).textContent = folderName(d.path);
        var width = Math.min(330, d.labelText.textContent.length * 6.6 * size + 18 * size);
        d.labelRect.setAttribute("x", -width / 2); d.labelRect.setAttribute("y", -17 * size); d.labelRect.setAttribute("width", width); d.labelRect.setAttribute("height", 22 * size);
        d.labelText.setAttribute("text-anchor", "middle"); d.labelText.setAttribute("y", -2 * size);
        st.drops.push(d);
      });
      paintSettings(); rebuildLegend();
    }

    function ease(p) { return 1 - Math.pow(1 - clamp(p, 0, 1), 3); }
    function spring(p) { p = clamp(p, 0, 1); return 1 + 2.70158 * Math.pow(p - 1, 3) + 1.70158 * Math.pow(p - 1, 2); }
    function mix(a, b, p) { return a + (b - a) * p; }
    function beginTween(from, to, cam, leaving) {
      st.tween = { start: performance.now(), duration: st.reduced ? 0 : leaving ? 430 : 540,
        from: from, to: to, fromZoom: cy.zoom(), toZoom: cam.zoom, fromPan: cy.pan(), toPan: cam.pan,
        leaving: !!leaving };
    }
    function applyTween(now) {
      var tw = st.tween; if (!tw) return;
      var p = tw.duration ? clamp((now - tw.start) / tw.duration, 0, 1) : 1;
      /* Al salir se usa ease cúbico sin rebote: regreso fluido y exacto a la
         posición/cámara original. El spring con sobreimpulso queda sólo para
         la entrada al modo gotas. */
      var move = tw.leaving ? ease(p) : spring(Math.min(1, p * 1.17));
      var cp = tw.leaving ? ease(p) : ease(Math.max(0, (p - 0.12) / 0.88));
      cy.batch(function () {
        tw.to.forEach(function (dest, key) {
          var node = cy.getElementById(key), from = tw.from.get(key) || dest;
          if (node.length && !st.pending.has(key) && !(st.drag && st.drag.ids.includes(key)) && !(st.dropDrag && st.dropDrag.ids.includes(key))) node.position({ x: mix(from.x, dest.x, move), y: mix(from.y, dest.y, move) });
        });
        cy.zoom(mix(tw.fromZoom, tw.toZoom, cp));
        cy.pan({ x: mix(tw.fromPan.x, tw.toPan.x, cp), y: mix(tw.fromPan.y, tw.toPan.y, cp) });
      });
      syncZoom();
      if (p >= 1) {
        cy.batch(function () { tw.to.forEach(function (pos, key) { var n = cy.getElementById(key); if (n.length && !st.pending.has(key) && !(st.drag && st.drag.ids.includes(key)) && !(st.dropDrag && st.dropDrag.ids.includes(key))) n.position(pos); });
          cy.zoom(tw.toZoom); cy.pan(tw.toPan); });
        syncZoom(); st.tween = null;
        if (tw.leaving) finishExit(); else st.phase = "on";
      }
    }
    function candidate(d, pos) { return Math.hypot(pos.x - d.x, (pos.y - d.y) / 1.07) < d.r * 0.98; }
    function copied() { return settings.dropsCopyMod === "Ctrl" ? st.mods.ctrl : settings.dropsCopyMod === "Alt" && st.mods.alt; }
    function activeFiles() { return st.drag ? st.drag.ids.map(function (id) { return fileForNode(plugin.app, id, st.alias); }).filter(function (f) {
      return f instanceof Oe.TFile && f.extension.toLowerCase() === "md";
    }) : []; }
    function invalid(d) {
      if (!d || excluded(plugin, d.path) || !(rootOrFolder(plugin.app, d.path) instanceof Oe.TFolder)) return true;
      if (copied()) return false;
      return activeFiles().some(function (f) { return folderPath(f) !== d.path && !!plugin.app.vault.getAbstractFileByPath(fullPath(d.path, f.name)); });
    }
    function render(now, dt) {
      var z = cy.zoom(), pan = cy.pan(), speed = +settings.dropsSpeed || 1;
      world.setAttribute("transform", "translate(" + pan.x + " " + pan.y + ") scale(" + z + ")");
      var progress = st.tween && st.tween.duration ? (now - st.tween.start) / st.tween.duration : 1;
      var alpha = st.phase === "enter" && st.tween ? ease(progress) :
        st.phase === "leave" && st.tween ? 1 - ease(progress) : 1;
      var growth = 0.15 + 0.85 * alpha;
      water.setAttribute("opacity", alpha);
      outlines.setAttribute("opacity", alpha); highlights.setAttribute("opacity", alpha);
      var drag = st.drag, hover = null, pull = null;
      if (drag) {
        var pos = drag.node.position();
        hover = st.groups.find(function (d) { return d.path !== drag.source && candidate(d, pos); });
        drag.hover = hover;
      }
      /* Rótulo que se oculta al pasar por encima: el puntero quieto sigue
         "dentro" aunque la cámara se mueva, así que se calcula cada frame.
         El brillo del borde acompaña el hover incluso con rótulos apagados. */
      var hoverFade = null;
      if (st.pointer && st.phase === "on" && !st.drag && !st.dropDrag && !st.tween) {
        var hr = st.graphRect;
        if (hr && st.pointer.x >= hr.left && st.pointer.x <= hr.right && st.pointer.y >= hr.top && st.pointer.y <= hr.bottom) {
          var hsx = st.pointer.x - hr.left, hsy = st.pointer.y - hr.top;
          hoverFade = hoverDrop(st.groups, { x: (hsx - pan.x) / z, y: (hsy - pan.y) / z }, { x: hsx, y: hsy }, z, pan, settings);
        }
      }
      st.drops.forEach(function (d) {
        var breathe = st.reduced ? 1 : 1 + 0.019 * Math.sin(now * speed / 950 + d.seed) + 0.009 * Math.sin(now * speed / 1380 + d.seed / 17);
        var impact = st.effects.find(function (e) { return e.impact === d.path; });
        if (impact && !st.reduced) { var q = clamp((now - impact.start) / impact.duration, 0, 1);
          breathe += 0.075 * Math.sin(q * Math.PI * 9) * (1 - q); }
        if (drag && !drag.group && hover === d) { var p = drag.node.position();
          pull = { angle: Math.atan2(p.y - d.y, p.x - d.x), amount: Math.min(d.r * 0.12, Math.max(0, d.r - Math.hypot(p.x - d.x, p.y - d.y)) * 0.18) };
        } else pull = null;
        var recoil = st.effects.find(function (e) { return e.recoil === d.path; });
        if (recoil && !st.reduced) { var q = clamp((now - recoil.start) / recoil.duration, 0, 1);
          pull = { angle: recoil.angle, amount: d.r * 0.14 * Math.sin(q * Math.PI * 5) * (1 - q) }; }
        if (drag && !drag.group && drag.source === d.path && !drag.detached) {
          var p = drag.node.position(), dist = Math.hypot(p.x - d.x, p.y - d.y);
          pull = { angle: Math.atan2(p.y - d.y, p.x - d.x), amount: Math.min(d.r * 0.36, Math.max(0, dist - d.r * 0.4) * 0.48) };
        }
        var accel = d.dragAccel || { x: 0, y: 0 };
        var path = dropPath(d, st.reduced ? 0 : now * speed, breathe * growth, pull, accel);
        d.membrane.setAttribute("d", path); d.outline.setAttribute("d", path); d.glow.setAttribute("d", path);
        d.outline.setAttribute("stroke-width", settings.dropsBorderWidth / Math.max(0.5, z));
        d.hoverGlow = hoverStep(d.hoverGlow, hoverFade === d ? 1 : 0, dt, st.reduced);
        d.glow.setAttribute("stroke-opacity", 0.42 * d.hoverGlow);
        d.glow.setAttribute("stroke-width", ((+settings.dropsBorderWidth || 0) + 2.1) / Math.max(0.5, z));
        d.sat.forEach(function (ball, i) {
          var a = i * 2.399963 + d.seed * 0.0000001 + now * speed * (i % 2 ? -0.00015 : 0.00012);
          ball.setAttribute("cx", d.x + Math.cos(a) * d.r * 0.72);
          ball.setAttribute("cy", d.y + Math.sin(a) * d.r * 0.72);
          ball.setAttribute("r", i < st.satellites && !st.reduced ? growth * d.r * (0.13 + i * 0.02) : 0);
        });
        d.highlight.setAttribute("cx", d.x - d.r * 0.32); d.highlight.setAttribute("cy", d.y - d.r * 0.36);
        d.highlight.setAttribute("rx", st.shine ? d.r * 0.16 * growth : 0); d.highlight.setAttribute("ry", d.r * 0.07 * growth);
        d.highlight.setAttribute("transform", "rotate(-25 " + (d.x - d.r * 0.32) + " " + (d.y - d.r * 0.36) + ")");
        var wave = st.effects.find(function (e) { return e.wave === d.path; });
        d.wave.setAttribute("cx", d.x); d.wave.setAttribute("cy", d.y);
        d.wave.setAttribute("r", wave ? d.r * (0.3 + 1.2 * clamp((now - wave.start) / 520, 0, 1)) : 0);
        d.wave.setAttribute("stroke", (d.colors || dropColors(plugin, d.path)).border);
        d.wave.setAttribute("stroke-opacity", wave ? 0.5 * (1 - clamp((now - wave.start) / 520, 0, 1)) : 0);
        d.wave.setAttribute("stroke-width", 2 / Math.max(0.5, z));
        /* Fade del rótulo: salida rápida (180 ms), reaparición más lenta
           (320 ms). Invertir el cursor a mitad revierte suave, sin parpadeo. */
        var fadeTarget = hoverFade === d ? 0 : 1, curFade = d.labelFade == null ? 1 : d.labelFade;
        if (st.reduced) curFade = fadeTarget;
        else if (curFade !== fadeTarget) {
          var fstep = (dt || 16) / (fadeTarget < curFade ? 180 : 320);
          curFade = fadeTarget < curFade ? Math.max(fadeTarget, curFade - fstep) : Math.min(fadeTarget, curFade + fstep);
        }
        d.labelFade = curFade;
        var lx = d.x * z + pan.x, ly = (d.y - d.r * 0.6) * z + pan.y;
        d.label.setAttribute("transform", "translate(" + lx + " " + ly + ")");
        d.label.setAttribute("visibility", settings.dropsLabels && curFade > 0.02 ? "visible" : "hidden");
        d.label.setAttribute("opacity", alpha * curFade);
        d.labelRect.setAttribute("stroke-opacity", hover === d ? 0.9 : 0.35);
        d.labelText.setAttribute("fill", hover === d && invalid(d) ? "var(--text-error)" : "var(--text-normal)");
      });
      var source = drag && st.groups.find(function (d) { return d.path === drag.source; });
      if (drag && source && !drag.group) {
        var pos = drag.node.position(), dist = Math.hypot(pos.x - source.x, pos.y - source.y);
        var stretch = dist / source.r, broken = stretch > 1.35;
        blob.setAttribute("cx", pos.x); blob.setAttribute("cy", pos.y); blob.setAttribute("r", Math.max(13, 22 / Math.max(0.5, z)));
        for (var i = 0; i < filament.length; i++) {
          var b = filament[i], f = (i + 1) / (filament.length + 1);
          b.setAttribute("cx", mix(source.x, pos.x, f)); b.setAttribute("cy", mix(source.y, pos.y, f));
          b.setAttribute("r", broken ? 0 : Math.max(0, (15 - stretch * 6) * (1 - f * 0.5)));
        }
        residual.setAttribute("cx", source.x + (pos.x - source.x) * Math.min(1, source.r / Math.max(1, dist)));
        residual.setAttribute("cy", source.y + (pos.y - source.y) * Math.min(1, source.r / Math.max(1, dist)));
        residual.setAttribute("r", broken ? 8 : 0);
        if (hover) {
          var label = msg("dropsTarget", folderName(hover.path));
          var nextText = invalid(hover) ? T("dropsInvalid") + " · " + label : label;
          if (bubbleText.textContent !== nextText) bubbleText.textContent = nextText;
          var w = Math.min(300, bubbleText.textContent.length * 7 + 18);
          bubblePill.setAttribute("width", w); bubblePill.setAttribute("height", 22);
          bubblePill.setAttribute("x", -w / 2); bubblePill.setAttribute("y", -17);
          bubbleText.setAttribute("text-anchor", "middle"); bubbleText.setAttribute("y", -2);
          bubbleText.setAttribute("fill", invalid(hover) ? "var(--text-error)" : "var(--text-normal)");
          bubbleLabel.setAttribute("transform", "translate(" + (pos.x * z + pan.x) + " " + (pos.y * z + pan.y - 34) + ")");
          bubbleLabel.setAttribute("visibility", "visible");
        } else bubbleLabel.setAttribute("visibility", "hidden");
      } else { blob.setAttribute("r", 0); residual.setAttribute("r", 0);
        filament.forEach(function (b) { b.setAttribute("r", 0); }); bubbleLabel.setAttribute("visibility", "hidden"); }
      st.effects = st.effects.filter(function (e) { return now - e.start < e.duration; });
      var visibleEffects = st.effects.filter(function (ef) { return ef.from && ef.to; });
      ghosts.forEach(function (g, i) {
        var ef = visibleEffects[i]; if (!ef) { g.setAttribute("r", 0); return; }
        var q = ease((now - ef.start) / ef.duration);
        g.setAttribute("cx", mix(ef.from.x, ef.to.x, q)); g.setAttribute("cy", mix(ef.from.y, ef.to.y, q));
        // Mitosis: dos lóbulos se estrangulan y se separan en sentidos opuestos.
        g.setAttribute("r", ef.copy ? 17 * (1 - 0.5 * Math.sin(q * Math.PI)) : 18 * (1 - 0.7 * q));
      });
    }
    function frame(now) {
      if (!st.active) return;
      var started = performance.now();
      var dt = st.lastFrame ? Math.min(100, now - st.lastFrame) : 16; st.lastFrame = now;
      try {
        /* Física del conjunto: su centro obedece al cursor, su FORMA integra
           la velocidad medida por desplazamiento real. La masa va en sentido
           CONTRARIO al avance (se retrasa); al frenar —aunque no se suelte—
           la velocidad cae y el resorte la adelanta con sobreimpulso. Al
           soltar sólo se disipa lo que quedaba: la base no viaja ni rebota. */
        var dragging = st.dropDrag || (st.drag && st.drag.group ? st.drag : null);
        if (dragging) { var gd = st.groups.find(function (d) { return d.path === dragging.source; }) || dragging.drop;
          if (gd) { var v = dragVelocity(dragging, gd.x, gd.y, dt);
            gd.dragAccel = st.reduced ? { x: 0, y: 0 } : jellyStep(gd.jelly || resetJelly(gd), { x: -v.x, y: -v.y }, dt); } }
        st.drops.forEach(function (d) {
          if (dragging && ((dragging.drop && dragging.drop === d) || (dragging.source && dragging.source === d.path))) return;
          if (!d.dragAccel) return;
          d.dragAccel = jellyStep(d.jelly || resetJelly(d), { x: 0, y: 0 }, dt);
          var j = d.jelly;
          if (Math.hypot(d.dragAccel.x, d.dragAccel.y) < 0.02 && j && Math.hypot(j.vx, j.vy) < 0.06) { d.dragAccel = null; d.jelly = null; }
        });
        applyTween(now);
        if (!st.active) return;
        if (st.groupReturn) { var gr = st.groupReturn, q = gr.duration ? clamp((now - gr.start) / gr.duration, 0, 1) : 1;
          gr.drop.x = mix(gr.from.x, gr.to.x, spring(q)); gr.drop.y = mix(gr.from.y, gr.to.y, spring(q));
          if (q === 1) st.groupReturn = null; }
        if (!st.reduced && !st.tween && !st.drag && !st.dropDrag && !st.dropBusy && st.pending.size === 0 && st.frameCount % 4 === 0) {
          cy.batch(function () { st.target.forEach(function (p, key) {
            var n = cy.getElementById(key); if (!n.length) return;
            var seed = hash(key) % 31, a = now * settings.dropsSpeed / 3300 + seed;
            n.position({ x: p.x + 1.4 * Math.cos(a), y: p.y + 1.4 * Math.sin(a) });
          }); });
        }
        render(now, dt);
        updateCursor();
        if (st.hoverRestore && !st.tween && !st.dropBusy && !st.drag) {
          var n = st.hoverRestore; st.hoverRestore = null;
          document.body.classList.remove("blg-drops-node-moving");
          var p = n.renderedPosition && n.renderedPosition(), rect = st.graphRect;
          if (!st.pointer || !p || !rect || Math.hypot(st.pointer.x - rect.left - p.x, st.pointer.y - rect.top - p.y) < 36) {
            if (n.emit) n.emit("mouseover");
          }
        }
        st.frameCost += performance.now() - started;
        st.frameCount++;
        if (!st.lastFps) st.lastFps = now;
        if (now - st.lastFps >= 2000) {
          st.fps = st.frameCount * 1000 / (now - st.lastFps);
          st.layerMs = st.frameCost / st.frameCount;
          st.frameCost = 0; st.frameCount = 0; st.lastFps = now;
          if ((st.fps < 50 || st.layerMs > 8) && !st.reduced) {
            if (st.blur > 4) { st.blur = Math.max(4, st.blur - 2); blur.setAttribute("stdDeviation", st.blur); }
            else if (st.satellites > 1) st.satellites--;
            else if (st.shine) { st.shine = false; legend.hidden = true; }
          }
        }
      } catch (e) { warn(e); finishExit(); return; }
      st.raf = requestAnimationFrame(frame);
    }
    function start() {
      if (st.active || plugin.session || !cy || overLimit() || (!plugin.tagView && nodeCount() > maxN())) return;
      cy.nodes().stop(true, true); cy.edges().stop(true, true); syncZoom();
      var data = collect(plugin, view, st.alias);
      if (!data.groups.length) { notice("dropsNoNodes"); return; }
      st.saved = { zoom: cy.zoom(), pan: clonePos(cy.pan()), positions: capturePositions(cy) };
      st.groups = data.groups; st.changed = false; st.dirty = false; st.lastMode = mode();
      st.centerPath = view.currentPath;
      var layout = arrange(st.groups, view, settings); st.target = layout.positions; st.compact = layout.compact;
      if (data.skipped && !st.excludedNotice) { notice("dropsExcluded"); st.excludedNotice = true; }
      if (st.compact && !st.compactNotice) { notice("dropsCompact"); st.compactNotice = true; }
      // Excluidas permanecen fuera del modo, temporalmente invisibles.
      cy.nodes().forEach(function (n) { var f = plugin.app.vault.getAbstractFileByPath(n.id());
        if (f instanceof Oe.TFile && excluded(plugin, folderPath(f))) {
          st.hidden.set(n.id(), n.style("display")); n.style("display", "none");
        } });
      cy.edges().forEach(function (e) { if (st.hidden.has(e.source().id()) || st.hidden.has(e.target().id())) {
        st.hidden.set(e.id(), e.style("display")); e.style("display", "none"); } });
      if (view._pulseT) { clearTimeout(view._pulseT); view._pulseT = null; }
      view._stopPulse && view._stopPulse();
      st.active = true; st.phase = "enter"; st.blur = +settings.dropsGooBlur || 10;
      st.satellites = 3; st.shine = true; st.frameCount = 0; st.frameCost = 0; st.lastFps = 0; st.lastFrame = 0;
      layer.removeAttribute("hidden"); buildDrops(); syncButton(); st.graphRect = graph.getBoundingClientRect();
      var cam = camera(view, st.groups, st.saved, settings, st.viewport);
      setOverflow(cam);
      beginTween(st.saved.positions, st.target, cam, false);
      st.raf = requestAnimationFrame(frame);
    }
    function finishExit() {
      cancelWheel();
      if (st.raf != null) cancelAnimationFrame(st.raf);
      st.raf = null; st.active = false; st.phase = "idle"; st.drag = null; dropUp();
      st.hoverRestore = null; st.dropBusy = false; document.body.classList.remove("blg-drops-node-moving");
      graph.classList.remove("blg-drops-grab", "blg-drops-grabbing");
      st.pending.clear(); st.groupReturn = null; st.tween = null; st.effects = []; st.lastFrame = 0; layer.setAttribute("hidden", ""); legend.hidden = true;
      st.hidden.forEach(function (old, key) { var el = cy.getElementById(key); if (el.length) el.style("display", old); });
      st.hidden.clear(); syncZoom(); syncButton();
      var silent = st.silentExit; st.silentExit = false;
      if (!st.destroying && !silent && mode() === st.lastMode && (st.changed || st.dirty)) {
        // Sólo los movimientos de archivos obligan a reconstruir. Si únicamente
        // hubo eventos de caché tragados, refrescar y dejar que el atajo `_sig`
        // del bundle decida: si el grafo no cambió, no hay re-layout ni salto.
        if (st.changed) view._lastSig = null;
        view._scheduleRefresh(true);
        // Si el bundle corto-circuita (grafo idéntico) no reinicia el pulso: hacerlo aquí.
        if (!st.changed && !plugin.tagView && view._startLocalPulse) view._startLocalPulse(settings);
      } else if (!st.destroying && !silent && !plugin.session && mode() === st.lastMode) {
        if (plugin.tagView && view._startPulse) view._startPulse(settings);
        else if (view._startLocalPulse) view._startLocalPulse(settings);
      }
      // Conservar el mapa durante el debounce de refresh: un menú abierto justo
      // tras salir aún puede apuntar al ID Cytoscape anterior.
      st.saved = null; st.centerPath = null;
    }
    /* Salida inmediata sin restaurar posiciones ni cámara: la vista se va a
       reconstruir para OTRA nota/modo y las gotas viejas no deben sobrevivir. */
    function exitNow(refresh) {
      if (!st.active) return false;
      if (st.drag && st.drag.pauseTimer) clearTimeout(st.drag.pauseTimer);
      st.drag = null; st.phase = "leave"; st.silentExit = true;
      st.dirty = false; st.changed = false;
      finishExit();
      // El render entrante (o el refresco pedido aquí) reactiva el pulso por sí mismo.
      if (refresh) { view._lastSig = null; view._scheduleRefresh(true); }
      return true;
    }
    function stop(immediate) {
      if (!st.active || st.phase === "leave") return;
      if (st.drag && st.drag.pauseTimer) clearTimeout(st.drag.pauseTimer);
      st.hoverRestore = null; document.body.classList.remove("blg-drops-node-moving");
      st.drag = null; dropUp(); st.phase = "leave";
      var cam = { zoom: st.saved.zoom, pan: st.saved.pan };
      // La cámara original sólo es válida si el grafo conserva sus nodos.
      if (st.changed && st.saved.positions.size !== cy.nodes().length) cam = camera(view, st.groups, st.saved, settings, st.viewport);
      beginTween(capturePositions(cy), st.saved.positions, cam, true);
      if (immediate) { st.tween.duration = 0; applyTween(performance.now()); }
      syncButton();
    }
    function rerange() {
      if (!st.active || st.phase === "leave") return;
      var old = capturePositions(cy);
      var data = collect(plugin, view, st.alias); st.groups = data.groups;
      var layout = arrange(st.groups, view, settings); st.target = layout.positions; st.compact = layout.compact;
      buildDrops();
      var cam = camera(view, st.groups, { zoom: cy.zoom(), pan: cy.pan() }, settings, st.viewport);
      setOverflow(cam);
      beginTween(old, st.target, cam, false); st.phase = "enter";
    }
    function bounce(ids) {
      var from = capturePositions(cy);
      ids.forEach(function (key) { var p = st.target.get(key), n = cy.getElementById(key);
        if (p && n.length) st.effects.push({ from: clonePos(n.position()), to: p, start: performance.now(), duration: 420 });
      });
      beginTween(from, st.target, { zoom: cy.zoom(), pan: cy.pan() }, false);
    }
    view._blgDropsMoved = function (result, copy) {
      if (!st.active || !result.moved) return;
      st.changed = true;
      if (!copy) { result.paths.forEach(function (path, old) { st.alias.set(old, path); }); if (!st.dropBusy) rerange(); }
    };
    async function dropped(n) {
      if (!st.drag || n.id() !== st.drag.id) return;
      var drag = st.drag, pos = n.position();
      if (!drag.everMoved) { st.drag = null; return; }
      if (drag.group) {
        // El grupo se queda donde se soltó: la nueva base pasa a ser el destino.
        st.drag = null; settleGroup(drag.ids); return;
      }
      var dest = st.groups.find(function (d) { return d.path !== drag.source && candidate(d, pos); });
      var copy = copied(); st.drag = null;
      if (!dest || excluded(plugin, dest.path) || !(rootOrFolder(plugin.app, dest.path) instanceof Oe.TFolder)) {
        bounce(drag.ids); if (dest) notice("moveBadFolder"); return;
      }
      var files = drag.ids.map(function (key) { return fileForNode(plugin.app, key, st.alias); });
      drag.ids.forEach(function (key) { st.pending.add(key); });
      st.dropBusy = true;
      var moved = false;
      try {
        var result = await moveFiles(files, dest.path, { plugin: plugin, view: view, copy: copy });
        if (!st.active) return;
        moved = !!result.moved;
        if (result.moved) {
          var t = performance.now();
          st.effects.push({ impact: dest.path, start: t, duration: st.reduced ? 0 : 530 });
          st.effects.push({ wave: dest.path, start: t, duration: st.reduced ? 0 : 520 / settings.dropsSpeed });
          drag.ids.forEach(function (key) { var node = cy.getElementById(key), p = node.length ? clonePos(node.position()) : clonePos(pos);
            st.effects.push({ from: p, to: { x: dest.x, y: dest.y }, start: t, duration: st.reduced ? 0 : 510 / settings.dropsSpeed, copy: copy });
            if (copy) st.effects.push({ from: { x: dest.x, y: dest.y }, to: st.target.get(key) || p, start: t, duration: st.reduced ? 0 : 510 / settings.dropsSpeed, copy: true });
          });
        }
        if (!result.moved || copy) bounce(drag.ids);
      } catch (e) { if (st.active) bounce(drag.ids); throw e;
      } finally { drag.ids.forEach(function (key) { st.pending.delete(key); }); st.dropBusy = false;
        if (moved && !copy && st.active) rerange(); }
    }
    function settleGroup(ids) {
      ids.forEach(function (key) { var n = cy.getElementById(key); if (n.length) st.target.set(key, clonePos(n.position())); });
    }
    /* Arrastre de la gota entera desde su etiqueta o desde agua vacía. El
       listener va en fase de captura para adelantarse al canvas de Cytoscape. */
    function modelPoint(e) { var rect = st.graphRect || graph.getBoundingClientRect(), z = cy.zoom(), pan = cy.pan();
      var sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      return { screen: { x: sx, y: sy }, model: { x: (sx - pan.x) / z, y: (sy - pan.y) / z } }; }
    function dropAt(e) {
      if (!st.active || st.phase !== "on" || st.tween || st.drag || st.dropBusy) return null;
      var pt = modelPoint(e);
      return hitDrop(st.groups, pt.model, pt.screen, cy.zoom(), cy.pan(), settings);
    }
    function dropDown(e) {
      if (e.button !== 0 || e.target === button || legend.contains(e.target)) return;
      var d = dropAt(e); if (!d) return;
      e.stopPropagation(); e.preventDefault();
      st.graphRect = graph.getBoundingClientRect();
      var pt = modelPoint(e);
      st.dropDrag = { drop: d, ids: d.nodes.map(function (n) { return n.id(); }), last: pt.model, moved: false };
      resetJelly(d); d.dragAccel = null;
      view.resetHover && view.resetHover();
      window.addEventListener("mousemove", dropMove, true); window.addEventListener("mouseup", dropUp, true);
    }
    function dropMove(e) {
      var dd = st.dropDrag; if (!dd) return;
      var p = modelPoint(e).model, dx = p.x - dd.last.x, dy = p.y - dd.last.y;
      if (!dx && !dy) return;
      dd.drop.x += dx; dd.drop.y += dy; dd.last = p; dd.moved = true;
      cy.batch(function () { dd.ids.forEach(function (key) { var n = cy.getElementById(key); if (!n.length) return;
        var o = n.position(); n.position({ x: o.x + dx, y: o.y + dy });
        var t = st.target.get(key); if (t) st.target.set(key, { x: t.x + dx, y: t.y + dy }); }); });
      if (!document.body.classList.contains("blg-drops-node-moving")) document.body.classList.add("blg-drops-node-moving");
    }
    function dropUp() {
      var dd = st.dropDrag; if (!dd) return;
      st.dropDrag = null; document.body.classList.remove("blg-drops-node-moving");
      window.removeEventListener("mousemove", dropMove, true); window.removeEventListener("mouseup", dropUp, true);
      if (dd.moved) settleGroup(dd.ids);
    }
    /* Color por carpeta (ruta completa), persistido en data.json. El cambio se
       previsualiza en vivo y se guarda al cerrar el selector. */
    function setDropColor(path, value) {
      settings.dropsFolderColors = settings.dropsFolderColors || {};
      if (value) settings.dropsFolderColors[path] = value; else delete settings.dropsFolderColors[path];
      paintSettings(); rebuildLegend();
    }
    function pickDropColor(d) {
      var original = (settings.dropsFolderColors || {})[d.path] || null, cancelled = false, input = null;
      var modal = new Oe.Modal(plugin.app);
      modal.onOpen = function () {
        modal.titleEl.setText(msg("dropsColorFor", folderName(d.path)));
        input = modal.contentEl.createEl("input", { type: "color", cls: "blg-drops-color-input" });
        var cur = original || settings.dropsColor;
        input.value = /^#[0-9a-f]{6}$/i.test(cur) ? cur : defaults().dropsColor;
        input.addEventListener("input", function () { setDropColor(d.path, input.value); });
        var row = modal.contentEl.createDiv({ cls: "blg-drops-confirm" });
        row.createEl("button", { text: T("cancel") }).onclick = function () { cancelled = true; setDropColor(d.path, original); modal.close(); };
        row.createEl("button", { text: T("dropsApplyColor"), cls: "mod-cta" }).onclick = function () { modal.close(); };
        setTimeout(function () { if (input && input.isConnected) { input.focus(); input.click(); } }, 0);
      };
      modal.onClose = function () {
        if (!cancelled && input) setDropColor(d.path, input.value);
        plugin.saveSettings(); modal.contentEl.empty();
      };
      modal.open();
    }
    /* Click derecho sobre el agua (no sobre un nodo): el cxttap de Cytoscape va
       sobre el canvas hijo; esta captura llega antes y frena la propagación. */
    function dropContext(e) {
      if (!st.active || st.phase !== "on" || st.tween || st.drag || st.dropDrag || st.dropBusy) return;
      if (e.target === button || legend.contains(e.target)) return;
      var pt = modelPoint(e);
      var d = hoverDrop(st.groups, pt.model, pt.screen, cy.zoom(), cy.pan(), settings);
      if (!d) return;
      var overNode = d.nodes.some(function (n) { var p = n.position(), half = (typeof n.width === "function" ? n.width() : 42) / 2 + 6;
        return Math.hypot(pt.model.x - p.x, pt.model.y - p.y) < half; });
      if (overNode) return;
      e.preventDefault(); e.stopPropagation();
      var menu = new Oe.Menu(plugin.app);
      menu.addItem(function (item) { item.setIcon("palette").setTitle(T("dropsSetColor")).onClick(function () { pickDropColor(d); }); });
      if ((settings.dropsFolderColors || {})[d.path]) menu.addItem(function (item) {
        item.setIcon("rotate-ccw").setTitle(T("dropsResetColor")).onClick(function () { setDropColor(d.path, null); plugin.saveSettings(); });
      });
      menu.showAtMouseEvent(e);
    }
    function updateCursor() {
      var grabbing = !!st.dropDrag, grab = false;
      if (!grabbing && st.pointer && st.phase === "on" && !st.drag && st.graphRect) {
        var r = st.graphRect;
        if (st.pointer.x >= r.left && st.pointer.x <= r.right && st.pointer.y >= r.top && st.pointer.y <= r.bottom)
          grab = !!dropAt({ clientX: st.pointer.x, clientY: st.pointer.y });
      }
      graph.classList.toggle("blg-drops-grabbing", grabbing); graph.classList.toggle("blg-drops-grab", grab && !grabbing);
    }
    function grabbed(e) {
      if (!st.active || st.phase === "leave") return;
      st.hoverRestore = null;
      document.body.classList.remove("blg-drops-node-moving");
      var n = e.target, id = n.id(), source = st.groups.find(function (d) { return d.nodes.some(function (v) { return v.id() === id; }); });
      if (!source) return;
      var selected = (view._sel || []).map(function (s) { return s.path; });
      var group = !!((e.originalEvent && e.originalEvent.shiftKey) || st.mods.shift);
      var pos = n.position();
      st.drag = { node: n, id: id, source: source.path, last: { x: pos.x, y: pos.y }, start: { x: pos.x, y: pos.y },
        center: { x: source.x, y: source.y }, group: group, detached: false, moving: false, everMoved: false,
        ids: group ? source.nodes.map(function (v) { return v.id(); }) :
          selected.length > 1 && selected.includes(id) ? selected.filter(function (x) { return st.target.has(x); }) : [id] };
      if (group) { resetJelly(source); source.dragAccel = null; }
    }
    function dragged(e) {
      var drag = st.drag, n = e.target;
      if (!drag || n.id() !== drag.id) return;
      var p = n.position();
      if (p.x === drag.last.x && p.y === drag.last.y) return;
      if (drag.group) { var source = st.groups.find(function (d) { return d.path === drag.source; });
        if (source) { source.x = drag.center.x + p.x - drag.start.x; source.y = drag.center.y + p.y - drag.start.y; }
        drag.ids.forEach(function (key) { if (key === drag.id) return; var other = cy.getElementById(key);
          if (other.length) { var old = other.position(); other.position({ x: old.x + p.x - drag.last.x, y: old.y + p.y - drag.last.y }); } });
      } else if (!drag.detached) { var source = st.groups.find(function (d) { return d.path === drag.source; });
        if (source && Math.hypot(p.x - source.x, p.y - source.y) > source.r * 1.35) {
          drag.detached = true; st.effects.push({ recoil: source.path, angle: Math.atan2(p.y - source.y, p.x - source.x),
            start: performance.now(), duration: st.reduced ? 0 : 430 });
        } }
      /* position() puede devolver el MISMO objeto vivo de Cytoscape: copiar
         los campos, nunca guardar la referencia, o el siguiente evento
         compararía contra sí mismo y el arrastre se congelaría. */
      drag.last.x = p.x; drag.last.y = p.y; drag.everMoved = true;
      if (!drag.moving) { drag.moving = true; view.resetHover && view.resetHover(); }
      document.body.classList.add("blg-drops-node-moving");
    }
    function mods(e) { st.mods.ctrl = !!e.ctrlKey; st.mods.alt = !!e.altKey; st.mods.shift = !!e.shiftKey;
      st.pointer = { x: e.clientX, y: e.clientY }; }
    function leave() { st.pointer = null; }
    function onKey(e) { st.mods.ctrl = e.ctrlKey; st.mods.alt = e.altKey; st.mods.shift = e.shiftKey; }
    /* BLG-FOCUS-WHEEL: la rueda del bundle gira alrededor del CENTRO del
       viewport. Aquí se toma el relevo (captura, stopImmediatePropagation)
       cuando el puntero NO está sobre un nodo — agua, rótulo de carpeta o
       vacío, con gotas activas o no — para anclar el zoom al cursor. Sobre un
       nodo o un tooltip con scroll se devuelve el control al bundle. */
    function onWheel(e) {
      if (st.active && st.tween && st.phase !== "leave") {
        st.tween = null; st.phase = "on"; syncZoom();
      }
      if (plugin.session || e.target === button || legend.contains(e.target)) return;
      if (view._hoverNode) return;
      var tt = view._ttEl;
      if (tt && tt.style.display !== "none") {
        var mx = e.shiftKey ? tt.scrollWidth - tt.clientWidth : tt.scrollHeight - tt.clientHeight;
        if (mx > 0) return;
      }
      e.preventDefault(); e.stopImmediatePropagation();
      if (view._tagFocusAnim) { view._tagFocusAnim.stop(); view._tagFocusAnim = null; }
      view._tagFocusArm = null;
      var rect = graph.getBoundingClientRect(); st.graphRect = rect;
      st.wax = e.clientX - rect.left; st.way = e.clientY - rect.top;
      st.wtz = clamp(cy.zoom() * (1 - e.deltaY * 0.001), 0.1, 10);
      if (view._sz) { view._sz.tz = st.wtz; view._sz.running = true; }
      if (!st.wheelRunning) { st.wheelRunning = true; st.wraf = requestAnimationFrame(wheelLoop); }
    }
    function wheelLoop() {
      if (!cy || view._tagFocusAnim) { st.wheelRunning = false; return; }
      var a = cy.zoom(), n = st.wtz - a, done = Math.abs(n) < 0.001, z2 = done ? st.wtz : a + n * 0.25;
      cy.zoom(z2); cy.pan(anchorPan(cy.pan(), a, z2, st.wax, st.way));
      if (done) { st.wheelRunning = false; syncZoom(); }
      else st.wraf = requestAnimationFrame(wheelLoop);
    }
    function cancelWheel() { if (st.wraf != null) cancelAnimationFrame(st.wraf); st.wraf = null; st.wheelRunning = false; }
    button.onclick = function () { if (st.phase === "leave") return; st.active ? stop(false) : start(); };
    function freed(e) {
      var drag = st.drag;
      if (drag && !drag.everMoved) dragged(e);
      if (drag && drag.everMoved) {
        st.hoverRestore = e.target; document.body.classList.add("blg-drops-node-moving");
        view.resetHover && view.resetHover();
      }
      dropped(e.target).catch(warn);
    }
    cy.on("grab", "node", grabbed); cy.on("drag", "node", dragged); cy.on("free", "node", freed);
    graph.addEventListener("pointermove", mods, true); graph.addEventListener("pointerup", mods, true);
    graph.addEventListener("pointerleave", leave, true);
    graph.addEventListener("mousedown", dropDown, true);
    graph.addEventListener("contextmenu", dropContext, true);
    graph.addEventListener("wheel", onWheel, true);
    document.addEventListener("keydown", onKey, true); document.addEventListener("keyup", onKey, true);
    var themeObserver = new MutationObserver(paintSettings); themeObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    var originalMode = view.renderMode, originalLocal = view.renderLocalGraph, originalTag = view.renderTagGraph, originalSchedule = view._scheduleRefresh, originalRefresh = view.refreshLocal;
    var nodeTimer = null;
    /* Con conjuntos activos, los cambios de relaciones se aplican al grafo
       visible sin reconstruir nodos ni tocar layout/cámara. Si cambia la
       topología (alta/baja de nodos), se conserva el diferido clásico. */
    function syncRelations() {
      if (!cy || plugin.session || st.phase === "leave") return false;
      if (plugin.tagView) {
        var wanted = tagGraphNodeIds(plugin, plugin.tagView.tag), same = wanted.size === cy.nodes().length;
        if (same) cy.nodes().forEach(function (n) { if (!wanted.has(n.id())) same = false; });
        if (!same || !view._applyGraphEdges) return false;
        view._applyGraphEdges(tagEdgeDescriptors(plugin, wanted));
        return true;
      }
      var path = st.centerPath || view.currentPath;
      var file = path && plugin.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof Oe.TFile) && path && st.alias.has(path)) file = plugin.app.vault.getAbstractFileByPath(st.alias.get(path));
      if (!(file instanceof Oe.TFile)) return false;
      return originalLocal.call(view, file, true) === true;
    }
    function otherNote(file) {
      if (!st.active || plugin.tagView || plugin.session) return false;
      file = file || plugin.app.workspace.getActiveFile();
      var path = file && file.extension === "md" && file.path;
      return !!path && path !== st.centerPath && path !== st.alias.get(st.centerPath);
    }
    // Cambió la nota central: las gotas de la carpeta anterior no deben quedar
    // sobre el grafo nuevo. Salida inmediata y refresco (sin tween a posiciones viejas).
    function checkActiveNote(file) { return otherNote(file) && !st.dropBusy && exitNow(true); }
    var activeLeafRef = plugin.app.workspace.on("active-leaf-change", function (leaf) {
      var file = leaf && leaf.view && leaf.view.file;
      setTimeout(function () { if (!st.destroying) checkActiveNote(file); }, 60);
    });
    var fileOpenRef = plugin.app.workspace.on("file-open", function (file) { checkActiveNote(file); });
    view.renderMode = function () {
      if (checkActiveNote()) return;
      if (st.active && mode() !== st.lastMode) exitNow(false);
      else if (st.active) { st.dirty = true; return; }
      var r = originalMode.apply(this, arguments); syncButton(); return r;
    };
    view.refreshLocal = function (force) {
      // Con otra nota activa la reconstrucción SIGUE su curso: salir primero.
      if (st.active && otherNote()) exitNow(false);
      var r = originalRefresh.apply(this, arguments); syncButton(); return r;
    };
    view.renderLocalGraph = function (file) {
      if (st.active) {
        var same = file && (file.path === st.centerPath || file.path === st.alias.get(st.centerPath));
        if (same && st.phase !== "leave") {
          // Las relaciones se reflejan ya; el render completo sigue diferido
          // porque esta llamada explícita también puede traer cambios visuales.
          syncRelations(); st.dirty = true; return;
        }
        exitNow(false);
      }
      var r = originalLocal.apply(this, arguments); syncButton(); return r;
    };
    view.renderTagGraph = function () {
      if (st.active) {
        if (mode() === st.lastMode) {
          syncRelations(); st.dirty = true; return;
        }
        exitNow(false);
      }
      var r = originalTag.apply(this, arguments); syncButton(); return r;
    };
    view._scheduleRefresh = function (force) {
      if (st.active) {
        checkActiveNote();
        if (st.active && !syncRelations()) st.dirty = true;
        return;
      }
      return originalSchedule.call(this, force);
    };
    function changedNodes(e) {
      if (e && e.target && e.target.isEdge && e.target.isEdge()) return;
      if (nodeTimer) clearTimeout(nodeTimer);
      nodeTimer = setTimeout(function () { nodeTimer = null;
        if (!st.active) { syncButton(); return; }
        if (st.phase === "leave") return;
        if (!cy.nodes().length || overLimit() || (!plugin.tagView && cy.nodes().length > maxN())) { exitNow(false); return; }
        st.dirty = true; rerange(); }, 80);
    }
    cy.on("add remove", changedNodes);
    var handle = {
      settingsChanged: function (key) {
        if (key === "dropsGooBlur") st.blur = +settings.dropsGooBlur || 10;
        paintSettings(); syncButton();
        if (st.active && (key === "dropsSize" || key === "dropsMaxFolders" || key === "dropsZoomOut" || key === "dropsMinZoom")) rerange();
        else if (st.active) {
          if (key === "dropsLabelSize") buildDrops(); else rebuildLegend();
          if (["dropsColor", "dropsOpacity", "dropsBorderColor", "dropsBorderWidth", "dropsGooBlur", "dropsLabels", "dropsLabelSize", "dropsLegend"].includes(key)) {
            var from = capturePositions(cy);
            var cam = camera(view, st.groups, { zoom: cy.zoom(), pan: cy.pan() }, settings, st.viewport);
            setOverflow(cam); beginTween(from, st.target, cam, false);
          }
        }
      },
      get fps() { return st.fps; },
      get layerMs() { return st.layerMs; },
      /* BLG-FOCUS-WHEEL: el tap de Cytoscape llega ANTES del "free", con el
         agarre aún registrado. Un agarre sin movimiento es un clic, no un
         arrastre: no debe bloquear el enfoque del nodo en la vista tag. */
      get busy() { return !!(st.active && (st.tween || (st.drag && st.drag.everMoved) || st.dropDrag || st.dropBusy || st.phase !== "on")); },
      destroy: function () {
        st.destroying = true;
        cancelWheel();
        if (st.active) { try { stop(true); } catch (e) { warn(e); } }
        if (st.raf != null) cancelAnimationFrame(st.raf);
        if (nodeTimer) clearTimeout(nodeTimer);
        plugin.app.workspace.offref(activeLeafRef);
        plugin.app.workspace.offref(fileOpenRef);
        ro.disconnect(); themeObserver.disconnect();
        graph.removeEventListener("pointermove", mods, true); graph.removeEventListener("pointerup", mods, true);
        graph.removeEventListener("pointerleave", leave, true);
        graph.removeEventListener("mousedown", dropDown, true); dropUp();
        graph.removeEventListener("contextmenu", dropContext, true);
        graph.classList.remove("blg-drops-grab", "blg-drops-grabbing");
        graph.removeEventListener("wheel", onWheel, true);
        document.removeEventListener("keydown", onKey, true); document.removeEventListener("keyup", onKey, true);
        cy.off("grab", "node", grabbed); cy.off("drag", "node", dragged); cy.off("free", "node", freed); cy.off("add remove", changedNodes);
        document.body.classList.remove("blg-drops-node-moving");
        view.renderMode = originalMode; view.renderLocalGraph = originalLocal; view.renderTagGraph = originalTag; view._scheduleRefresh = originalSchedule; view.refreshLocal = originalRefresh;
        delete view._blgDropsMoved;
        delete view._blgDropsAlias;
        st.alias.clear();
        button.remove(); legend.remove(); layer.remove(); view._blgDropsAttached = false;
      }
    };
    // El cierre de la vista destruye Cytoscape; evita conservar listeners/DOM.
    cy.on("destroy", function () { if (plugin._blgDrops && plugin._blgDrops.attached === handle) {
      handle.destroy(); plugin._blgDrops.attached = null; } });
    syncButton(); layer.setAttribute("hidden", ""); legend.hidden = true;
    return handle;
  }

  var _onload = PLUGIN_PROTO.onload, _onunload = PLUGIN_PROTO.onunload;
  PLUGIN_PROTO.onload = async function () {
    pluginInstance = this; this._blgDrops = { attached: null };
    try { hookSettingTab(this); } catch (e) { warn(e); }
    await _onload.call(this);
    try {
      if (applyDefaults(this)) await this.saveSettings();
      var plugin = this;
      function tryAttach() {
        try { var v = plugin.getView && plugin.getView();
          if (!v || !v.cy || !v.graphEl) return;
          if (plugin._blgDrops.attached && plugin._blgDrops.attached.view !== v) {
            plugin._blgDrops.attached.destroy(); plugin._blgDrops.attached = null;
          }
          if (!plugin._blgDrops.attached) {
            var h = attachView(plugin, v); if (h) { h.view = v; plugin._blgDrops.attached = h; }
          }
        } catch (e) { warn(e); }
      }
      plugin.registerEvent(plugin.app.workspace.on("layout-change", tryAttach));
      plugin.registerEvent(plugin.app.workspace.on("active-leaf-change", tryAttach));
      setTimeout(tryAttach, 300); setTimeout(tryAttach, 1200);
    } catch (e) { warn(e); }
  };
  PLUGIN_PROTO.onunload = function () {
    try { if (this._blgDrops && this._blgDrops.attached) this._blgDrops.attached.destroy(); } catch (e) { warn(e); }
    this._blgDrops = null; pluginInstance = null;
    if (typeof globalThis !== "undefined" && globalThis.__BLG_DROPS === sharedApi) delete globalThis.__BLG_DROPS;
    return _onunload.call(this);
  };
})();
