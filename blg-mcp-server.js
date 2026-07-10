/* ============================================================
   Better Local Graph — Servidor MCP embebido (inyectado)
   Transporte: MCP Streamable HTTP (JSON-RPC 2.0) en 127.0.0.1
   Pegar este bloque COMPLETO al FINAL de main.js (última línea).
   Solo desktop. Config en data.json:
     "mcpEnabled": true,
     "mcpPort": 27125,
     "mcpToken": "un-token-largo-y-aleatorio"
   ============================================================ */
(function () {
  "use strict";
  var PLUGIN_PROTO;
  try {
    PLUGIN_PROTO = module.exports && module.exports.default && module.exports.default.prototype;
  } catch (e) { return; }
  if (!PLUGIN_PROTO) { try { console.warn("[BLG MCP] no se encontró el prototipo del plugin"); } catch (_) {} return; }

  var http;
  try { http = require("http"); } catch (e) { return; } // móvil: sin Node, salir en silencio

  var crypto;
  try { crypto = require("crypto"); } catch (e) { crypto = null; }

  var SRV_NAME = "better-local-graph-mcp";
  var SRV_VERSION = "1.0.0";
  var DEFAULT_PORT = 27125;

  /* ---------- utilidades compartidas con el plugin ---------- */

  // idéntico a Qf() del bundle
  function blgSlug(t) {
    return String(t).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9_-]+/g, "-").replace(/-+/g, "-")
      .replace(/^-|-$/g, "").toLowerCase() || "nota";
  }

  // idéntico al matching de subtags de renderTagGraph()
  function tagMatches(candidate, wanted) {
    var x = String(candidate).replace(/^#/, "");
    if (x === wanted) return true;
    if (x.indexOf(wanted + "/") === 0) return true;
    var seg = x.split("/"), w = wanted.split("/"), wl = w.length;
    for (var i = 0; i + wl <= seg.length; i++) {
      var ok = true;
      for (var j = 0; j < wl; j++) { if (seg[i + j] !== w[j]) { ok = false; break; } }
      if (ok) return true;
    }
    return false;
  }

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

  // idéntico a _sewingTargets() del bundle
  function sewingTargets(app, file) {
    var out = new Set();
    var c = app.metadataCache.getFileCache(file);
    var fm = c && c.frontmatter;
    var sv = fm && fm.sewing;
    if (sv == null) return out;
    var ls = Array.isArray(sv) ? sv : [sv];
    for (var i = 0; i < ls.length; i++) {
      var it = ls[i];
      if (typeof it !== "string") continue;
      var mm = it.match(/\[\[([^\]|#]+)/);
      var lt = (mm ? mm[1] : it).trim();
      if (!lt) continue;
      var tf = app.metadataCache.getFirstLinkpathDest(lt, file.path);
      if (tf) out.add(tf.path);
    }
    return out;
  }

  // acepta ruta exacta, ruta sin .md, wikilink o basename
  function resolveFile(app, ref) {
    if (!ref) return null;
    ref = String(ref).trim().replace(/^\[\[|\]\]$/g, "");
    var Oe = require("obsidian");
    var f = app.vault.getAbstractFileByPath(ref);
    if (f instanceof Oe.TFile) return f;
    f = app.vault.getAbstractFileByPath(ref + ".md");
    if (f instanceof Oe.TFile) return f;
    f = app.metadataCache.getFirstLinkpathDest(ref, "");
    if (f) return f;
    var low = ref.toLowerCase();
    var all = app.vault.getMarkdownFiles();
    for (var i = 0; i < all.length; i++) if (all[i].basename.toLowerCase() === low) return all[i];
    return null;
  }

  /* ---------- definición de herramientas MCP ---------- */

  function buildTools(plugin) {
    var app = plugin.app;

    return {
      blg_list_tags: {
        description: "Lista todos los tags del vault (excluyendo carpetas excluidas del plugin) con el número de notas de cada uno. Úsalo para descubrir la estructura del vault antes de pedir un grafo.",
        inputSchema: { type: "object", properties: {
          prefix: { type: "string", description: "Opcional: filtra tags que empiecen por este prefijo, p. ej. 'dev'" }
        } },
        handler: function (args) {
          var counts = {};
          var excluded = (plugin.settings && plugin.settings.excludedFolders) || [];
          var files = app.vault.getMarkdownFiles();
          for (var i = 0; i < files.length; i++) {
            var f = files[i], skip = false;
            for (var e = 0; e < excluded.length; e++) {
              if (f.path === excluded[e] || f.path.indexOf(excluded[e] + "/") === 0) { skip = true; break; }
            }
            if (skip) continue;
            var tags = fileTags(app, f), seen = new Set();
            for (var t = 0; t < tags.length; t++) {
              var tg = tags[t];
              if (!tg || seen.has(tg)) continue;
              seen.add(tg);
              counts[tg] = (counts[tg] || 0) + 1;
            }
          }
          var pfx = args && args.prefix ? String(args.prefix).replace(/^#/, "") : null;
          var out = Object.keys(counts)
            .filter(function (k) { return !pfx || k === pfx || k.indexOf(pfx) === 0; })
            .sort()
            .map(function (k) { return { tag: k, count: counts[k] }; });
          return { total: out.length, tags: out };
        }
      },

      blg_get_tag_graph: {
        description: "Devuelve el grafo de la vista tag: todas las notas que tienen el tag (o subtag) indicado, con metadatos de edad, más las aristas entre ellas (wikilinks resueltos y costuras/sewing). Es la misma lógica que la vista visual del plugin.",
        inputSchema: { type: "object", required: ["tag"], properties: {
          tag: { type: "string", description: "Tag sin #, p. ej. 'herreria' o 'dev/obsidian'" }
        } },
        handler: function (args) {
          var wanted = String(args.tag || "").replace(/^#/, "").trim();
          if (!wanted) throw { code: -32602, message: "Falta el parámetro 'tag'" };
          var files = app.vault.getMarkdownFiles().filter(function (f) {
            var tags = fileTags(app, f);
            for (var i = 0; i < tags.length; i++) if (tagMatches(tags[i], wanted)) return true;
            return false;
          });
          var minT = Infinity, maxT = -Infinity;
          files.forEach(function (f) {
            var ct = (f.stat && f.stat.ctime) || 0;
            if (ct < minT) minT = ct; if (ct > maxT) maxT = ct;
          });
          var span = (maxT - minT) || 1;
          var pathSet = new Set(files.map(function (f) { return f.path; }));
          var nodes = files.map(function (f) {
            var ct = (f.stat && f.stat.ctime) || 0;
            return {
              path: f.path, basename: f.basename,
              ctime: ct, mtime: (f.stat && f.stat.mtime) || 0,
              freshness: Math.round(((ct - minT) / span) * 1000) / 1000, // 0=antigua 1=reciente
              tags: fileTags(app, f)
            };
          });
          var edges = [], seen = new Map();
          function pushEdge(A, B, kind) {
            if (!A || !B || A === B) return;
            if (!pathSet.has(A) || !pathSet.has(B)) return;
            var k = A < B ? A + "\u0000" + B : B + "\u0000" + A;
            var ex = seen.get(k);
            if (ex) {
              // igual que el bundle: si el par ya tiene arista y además hay
              // costura, se marca (classes += " sewing"), no se descarta
              if (kind === "sewing") ex.sewn = true;
              return;
            }
            var e = { source: A, target: B, kind: kind, sewn: kind === "sewing" };
            seen.set(k, e);
            edges.push(e);
          }
          var RL = app.metadataCache.resolvedLinks || {};
          files.forEach(function (src) {
            var tgts = RL[src.path];
            if (!tgts) return;
            for (var dst in tgts) if (pathSet.has(dst)) pushEdge(src.path, dst, "wikilink");
          });
          files.forEach(function (sf) {
            sewingTargets(app, sf).forEach(function (tp) { pushEdge(sf.path, tp, "sewing"); });
          });
          var orphans = nodes
            .filter(function (n) {
              return !edges.some(function (e) { return e.source === n.path || e.target === n.path; });
            })
            .map(function (n) { return n.path; });
          return { tag: wanted, noteCount: nodes.length, nodes: nodes, edges: edges, orphans: orphans };
        }
      },

      blg_sew: {
        description: "Cose (relaciona padre→hijos) notas usando el mismo formato del plugin: agrega '[[Hijo]]' a la propiedad frontmatter 'sewing' del padre y el tag 'slug-padre/sewing/slug-hijo' al hijo. Acepta rutas, basenames o wikilinks.",
        inputSchema: { type: "object", required: ["parent", "children"], properties: {
          parent: { type: "string", description: "Nota padre (ruta o nombre)" },
          children: { type: "array", items: { type: "string" }, description: "Notas hijas (rutas o nombres)" }
        } },
        handler: async function (args) {
          var parent = resolveFile(app, args.parent);
          if (!parent) throw { code: -32602, message: "Padre no encontrado: " + args.parent };
          var kids = [], missing = [];
          (args.children || []).forEach(function (c) {
            var f = resolveFile(app, c);
            if (f && f.path !== parent.path) kids.push(f); else missing.push(String(c));
          });
          if (!kids.length) throw { code: -32602, message: "Ningún hijo válido. No encontrados: " + missing.join(", ") };
          await app.fileManager.processFrontMatter(parent, function (fm) {
            var o = Array.isArray(fm.sewing) ? fm.sewing.slice() : fm.sewing ? [fm.sewing] : [];
            var u = new Set(o.map(String));
            kids.forEach(function (k) { u.add("[[" + k.basename + "]]"); });
            fm.sewing = Array.from(u);
          });
          var pslug = blgSlug(parent.basename);
          for (var i = 0; i < kids.length; i++) {
            var k = kids[i];
            var tag = pslug + "/sewing/" + blgSlug(k.basename);
            await app.fileManager.processFrontMatter(k, function (fm) {
              var o = Array.isArray(fm.tags) ? fm.tags.slice() : fm.tags ? [fm.tags] : [];
              if (o.indexOf(tag) === -1) o.push(tag);
              fm.tags = o;
            });
          }
          var v = plugin.getView && plugin.getView();
          if (v && v.renderMode) { try { v._noRf = false; v._lastSig = null; v.renderMode(); } catch (_) {} }
          return {
            ok: true, parent: parent.path,
            sewn: kids.map(function (k) { return k.path; }),
            notFound: missing
          };
        }
      },

      blg_open_tag_view: {
        description: "Abre la vista de tag en la interfaz de Obsidian del usuario, mostrando el grafo visual del tag indicado. Úsalo cuando el usuario pida VER algo en pantalla.",
        inputSchema: { type: "object", required: ["tag"], properties: {
          tag: { type: "string", description: "Tag sin #, p. ej. 'herreria'" }
        } },
        handler: async function (args) {
          var tag = String(args.tag || "").replace(/^#/, "").trim();
          if (!tag) throw { code: -32602, message: "Falta 'tag'" };
          if (plugin.session) throw { code: -32603, message: "Hay una sesión de costura activa; ciérrala primero" };
          plugin.tagView = { tag: tag };
          await plugin.activateView();
          var v = plugin.getView && plugin.getView();
          if (v && v.renderMode) v.renderMode();
          return { ok: true, tag: tag };
        }
      },

      blg_exit_tag_view: {
        description: "Cierra la vista de tag y vuelve a la vista local del plugin.",
        inputSchema: { type: "object", properties: {} },
        handler: function () {
          if (plugin.salirVistaTag) plugin.salirVistaTag();
          else { plugin.tagView = null; var v = plugin.getView && plugin.getView(); if (v && v.renderMode) v.renderMode(); }
          return { ok: true };
        }
      },

      blg_get_note: {
        description: "Devuelve metadatos de una nota: frontmatter, tags, wikilinks salientes, backlinks, costuras y opcionalmente el contenido markdown.",
        inputSchema: { type: "object", required: ["note"], properties: {
          note: { type: "string", description: "Ruta o nombre de la nota" },
          includeContent: { type: "boolean", description: "Si true, incluye el markdown completo" }
        } },
        handler: async function (args) {
          var f = resolveFile(app, args.note);
          if (!f) throw { code: -32602, message: "Nota no encontrada: " + args.note };
          var c = app.metadataCache.getFileCache(f) || {};
          var RL = app.metadataCache.resolvedLinks || {};
          var out = Object.keys(RL[f.path] || {});
          var back = [];
          for (var src in RL) if (RL[src] && RL[src][f.path]) back.push(src);
          var res = {
            path: f.path, basename: f.basename,
            ctime: f.stat && f.stat.ctime, mtime: f.stat && f.stat.mtime,
            frontmatter: c.frontmatter || {},
            tags: fileTags(app, f),
            linksOut: out, backlinks: back,
            sewing: Array.from(sewingTargets(app, f))
          };
          if (args.includeContent) res.content = await app.vault.cachedRead(f);
          return res;
        }
      },

      blg_search_notes: {
        description: "Busca notas por coincidencia parcial en el nombre de archivo. Útil para resolver referencias ambiguas antes de coser.",
        inputSchema: { type: "object", required: ["query"], properties: {
          query: { type: "string" },
          limit: { type: "number", description: "Máximo de resultados (default 20)" }
        } },
        handler: function (args) {
          var q = String(args.query || "").toLowerCase();
          var lim = Math.max(1, Math.min(100, args.limit || 20));
          var hits = app.vault.getMarkdownFiles()
            .filter(function (f) { return f.basename.toLowerCase().indexOf(q) !== -1; })
            .slice(0, lim)
            .map(function (f) { return { path: f.path, basename: f.basename }; });
          return { count: hits.length, results: hits };
        }
      }
    };
  }

  /* ---------- servidor HTTP + JSON-RPC (MCP Streamable HTTP) ---------- */

  function BlgMcpServer(plugin) {
    var st = plugin.settings || {};
    this.plugin = plugin;
    this.port = Number(st.mcpPort) || DEFAULT_PORT;
    this.token = typeof st.mcpToken === "string" ? st.mcpToken : "";
    this.tools = buildTools(plugin);
    if (!this.token) {
      this.token = crypto ? crypto.randomBytes(24).toString("hex") : String(Math.random()).slice(2) + Date.now();
      try {
        plugin.settings.mcpToken = this.token;
        plugin.saveSettings && plugin.saveSettings();
        console.log("[BLG MCP] token generado y guardado en data.json (mcpToken)");
      } catch (_) {
        console.log("[BLG MCP] token de sesión (no persistido): " + this.token);
      }
    }
    var self = this;
    this.srv = http.createServer(function (req, res) { self._handle(req, res); });
    this.srv.on("error", function (e) {
      console.warn("[BLG MCP] error del servidor (¿puerto " + self.port + " ocupado?):", e && e.message);
    });
    this.srv.listen(this.port, "127.0.0.1", function () {
      console.log("[BLG MCP] escuchando en http://127.0.0.1:" + self.port + "/mcp");
    });
  }

  BlgMcpServer.prototype.stop = function () {
    try { this.srv && this.srv.close(); } catch (_) {}
    this.srv = null;
  };

  BlgMcpServer.prototype._handle = function (req, res) {
    var self = this;
    function send(status, obj) {
      var body = obj === undefined ? "" : JSON.stringify(obj);
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      });
      res.end(body);
    }
    var url = (req.url || "").split("?")[0];
    if (url !== "/mcp" && url !== "/") return send(404, { error: "not found" });

    // auth
    var auth = req.headers["authorization"] || "";
    if (auth !== "Bearer " + this.token) return send(401, { error: "unauthorized" });

    if (req.method === "GET") return send(405, { error: "SSE stream no soportado; usar POST" });
    if (req.method !== "POST") return send(405, { error: "method not allowed" });

    var chunks = [], size = 0;
    req.on("data", function (c) {
      size += c.length;
      if (size > 4 * 1024 * 1024) { req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", function () {
      var msg;
      try { msg = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch (e) { return send(400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }

      var batch = Array.isArray(msg) ? msg : [msg];
      Promise.all(batch.map(function (m) { return self._dispatch(m); }))
        .then(function (results) {
          var replies = results.filter(function (r) { return r !== undefined; });
          if (!replies.length) return send(202); // solo notificaciones
          send(200, Array.isArray(msg) ? replies : replies[0]);
        })
        .catch(function (e) {
          send(500, { jsonrpc: "2.0", id: null, error: { code: -32603, message: String(e && e.message || e) } });
        });
    });
  };

  BlgMcpServer.prototype._dispatch = async function (m) {
    if (!m || m.jsonrpc !== "2.0" || typeof m.method !== "string") {
      return { jsonrpc: "2.0", id: (m && m.id) || null, error: { code: -32600, message: "Invalid request" } };
    }
    var isNotification = (m.id === undefined || m.id === null) && m.method.indexOf("notifications/") === 0;
    if (isNotification) return undefined; // notifications/initialized, etc.

    var self = this;
    function ok(result) { return { jsonrpc: "2.0", id: m.id, result: result }; }
    function err(code, message) { return { jsonrpc: "2.0", id: m.id, error: { code: code, message: message } }; }

    try {
      switch (m.method) {
        case "initialize":
          return ok({
            protocolVersion: (m.params && m.params.protocolVersion) || "2025-06-18",
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: SRV_NAME, version: SRV_VERSION }
          });

        case "ping":
          return ok({});

        case "tools/list":
          return ok({
            tools: Object.keys(self.tools).map(function (name) {
              var t = self.tools[name];
              return { name: name, description: t.description, inputSchema: t.inputSchema };
            })
          });

        case "tools/call": {
          var p = m.params || {};
          var tool = self.tools[p.name];
          if (!tool) return err(-32602, "Herramienta desconocida: " + p.name);
          try {
            var result = await tool.handler(p.arguments || {});
            return ok({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: false });
          } catch (te) {
            if (te && te.code) return err(te.code, te.message);
            return ok({ content: [{ type: "text", text: "Error: " + String(te && te.message || te) }], isError: true });
          }
        }

        default:
          return err(-32601, "Método no soportado: " + m.method);
      }
    } catch (e) {
      return err(-32603, String(e && e.message || e));
    }
  };

  /* ---------- inyección: envolver onload / onunload ---------- */

  var _onload = PLUGIN_PROTO.onload;
  var _onunload = PLUGIN_PROTO.onunload;

  PLUGIN_PROTO.onload = async function () {
    await _onload.call(this);
    try {
      var st = this.settings || {};
      if (st.mcpEnabled === false) return; // opt-out explícito
      this._blgMcp = new BlgMcpServer(this);
    } catch (e) {
      try { console.warn("[BLG MCP] no se pudo iniciar:", e && e.message); } catch (_) {}
    }
  };

  PLUGIN_PROTO.onunload = function () {
    try { this._blgMcp && this._blgMcp.stop(); this._blgMcp = null; } catch (_) {}
    return _onunload.call(this);
  };
})();
