/* ============================================================
   Better Local Graph — Fondos animados programables (inyectado)
   Pegar este bloque COMPLETO al FINAL de main.js (última línea).
   Solo desktop (usa fs/path/require). Config en data.json:
     "activeBackgroundSnippet": "nombre-del-snippet" | ""
   Snippets: carpeta <plugin>/backgrounds/*.js (CommonJS):
     module.exports = {
       name: "...",                  // opcional
       init(ctx, api){},             // opcional, una vez
       frame(ctx, api, t){},         // requerido, cada frame
       destroy(){}                   // opcional
     };
   api ve: width,height,theme,mode,centralNote,hoveredNode,
          selectedNodes,zoom,colors,onHover(),onModeChange()
   ============================================================ */
(function () {
  "use strict";
  var PLUGIN_PROTO;
  try { PLUGIN_PROTO = module.exports && module.exports.default && module.exports.default.prototype; } catch (e) { return; }
  if (!PLUGIN_PROTO) { try { console.warn("[BLG BG] no se encontro el prototipo del plugin"); } catch (_) {} return; }

  var fs, path, Oe;
  try { fs = require("fs"); path = require("path"); } catch (e) { return; } // movil: sin Node, salir en silencio
  try { Oe = require("obsidian"); } catch (e) { Oe = null; }

  function loc(es, en) { return (typeof BLG_LANG !== "undefined" && BLG_LANG === "en") ? en : es; }
  var ua = "better-local-graph-view";

  /* ---------- rutas / archivos ---------- */
  function bgDir(plugin) {
    var dir = plugin.manifest && plugin.manifest.dir;
    if (!dir) { try { dir = path.join(plugin.app.vault.adapter.getBasePath(), ".obsidian/plugins", plugin.manifest.id); } catch (e) { dir = path.join(process.cwd(), plugin.manifest.id); } }
    if (!path.isAbsolute(dir)) { try { dir = path.join(plugin.app.vault.adapter.getBasePath(), dir); } catch (e) { dir = path.resolve(dir); } }
    return path.join(dir, "backgrounds");
  }
  function listSnippets(plugin) {
    var d = bgDir(plugin), out = [];
    try { var ls = fs.readdirSync(d); ls.forEach(function (f) { if (/\.js$/i.test(f)) out.push({ name: f.replace(/\.js$/i, ""), path: path.join(d, f) }); }); } catch (e) {}
    out.sort(function (a, b) { return a.name.localeCompare(b.name); });
    return out;
  }
  function readSnippetFile(p) { return fs.readFileSync(p, "utf8"); }
  function writeSnippetFile(p, src) { fs.writeFileSync(p, src, "utf8"); }
  function deleteSnippetFile(p) { try { fs.unlinkSync(p); } catch (e) {} }

  /* ---------- limpiar fuente pegada ---------- */
  function cleanSource(src) {
    if (!src) return "";
    src = String(src).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    var m = src.match(/```(?:js|javascript|node|JS)?\s*\n([\s\S]*?)\n```/i);
    if (m) src = m[1];
    return src.trim();
  }

  /* ---------- evaluar snippet (CommonJS) ---------- */
  function evalSnippet(src) {
    src = cleanSource(src);
    var module = { exports: {} };
    var fn = new Function("module", "exports", "require", "console", "Math", "Date", "performance", "setTimeout", "setInterval", "clearTimeout", "clearInterval", src + "\n;return module.exports;");
    var exp = fn(module, module.exports, require, console, Math, Date, performance, setTimeout, setInterval, clearTimeout, clearInterval);
    return (exp && typeof exp === "object") ? exp : module.exports;
  }

  function drawError(ctx, msg) {
    var c = ctx.canvas;
    ctx.save(); ctx.fillStyle = "#3a1212"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = "#ffb4b4"; ctx.font = "12px monospace";
    var m = ("" + (msg || "Error")).slice(0, 240); ctx.fillText(m, 8, 18);
    ctx.restore();
  }

  /* ---------- ejemplos ---------- */
  var TEMPLATE =
    "module.exports = {\n" +
    "  name: \"Mi fondo\",\n" +
    "  init(ctx, api){ this.t = 0; },\n" +
    "  frame(ctx, api, t){\n" +
    "    var w = api.width, h = api.height;\n" +
    "    ctx.clearRect(0,0,w,h);\n" +
    "    var cx = w/2, cy = h/2, R = Math.min(w,h)*0.25;\n" +
    "    var tx = api.hoveredNode ? api.hoveredNode.x : cx + Math.cos(t/1400)*R*1.5;\n" +
    "    var ty = api.hoveredNode ? api.hoveredNode.y : cy + Math.sin(t/1400)*R*1.5;\n" +
    "    ctx.beginPath(); ctx.arc(cx,cy,R,0,Math.PI*2);\n" +
    "    ctx.fillStyle = api.colors.bgColor || \"#111\"; ctx.fill();\n" +
    "    ctx.lineWidth = 2; ctx.strokeStyle = \"#888\"; ctx.stroke();\n" +
    "    var dx = tx-cx, dy = ty-cy, d = Math.hypot(dx,dy)||1, f = Math.min(R*0.4, d)/d;\n" +
    "    var ix = cx+dx*f, iy = cy+dy*f, r = R*0.4;\n" +
    "    ctx.beginPath(); ctx.arc(ix,iy,r,0,Math.PI*2);\n" +
    "    ctx.fillStyle = api.colors.hoverColor || \"#e0a13c\"; ctx.fill();\n" +
    "    ctx.beginPath(); ctx.arc(ix,iy,r*0.4,0,Math.PI*2); ctx.fillStyle = \"#111\"; ctx.fill();\n" +
    "  }\n" +
    "};\n";

  var EXAMPLES = {
    "ojo-vigilante.js":
      "module.exports = {\n" +
      "  name: \"Ojo vigilante\",\n" +
      "  init(ctx, api){ this.px = 0; this.py = 0; },\n" +
      "  frame(ctx, api, t){\n" +
      "    var w = api.width, h = api.height; ctx.clearRect(0,0,w,h);\n" +
      "    var cx = w/2, cy = h/2, R = Math.min(w,h)*0.28;\n" +
      "    var tx = api.hoveredNode ? api.hoveredNode.x : cx + Math.cos(t/1400)*R*1.6;\n" +
      "    var ty = api.hoveredNode ? api.hoveredNode.y : cy + Math.sin(t/1400)*R*1.6;\n" +
      "    var dx = tx-cx, dy = ty-cy, d = Math.hypot(dx,dy)||1;\n" +
      "    var mx = Math.max(-R*0.4, Math.min(R*0.4, d)), f = mx/d;\n" +
      "    this.px += (dx*f - this.px)*0.15; this.py += (dy*f - this.py)*0.15;\n" +
      "    ctx.beginPath(); ctx.arc(cx,cy,R,0,Math.PI*2);\n" +
      "    ctx.fillStyle = api.colors.bgColor || \"#1e1e1e\"; ctx.fill();\n" +
      "    ctx.lineWidth = 2; ctx.strokeStyle = \"#888\"; ctx.stroke();\n" +
      "    var ix = cx+this.px, iy = cy+this.py, r = R*0.45;\n" +
      "    var g = ctx.createRadialGradient(ix,iy,r*0.1,ix,iy,r);\n" +
      "    g.addColorStop(0, api.colors.hoverColor || \"#e0a13c\");\n" +
      "    g.addColorStop(1, api.colors.parentColor || \"#5b8def\");\n" +
      "    ctx.beginPath(); ctx.arc(ix,iy,r,0,Math.PI*2); ctx.fillStyle = g; ctx.fill();\n" +
      "    ctx.beginPath(); ctx.arc(ix,iy,r*0.4,0,Math.PI*2); ctx.fillStyle = \"#111\"; ctx.fill();\n" +
      "    ctx.beginPath(); ctx.arc(ix-r*0.18, iy-r*0.18, r*0.12, 0, Math.PI*2); ctx.fillStyle = \"rgba(255,255,255,.8)\"; ctx.fill();\n" +
      "  }\n" +
      "};\n",
    "rostro-ia.js":
      "module.exports = {\n" +
      "  name: \"Rostro IA\",\n" +
      "  frame(ctx, api, t){\n" +
      "    var w = api.width, h = api.height; ctx.clearRect(0,0,w,h);\n" +
      "    var cx = w/2, cy = h/2, S = Math.min(w,h);\n" +
      "    ctx.strokeStyle = \"rgba(91,141,239,.10)\"; ctx.lineWidth = 1;\n" +
      "    for (var x = 0; x < w; x += 24){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }\n" +
      "    for (var y = 0; y < h; y += 24){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }\n" +
      "    ctx.save(); ctx.translate(cx,cy);\n" +
      "    ctx.strokeStyle = api.colors.parentColor || \"#5b8def\"; ctx.lineWidth = 2;\n" +
      "    ctx.beginPath(); ctx.ellipse(0,0, S*0.16, S*0.2, 0, 0, Math.PI*2); ctx.stroke();\n" +
      "    var tx = api.hoveredNode ? api.hoveredNode.x - cx : Math.cos(t/2000)*S*0.3;\n" +
      "    var ty = api.hoveredNode ? api.hoveredNode.y - cy : Math.sin(t/2000)*S*0.2;\n" +
      "    var a = Math.atan2(ty, tx), mag = Math.min(6, Math.hypot(tx,ty)*0.05);\n" +
      "    var eyes = [[-S*0.06, -S*0.02], [S*0.06, -S*0.02]];\n" +
      "    for (var i = 0; i < eyes.length; i++){\n" +
      "      var e = eyes[i];\n" +
      "      ctx.beginPath(); ctx.arc(e[0]+Math.cos(a)*mag, e[1]+Math.sin(a)*mag, S*0.025, 0, Math.PI*2);\n" +
      "      ctx.fillStyle = api.colors.hoverColor || \"#e0a13c\"; ctx.fill();\n" +
      "    }\n" +
      "    var ml = Math.sin(t/300); ctx.beginPath(); ctx.moveTo(-S*0.05, S*0.06); ctx.lineTo(S*0.05, S*0.06);\n" +
      "    ctx.strokeStyle = api.colors.linkColor || \"#888\"; ctx.lineWidth = 2 + ml; ctx.stroke();\n" +
      "    ctx.restore();\n" +
      "  }\n" +
      "};\n",
    "ondas.js":
      "module.exports = {\n" +
      "  name: \"Ondas\",\n" +
      "  frame(ctx, api, t){\n" +
      "    var w = api.width, h = api.height; ctx.clearRect(0,0,w,h);\n" +
      "    var st = api.colors || {};\n" +
      "    function ripple(x, y, off, col){\n" +
      "      for (var i = 0; i < 4; i++){\n" +
      "        var r = ((t/6 + i*40 + off) % 240);\n" +
      "        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2);\n" +
      "        ctx.strokeStyle = col; ctx.globalAlpha = Math.max(0, 1 - r/240)*0.5; ctx.stroke();\n" +
      "      }\n" +
      "      ctx.globalAlpha = 1;\n" +
      "    }\n" +
      "    if (api.hoveredNode) ripple(api.hoveredNode.x, api.hoveredNode.y, 0, st.hoverColor || \"#e0a13c\");\n" +
      "    ripple(w/2, h/2, 80, st.parentColor || \"#5b8def\");\n" +
      "    ripple(w/2, h/2, 200, st.childColor || \"#5b8def\");\n" +
      "  }\n" +
      "};\n"
  };

  function seedExamples(plugin) {
    var d = bgDir(plugin);
    try {
      try { fs.accessSync(d); } catch (e) { fs.mkdirSync(d, { recursive: true }); }
      var any = false; try { var ls = fs.readdirSync(d); if (ls && ls.length) any = true; } catch (e) {}
      if (!any) { Object.keys(EXAMPLES).forEach(function (n) { try { fs.writeFileSync(path.join(d, n), EXAMPLES[n], "utf8"); } catch (e) {} }); }
    } catch (e) { console.warn("[BLG BG] seed:", e); }
  }

  /* ---------- API del grafo en vivo ---------- */
  function makeApi(plugin, view, graphEl, canvas) {
    var api = {
      get width() { return graphEl.clientWidth || canvas.width; },
      get height() { return graphEl.clientHeight || canvas.height; },
      get theme() { return document.body.classList.contains("theme-light") ? "light" : "dark"; },
      get mode() { if (plugin.tagView) return "tag"; if (plugin.session) return "sewing"; return "local"; },
      get centralNote() {
        if (plugin.tagView && plugin.tagView.tag) return { path: null, basename: "#" + plugin.tagView.tag };
        if (plugin.session) return { path: plugin.session.parentPath, basename: plugin.session.parentName };
        if (view.currentPath) { var p = view.currentPath.split("/").pop().replace(/\.md$/, ""); return { path: view.currentPath, basename: p }; }
        return null;
      },
      hoveredNode: null,
      get selectedNodes() { try { return (view._sel || []).map(function (s) { return { path: s.path, basename: s.name }; }); } catch (e) { return []; } },
      get zoom() { try { return view.cy ? view.cy.zoom() : 1; } catch (e) { return 1; } },
      colors: plugin.settings,
      _hoverCbs: [], onHover: function (fn) { api._hoverCbs.push(fn); return function () { var i = api._hoverCbs.indexOf(fn); if (i >= 0) api._hoverCbs.splice(i, 1); }; },
      _modeCbs: [], onModeChange: function (fn) { api._modeCbs.push(fn); return function () { var i = api._modeCbs.indexOf(fn); if (i >= 0) api._modeCbs.splice(i, 1); }; }
    };
    return api;
  }

  /* ---------- acoplar fondo a la vista en vivo ---------- */
  function attachView(plugin, view) {
    if (view._blgBgAttached) return;
    view._blgBgAttached = true;
    var graphEl = view.graphEl;
    if (!graphEl) return;
    graphEl.style.position = "relative";
    var canvas = document.createElement("canvas");
    canvas.className = "blg-bg-canvas";
    canvas.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;z-index:0;pointer-events:none;";
    graphEl.insertBefore(canvas, graphEl.firstChild);
    var dpr = window.devicePixelRatio || 1;
    function resize() { var w = graphEl.clientWidth || 1, h = graphEl.clientHeight || 1; canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); canvas.style.width = w + "px"; canvas.style.height = h + "px"; canvas.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0); }
    resize();
    var ro = new ResizeObserver(resize); ro.observe(graphEl);
    var ctx = canvas.getContext("2d");
    var api = makeApi(plugin, view, graphEl, canvas);
    var st = { snip: null, running: true, raf: null, hoverMove: null };

    function setHover(n) {
      var nu = null;
      if (n) {
        var pos = { x: 0, y: 0 };
        try { pos = n.renderedPosition(); } catch (e) {}
        nu = { path: n.id(), basename: ("" + n.id()).split("/").pop().replace(/\.md$/, ""), x: pos.x, y: pos.y };
      }
      var cur = api.hoveredNode;
      var changed = (!cur && nu) || (cur && !nu) || (cur && nu && cur.path !== nu.path);
      if (changed) {
        api.hoveredNode = nu;
        for (var i = 0; i < api._hoverCbs.length; i++) { try { api._hoverCbs[i](nu); } catch (e) {} }
      } else if (cur && nu) { cur.x = nu.x; cur.y = nu.y; }
    }
    function hitTest() {
      if (!st.hoverMove || !view.cy) { setHover(null); return; }
      var x = st.hoverMove.x, y = st.hoverMove.y, found = null;
      try {
        view.cy.nodes().forEach(function (n) {
          if (found) return;
          try { if (n.style("display") === "none") return; var bb = n.renderedBoundingBox({ includeLabels: false, includeOverlays: false }); if (x >= bb.x1 && x <= bb.x2 && y >= bb.y1 && y <= bb.y2) found = n; } catch (e) {}
        });
      } catch (e) {}
      setHover(found);
    }
    function onMove(e) { var rect = graphEl.getBoundingClientRect(); st.hoverMove = { x: e.clientX - rect.left, y: e.clientY - rect.top }; hitTest(); }
    function onLeave() { st.hoverMove = null; setHover(null); }
    graphEl.addEventListener("mousemove", onMove);
    graphEl.addEventListener("mouseleave", onLeave);

    function loadByName(name) {
      try {
        if (st.snip && typeof st.snip.destroy === "function") { try { st.snip.destroy(); } catch (e) {} }
      } catch (e) {}
      st.snip = null;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!name) return;
      try {
        var src = readSnippetFile(path.join(bgDir(plugin), name + ".js"));
        var m = evalSnippet(src);
        st.snip = m;
        if (m && typeof m.init === "function") { try { m.init(ctx, api); } catch (e) { console.warn("[BLG BG] init:", e); } }
      } catch (e) { console.warn("[BLG BG] load:", e); drawError(ctx, e.message); }
    }
    function frame(t) {
      if (!st.running) return;
      st.raf = requestAnimationFrame(frame);
      if (!st.snip) return;
      try { if (typeof st.snip.frame === "function") st.snip.frame(ctx, api, t); else if (typeof st.snip === "function") st.snip(ctx, api, t); }
      catch (e) { /* frame con error: ignorar este frame */ }
    }
    function stop() { st.running = false; if (st.raf) cancelAnimationFrame(st.raf); st.raf = null; }
    st.raf = requestAnimationFrame(frame);

    var handle = {
      reload: function (name) { loadByName(name); },
      destroy: function () {
        stop();
        try { if (st.snip && typeof st.snip.destroy === "function") st.snip.destroy(); } catch (e) {}
        graphEl.removeEventListener("mousemove", onMove);
        graphEl.removeEventListener("mouseleave", onLeave);
        try { ro.disconnect(); } catch (e) {}
        try { canvas.remove(); } catch (e) {}
        view._blgBgAttached = false;
      }
    };
    plugin._blgBg.attached = handle;
    loadByName(plugin.settings.activeBackgroundSnippet || "");
    if (view.cy) { try { view.cy.on("destroy", function () { if (plugin._blgBg && plugin._blgBg.attached === handle) { handle.destroy(); plugin._blgBg.attached = null; } }); } catch (e) {} }
  }

  function reloadLive(plugin) {
    if (!plugin._blgBg) return;
    var a = plugin._blgBg.attached;
    if (a) { a.reload(plugin.settings.activeBackgroundSnippet || ""); return; }
    var v = plugin.getView && plugin.getView();
    if (v && v.cy && v.graphEl && !v._blgBgAttached) attachView(plugin, v);
  }

  /* ---------- preview (settings) ---------- */
  function startPreview(canvas, snip) {
    var ctx = canvas.getContext("2d");
    var api = {
      width: canvas.width, height: canvas.height, theme: "dark", mode: "local",
      centralNote: { path: null, basename: "Preview" }, hoveredNode: null, selectedNodes: [], zoom: 1,
      colors: { bgColor: "#101418", parentColor: "#5b8def", childColor: "#5b8def", hoverColor: "#e0a13c", linkColor: "#888", textColor: "#ddd" },
      onHover: function () { return function () {}; }, onModeChange: function () { return function () {}; }
    };
    var ctrl = { running: true, raf: null, snip: snip };
    try { if (snip && typeof snip.init === "function") snip.init(ctx, api); } catch (e) { ctx.clearRect(0, 0, canvas.width, canvas.height); drawError(ctx, e.message); }
    var t0 = performance.now();
    function loop(t) {
      if (!ctrl.running) return;
      ctrl.raf = requestAnimationFrame(loop);
      var tt = t - t0;
      api.hoveredNode = { x: canvas.width / 2 + Math.cos(tt / 1200) * canvas.width * 0.3, y: canvas.height / 2 + Math.sin(tt / 1200) * canvas.height * 0.25, path: "preview", basename: "Preview" };
      try { if (typeof snip.frame === "function") snip.frame(ctx, api, t); else if (typeof snip === "function") snip(ctx, api, t); }
      catch (e) { ctrl.running = false; ctx.clearRect(0, 0, canvas.width, canvas.height); drawError(ctx, e.message); }
    }
    ctrl.raf = requestAnimationFrame(loop);
    ctrl.stop = function () { ctrl.running = false; if (ctrl.raf) cancelAnimationFrame(ctrl.raf); ctrl.raf = null; try { if (snip && typeof snip.destroy === "function") snip.destroy(); } catch (e) {} };
    return ctrl;
  }

  function confirmDialog(app, msg, onYes) {
    var m = new Oe.Modal(app); m.titleEl.setText(loc("Confirmar", "Confirm"));
    m.contentEl.createEl("p", { text: msg });
    var row = m.contentEl.createDiv(); row.style.cssText = "display:flex;gap:8px;justify-content:flex-end;margin-top:8px";
    var yes = row.createEl("button", { text: loc("Si", "Yes"), cls: "mod-cta" }); yes.onclick = function () { m.close(); onYes && onYes(); };
    var no = row.createEl("button", { text: loc("Cancelar", "Cancel") }); no.onclick = function () { m.close(); };
    m.open();
  }

  /* ---------- editor modal ---------- */
  function EditorModal(plugin, name, src, onSaved) {
    var m = new Oe.Modal(plugin.app);
    m.titleEl.setText(loc("Editor de fondo animado", "Background editor"));
    m.modalEl.style.width = "720px";
    var nameRow = m.contentEl.createDiv(); nameRow.style.cssText = "margin:8px 0;display:flex;align-items:center;gap:8px";
    nameRow.createEl("span", { text: loc("Nombre:", "Name:") }).style.fontWeight = "600";
    var ni = nameRow.createEl("input", { type: "text" }); ni.value = name || ""; ni.placeholder = loc("mi-fondo", "my-bg"); ni.style.cssText = "flex:1";
    var body = m.contentEl.createDiv(); body.style.cssText = "display:flex;gap:10px;align-items:flex-start";
    var ta = body.createEl("textarea"); ta.value = src || TEMPLATE; ta.style.cssText = "flex:1;width:62%;height:240px;font-family:monospace;font-size:12px;resize:vertical";
    var pv = body.createEl("canvas"); pv.width = 260; pv.height = 180; pv.style.cssText = "flex:0 0 auto;border:1px solid var(--background-modifier-border);border-radius:6px;background:#101418";
    var ctx = pv.getContext("2d");
    var curSrc = ta.value, ctrl = null;
    function reloadPreview() { if (ctrl) ctrl.stop(); try { ctrl = startPreview(pv, evalSnippet(curSrc)); } catch (e) { if (ctrl) ctrl.stop(); ctx.clearRect(0, 0, pv.width, pv.height); drawError(ctx, e.message); } }
    var to = null; ta.oninput = function () { curSrc = ta.value; clearTimeout(to); to = setTimeout(reloadPreview, 250); };
    reloadPreview();
    var ft = m.contentEl.createDiv(); ft.style.cssText = "display:flex;gap:8px;justify-content:flex-end;margin-top:8px";
    var save = ft.createEl("button", { text: loc("Guardar", "Save"), cls: "mod-cta" });
    save.onclick = function () {
      var nm = (ni.value || "").trim().replace(/^\/+/, "").replace(/\.js$/i, "").replace(/\s+/g, " ").trim();
      if (!nm) { new Oe.Notice(loc("Nombre vacio", "Empty name")); return; }
      if (!/^[A-Za-z0-9 _\-]+$/.test(nm)) { new Oe.Notice(loc("Solo letras, numeros, _ o -", "Only letters, numbers, _ or -")); return; }
      var dest = path.join(bgDir(plugin), nm + ".js");
      var cleaned = cleanSource(curSrc);
      try { new Function(cleaned); } catch (e) {
        new Oe.Notice(loc("Sintaxis invalida: ", "Invalid syntax: ") + (e && e.message ? e.message : e));
        return;
      }
      try {
        writeSnippetFile(dest, cleaned);
        if (!fs.existsSync(dest)) { throw new Error(loc("el archivo no se creo", "file was not created")); }
      } catch (e) {
        new Oe.Notice(loc("No se pudo guardar: ", "Could not save: ") + (e && e.message ? e.message : e));
        return;
      }
      new Oe.Notice(loc("Fondo guardado", "Background saved"));
      m.close(); onSaved && onSaved(nm);
    };
    var ca = ft.createEl("button", { text: loc("Cancelar", "Cancel") }); ca.onclick = function () { if (ctrl) ctrl.stop(); m.close(); };
    m.onClose = function () { if (ctrl) ctrl.stop(); };
    m.open();
  }

  /* ---------- seccion de ajustes (pestaña propia) ---------- */
  function injectSettings(plugin, containerEl) {
    if (!plugin._blgBg) return;
    if (plugin._blgBg.lastPreview) { try { plugin._blgBg.lastPreview.stop(); } catch (e) {} plugin._blgBg.lastPreview = null; }
    var nav = containerEl.querySelector(".blg-settings-tabs");
    var panelsHost = containerEl.querySelector(".blg-settings-panels");
    if (!nav || !panelsHost) {
      // fallback: contenedor plano (sin tabs). Lo anexamos al final.
      panelsHost = containerEl;
      nav = null;
    }

    var TAB_KEY = "fondos";
    var myBtn = null, myPanel = null;
    if (nav) {
      myBtn = nav.createEl("button", { cls: "blg-settings-tab", text: loc("Fondos", "Backgrounds") });
      myPanel = panelsHost.createDiv({ cls: "blg-settings-panel" });
      // al clickar mi tab: desactivo todo y activo el mio
      myBtn.addEventListener("click", function () {
        containerEl.querySelectorAll(".blg-settings-tab").forEach(function (b) { b.removeClass("active"); });
        containerEl.querySelectorAll(".blg-settings-panel").forEach(function (p) { p.removeClass("active"); });
        myBtn.addClass("active"); myPanel.addClass("active");
        try { plugin.settings.lastSettingsTab = TAB_KEY; plugin.saveSettings(); } catch (e) {}
        refreshPreview();
      });
      // que los tabs originales tambien desactiven el mio (se reconstruye cada display, no hay dup)
      nav.querySelectorAll(".blg-settings-tab").forEach(function (b) {
        if (b === myBtn) return;
        b.addEventListener("click", function () {
          myBtn.removeClass("active"); myPanel.removeClass("active");
          if (plugin._blgBg && plugin._blgBg.lastPreview) { try { plugin._blgBg.lastPreview.stop(); } catch (e) {} plugin._blgBg.lastPreview = null; }
        });
      });
    } else {
      myPanel = containerEl.createDiv({ cls: "blg-bg-section" });
      myPanel.style.cssText = "margin-top:18px;border-top:1px solid var(--background-modifier-border);padding-top:12px";
    }

    var sec = myPanel;
    sec.createEl("h3", { text: loc("Fondos animados", "Animated backgrounds") });
    var desc = sec.createEl("p", { text: loc("Snippets JS de fondo que reaccionan al hover del grafo. Uno activo a la vez.", "JS background snippets that react to graph hover. One active at a time.") });
    desc.style.cssText = "color:var(--text-muted);font-size:var(--font-ui-small);margin-bottom:8px";

    var row = sec.createDiv(); row.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:8px";
    var dd = document.createElement("select"); dd.style.cssText = "width:auto";
    function refreshList() {
      dd.innerHTML = "";
      var none = document.createElement("option"); none.value = ""; none.text = loc("(Ninguno)", "(None)"); dd.appendChild(none);
      listSnippets(plugin).forEach(function (s) { var o = document.createElement("option"); o.value = s.name; o.text = s.name; dd.appendChild(o); });
      dd.value = plugin.settings.activeBackgroundSnippet || "";
    }
    refreshList();
    dd.onchange = function () { plugin.settings.activeBackgroundSnippet = dd.value; plugin.saveSettings(); reloadLive(plugin); refreshPreview(); };
    row.append(dd);
    var bNew = row.createEl("button", { text: loc("Nuevo", "New") });
    bNew.onclick = function () { EditorModal(plugin, "", TEMPLATE, function (nm) { plugin.settings.activeBackgroundSnippet = nm; plugin.saveSettings(); refreshList(); reloadLive(plugin); refreshPreview(); }); };
    var bEdit = row.createEl("button", { text: loc("Editar", "Edit") });
    bEdit.onclick = function () {
      var nm = plugin.settings.activeBackgroundSnippet; if (!nm) { new Oe.Notice(loc("Selecciona un fondo", "Select a background")); return; }
      var src = ""; try { src = readSnippetFile(path.join(bgDir(plugin), nm + ".js")); } catch (e) {}
      EditorModal(plugin, nm, src, function (nm2) {
        var newPath = path.join(bgDir(plugin), nm2 + ".js");
        if (!fs.existsSync(newPath)) { new Oe.Notice(loc("El nuevo fondo no se guardo; se conserva el original", "New background not saved; keeping original")); refreshList(); return; }
        if (nm2 !== nm) { deleteSnippetFile(path.join(bgDir(plugin), nm + ".js")); }
        plugin.settings.activeBackgroundSnippet = nm2; plugin.saveSettings(); refreshList(); reloadLive(plugin); refreshPreview();
      });
    };
    var bDel = row.createEl("button", { text: loc("Eliminar", "Delete") });
    bDel.onclick = function () {
      var nm = plugin.settings.activeBackgroundSnippet; if (!nm) return;
      confirmDialog(plugin.app, loc("¿Eliminar el fondo \"" + nm + "\"?", "Delete background \"" + nm + "\"?"), function () {
        deleteSnippetFile(path.join(bgDir(plugin), nm + ".js")); plugin.settings.activeBackgroundSnippet = ""; plugin.saveSettings(); refreshList(); reloadLive(plugin); refreshPreview();
      });
    };
    var bOpen = row.createEl("button", { text: loc("Abrir carpeta", "Open folder") });
    bOpen.onclick = function () { try { require("electron").shell.openPath(bgDir(plugin)); } catch (e) { new Oe.Notice(bgDir(plugin)); } };

    var pvSec = sec.createDiv(); pvSec.style.cssText = "margin-top:6px";
    var lbl = pvSec.createEl("div", { text: loc("Vista previa", "Preview") }); lbl.style.cssText = "font-weight:600;margin-bottom:4px";
    var pv = pvSec.createEl("canvas"); pv.width = 420; pv.height = 180; pv.style.cssText = "max-width:100%;border:1px solid var(--background-modifier-border);border-radius:6px;background:#101418";
    var pctx = pv.getContext("2d");
    function refreshPreview() {
      if (plugin._blgBg.lastPreview) { try { plugin._blgBg.lastPreview.stop(); } catch (e) {} plugin._blgBg.lastPreview = null; }
      pctx.clearRect(0, 0, pv.width, pv.height);
      var nm = plugin.settings.activeBackgroundSnippet; if (!nm) return;
      try { var s = evalSnippet(readSnippetFile(path.join(bgDir(plugin), nm + ".js"))); plugin._blgBg.lastPreview = startPreview(pv, s); }
      catch (e) { pctx.clearRect(0, 0, pv.width, pv.height); drawError(pctx, e.message); }
    }

    // activar mi tab si era la ultima usada
    var wasActive = false;
    try { wasActive = plugin.settings.lastSettingsTab === TAB_KEY; } catch (e) {}
    if (myBtn && wasActive) {
      containerEl.querySelectorAll(".blg-settings-tab").forEach(function (b) { b.removeClass("active"); });
      containerEl.querySelectorAll(".blg-settings-panel").forEach(function (p) { p.removeClass("active"); });
      myBtn.addClass("active"); myPanel.addClass("active");
      refreshPreview();
    } else if (myBtn) {
      // inactiva por defecto; el preview arranca solo si la tab esta activa
      myBtn.removeClass("active"); myPanel.removeClass("active");
    } else {
      refreshPreview();
    }

    var mo = new MutationObserver(function () { if (!containerEl.isConnected) { if (plugin._blgBg && plugin._blgBg.lastPreview) { try { plugin._blgBg.lastPreview.stop(); } catch (e) {} plugin._blgBg.lastPreview = null; } mo.disconnect(); } });
    try { mo.observe(containerEl.parentElement || document.body, { childList: true, subtree: false }); } catch (e) {}
  }

  /* ---------- hook addSettingTab para capturar la instancia real ---------- */
  function hookAddSettingTab(plugin) {
    var origAdd = plugin.addSettingTab.bind(plugin);
    plugin.addSettingTab = function (tab) {
      try {
        if (tab && tab.plugin && tab.plugin === plugin && typeof tab.display === "function" && !tab._blgBgHooked) {
          var _d = tab.display;
          tab.display = function () {
            var r = _d.apply(this, arguments);
            try { injectSettings(this.plugin, this.containerEl); }
            catch (e) { console.warn("[BLG BG] settings inject:", e); }
            return r;
          };
          tab._blgBgHooked = true;
        }
      } catch (e) { console.warn("[BLG BG] hook display:", e); }
      return origAdd(tab);
    };
  }

  /* ---------- envolver onload / onunload ---------- */
  var _onload = PLUGIN_PROTO.onload;
  var _onunload = PLUGIN_PROTO.onunload;

  PLUGIN_PROTO.onload = async function () {
    try {
      this._blgBg = { attached: null, lastPreview: null };
      seedExamples(this);
      hookAddSettingTab(this);
    } catch (e) { console.warn("[BLG BG] onload pre:", e); }
    await _onload.call(this);
    try {
      var plugin = this;
      function tryAttach() { var v = plugin.getView && plugin.getView(); if (v && v.cy && v.graphEl && !v._blgBgAttached) attachView(plugin, v); }
      try { plugin.registerEvent(plugin.app.workspace.on("layout-change", tryAttach)); } catch (e) {}
      try { plugin.registerEvent(plugin.app.workspace.on("active-leaf-change", tryAttach)); } catch (e) {}
      setTimeout(tryAttach, 300); setTimeout(tryAttach, 1200);
    } catch (e) { console.warn("[BLG BG] onload post:", e); }
  };

  PLUGIN_PROTO.onunload = function () {
    try {
      if (this._blgBg) {
        if (this._blgBg.attached) { try { this._blgBg.attached.destroy(); } catch (e) {} this._blgBg.attached = null; }
        if (this._blgBg.lastPreview) { try { this._blgBg.lastPreview.stop(); } catch (e) {} this._blgBg.lastPreview = null; }
        this._blgBg = null;
      }
    } catch (e) {}
    return _onunload.call(this);
  };
})();
