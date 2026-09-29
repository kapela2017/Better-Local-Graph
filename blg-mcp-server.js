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
        description: "Devuelve el grafo de la vista tag: todas las notas que tienen el tag (o subtag) indicado, con metadatos de edad, más las aristas entre ellas (wikilinks resueltos y costuras/sewing). Es la misma lógica que la vista visual del plugin. Si el usuario está viendo una Tag View y quieres traer ESE grafo, usa current:true (sin parámetro tag) para leer el tag activo automáticamente. Si pasas tag explícitamente, se usa ese.",
        inputSchema: { type: "object", properties: {
          tag: { type: "string", description: "Tag sin #, p. ej. 'herreria' o 'dev/obsidian'. Omitir si se usa current:true." },
          current: { type: "boolean", description: "Si true, usa el tag de la Tag View actualmente abierta en pantalla. Requiere que el usuario esté en vista de tag." }
        } },
        handler: function (args) {
          var wanted;
          if (args && args.current === true) {
            var tv = plugin.tagView;
            if (!tv || !tv.tag) throw { code: -32603, message: "No hay una Tag View activa. Pide al usuario que abra una o usa el parámetro 'tag'." };
            wanted = String(tv.tag).replace(/^#/, "").trim();
          } else {
            wanted = String((args && args.tag) || "").replace(/^#/, "").trim();
          }
          if (!wanted) throw { code: -32602, message: "Falta el parámetro 'tag' o 'current:true'" };
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
      },
      /* ===== NUEVA HERRAMIENTA: estado de la vista actual del plugin ===== */
      blg_get_current_view: {
        description: "Detecta qué está viendo el usuario en el plugin Better Local Graph AHORA MISMO: vista local (nota central), vista de tag (Tag View con un tag concreto y selección), pizarra de notas fijadas (pin board) o sesión de costura (sewing). Úsalo PRIMERO cuando el usuario diga 'la vista actual', 'lo que estoy viendo', 'trae lo que tengo en pantalla', 'esta vista' o pida trabajar con lo que ve sin nombrar un archivo. No modifica nada; solo lee el estado. Después, según el modo devuelto, usa la herramienta adecuada: mode='local' → blg_get_active_note_relations; mode='tag' → blg_get_tag_graph con current:true o con el tag devuelto; mode='pinboard' → blg_pin_board con action:'get'; mode='sewing' → usa los datos de sewing de la respuesta.",
        inputSchema: { type: "object", properties: {} },
        handler: function () {
          var view = plugin.getView && plugin.getView();
          var result = { mode: "unknown" };

          // --- helper: bookmark info ---
          var bm = plugin.bookmark || null;
          var bmInfo = null;
          if (bm) {
            var bmFile = app.vault.getAbstractFileByPath(bm.path);
            bmInfo = {
              path: bm.path,
              basename: bm.name || (bmFile ? bmFile.basename : bm.path.replace(/\.md$/, "").split("/").pop())
            };
          }
          function activeIsBookmarkFn(activePath) {
            if (!bmInfo || !activePath) return false;
            return activePath === bmInfo.path;
          }

          // --- pizarra de notas fijadas (cubre la vista local/tag) ---
          var pinH = plugin._blgPin && plugin._blgPin.attached;
          if (pinH && typeof pinH.active === "function" && pinH.active()) {
            result.mode = "pinboard";
            var pbCards = (plugin.settings && plugin.settings.pinBoard && plugin.settings.pinBoard.cards) || {};
            result.pinnedCount = Object.keys(pbCards).length;
            var pbSel = (typeof pinH.selected === "function") ? pinH.selected() : [];
            result.selectedNotes = pbSel.map(function (p) {
              var pf = app.vault.getAbstractFileByPath(p);
              return { path: p, basename: pf ? pf.basename : p.replace(/\.md$/, "").split("/").pop() };
            });
            result.selectionCount = result.selectedNotes.length;
            result.bookmark = bmInfo;
            result.message = "El usuario está viendo la pizarra de notas fijadas (pin board). Usa la herramienta blg_pin_board con action:'get' para leer su estado completo o con open/close/pin/unpin/focus/fit para manipularla.";
            return result;
          }

          // --- sesión de costura ---
          if (plugin.session) {
            var s = plugin.session;
            result.mode = "sewing";
            result.sewing = {
              parentPath: s.parentPath || null,
              parentName: s.parentName || null,
              children: (s.children || []).map(function (c) {
                return { path: c.path, basename: c.name };
              })
            };
            result.bookmark = bmInfo;
            result.activeIsBookmark = activeIsBookmarkFn(s.parentPath);
            return result;
          }

          // --- Tag View ---
          if (plugin.tagView && plugin.tagView.tag) {
            result.mode = "tag";
            result.tag = plugin.tagView.tag;
            var sel = (view && view._sel) ? view._sel : [];
            result.selectedNotes = (sel || []).map(function (p) {
              var f = app.vault.getAbstractFileByPath(p);
              return { path: p, basename: f ? f.basename : p.replace(/\.md$/, "").split("/").pop() };
            });
            result.selectionCount = result.selectedNotes.length;
            result.bookmark = bmInfo;
            var mv = app.workspace.getActiveViewOfType && app.workspace.getActiveViewOfType(require("obsidian").MarkdownView);
            var actF = (mv && mv.file) ? mv.file.path : (app.workspace.getActiveFile ? app.workspace.getActiveFile() : null);
            result.activeIsBookmark = activeIsBookmarkFn(actF ? actF.path || actF : null);
            return result;
          }

          // --- vista local ---
          if (view && view.currentPath) {
            result.mode = "local";
            var f = app.vault.getAbstractFileByPath(view.currentPath);
            result.localNote = {
              path: view.currentPath,
              basename: f ? f.basename : view.currentPath.replace(/\.md$/, "").split("/").pop()
            };
            result.bookmark = bmInfo;
            result.activeIsBookmark = activeIsBookmarkFn(view.currentPath);
            return result;
          }

          // --- no se detectó nada ---
          result.bookmark = bmInfo;
          result.message = "No se detectó ninguna vista activa del plugin. Abre una nota o una Tag View.";
          return result;
        }
      },

      /* ===== nota activa (vista estándar/local) + relaciones salientes ===== */
      blg_get_active_note_relations: {
        description: "Detecta la nota ACTIVA en la vista estándar (local) de Obsidian — la misma que muestra el grafo local del plugin — y devuelve sus relaciones SALIENTES: wikilinks resueltos y costuras (sewing). IMPORTANTE: esta herramienta solo aplica cuando el usuario está en la VISTA LOCAL (no en Tag View ni en sesión de costura). Si el usuario dice 'la vista actual' o 'lo que estoy viendo', llama PRIMERO a blg_get_current_view para saber el modo. Las costuras se priorizan y se marcan con kind='sewing'. Si una relación es a la vez wikilink y costura, se marca sewn=true.",
        inputSchema: { type: "object", properties: {
          includeBacklinks: { type: "boolean", description: "Si true, incluye también las relaciones ENTRANTES (backlinks y costuras que apuntan a esta nota). Default false." },
          includeContent:   { type: "boolean", description: "Si true, incluye el markdown completo de la nota activa. Default false." },
          sewingOnly:       { type: "boolean", description: "Si true, devuelve únicamente las relaciones de tipo sewing (ignora wikilinks puros). Default false." }
        } },
        handler: async function (args) {
          args = args || {};
          var Oe = require("obsidian");

          // --- 1) resolver la nota activa igual que la vista local del plugin ---
          // preferimos el MarkdownView activo (la nota que el usuario está editando/viendo);
          // si no hay, caemos a getActiveFile() — idéntico patrón al de renderMode() del bundle.
          var active = null;
          var mv = app.workspace.getActiveViewOfType(Oe.MarkdownView);
          if (mv && mv.file) active = mv.file;
          if (!active) active = app.workspace.getActiveFile();

          if (!(active instanceof Oe.TFile) || active.extension !== "md") {
            throw { code: -32603, message: "No hay ninguna nota markdown activa en la vista estándar." };
          }

          var sewingOnly = !!args.sewingOnly;

          // --- 2) relaciones SALIENTES ---
          var sewOut = sewingTargets(app, active);           // Set<path> de costuras salientes
          var RL = app.metadataCache.resolvedLinks || {};
          var linkOut = RL[active.path] || {};

          var outMap = new Map(); // path -> edge
          function put(path, kind) {
            if (!path || path === active.path) return;
            var ex = outMap.get(path);
            if (ex) { if (kind === "sewing") ex.sewn = true; return; }
            var tf = app.vault.getAbstractFileByPath(path);
            outMap.set(path, {
              path: path,
              basename: tf ? tf.basename : path.replace(/\.md$/, "").split("/").pop(),
              kind: kind,
              sewn: kind === "sewing"
            });
          }
          // costuras primero (prioridad), luego wikilinks
          sewOut.forEach(function (p) { put(p, "sewing"); });
          if (!sewingOnly) {
            for (var dst in linkOut) if (linkOut.hasOwnProperty(dst)) put(dst, "wikilink");
          } else {
            // en modo sewingOnly, marcamos sewn en los que además son wikilink
            for (var d2 in linkOut) if (outMap.has(d2)) outMap.get(d2).sewn = true;
          }
          var outgoing = Array.from(outMap.values());

          var result = {
            active: {
              path: active.path,
              basename: active.basename,
              ctime: active.stat && active.stat.ctime,
              mtime: active.stat && active.stat.mtime,
              tags: fileTags(app, active)
            },
            outgoing: outgoing,
            sewingOutCount: outgoing.filter(function (e) { return e.kind === "sewing"; }).length,
            outgoingCount: outgoing.length
          };

          // --- 3) relaciones ENTRANTES (opcional) ---
          if (args.includeBacklinks) {
            var inMap = new Map();
            function putIn(srcPath, kind) {
              if (!srcPath || srcPath === active.path) return;
              var ex = inMap.get(srcPath);
              if (ex) { if (kind === "sewing") ex.sewn = true; return; }
              var sf = app.vault.getAbstractFileByPath(srcPath);
              inMap.set(srcPath, {
                path: srcPath,
                basename: sf ? sf.basename : srcPath.replace(/\.md$/, "").split("/").pop(),
                kind: kind,
                sewn: kind === "sewing"
              });
            }
            // costuras entrantes: notas cuyo sewing apunta a la activa
            var all = app.vault.getMarkdownFiles();
            for (var i = 0; i < all.length; i++) {
              var f = all[i];
              if (f.path === active.path) continue;
              if (sewingTargets(app, f).has(active.path)) putIn(f.path, "sewing");
            }
            // backlinks por wikilink
            if (!sewingOnly) {
              for (var src in RL) {
                if (RL[src] && RL[src][active.path]) putIn(src, "wikilink");
              }
            } else {
              for (var src2 in RL) {
                if (RL[src2] && RL[src2][active.path] && inMap.has(src2)) inMap.get(src2).sewn = true;
              }
            }
            var incoming = Array.from(inMap.values());
            result.incoming = incoming;
            result.sewingInCount = incoming.filter(function (e) { return e.kind === "sewing"; }).length;
            result.incomingCount = incoming.length;
          }

          if (args.includeContent) result.content = await app.vault.cachedRead(active);
          return result;
        }
      },

      /* ===== pizarra de notas fijadas (pin board) ===== */
      blg_pin_board: {
        description: "Gestiona la pizarra de notas fijadas (pin board) de Better Local Graph: el tablero visual donde el usuario fija notas como tarjetas conectadas por costuras. Acciones: 'get' = estado completo (¿activa?, tarjetas con posición/carpeta/disponibilidad, selección, cámara y aristas de costura entre tarjetas) — funciona con la pizarra cerrada; 'open' = abre el panel BLG si hace falta y ACTIVA la pizarra en pantalla; 'close' = sale de la pizarra conservando pines y distribución; 'pin' = fija notas nuevas (no duplica ni mueve las existentes); 'unpin' = quita notas de la pizarra (NO borra las notas ni sus costuras; sirve también para tarjetas cuya nota ya no existe); 'focus' = activa la pizarra si hace falta y centra la cámara en la tarjeta; 'fit' = encuadra todas las tarjetas. Úsala cuando el usuario diga 'mi pizarra', 'lo que tengo pineado/fijado', 'fija esta nota', 'quítala de la pizarra' o pida verla en pantalla. Si una referencia es ambigua (varias notas con el mismo nombre) se devuelven los candidatos sin elegir ninguno: pide al usuario que precise la ruta. Las costuras entre tarjetas se crean con blg_sew, no aquí.",
        inputSchema: { type: "object", required: ["action"], properties: {
          action: { type: "string", enum: ["get", "open", "close", "pin", "unpin", "focus", "fit"], description: "Operación a ejecutar." },
          notes: { type: "array", items: { type: "string" }, description: "Requerido para pin/unpin/focus: rutas, basenames o wikilinks (focus usa solo el primero)." }
        } },
        handler: async function (args) {
          args = args || {};
          var api = (typeof globalThis !== "undefined") && globalThis.__BLG_PINBOARD;
          if (!api || typeof api.boardState !== "function") throw { code: -32603, message: "El módulo de la pizarra no está disponible en esta sesión de Obsidian." };
          var action = String(args.action || "").toLowerCase().trim();
          var refs = Array.isArray(args.notes) ? args.notes.filter(function (s) { return s != null && String(s).trim(); }) : [];
          /* Resolución estricta: ruta exacta (con o sin .md), basename ÚNICO y,
             como último recurso, el resolvedor de Obsidian. Un basename con
             varias notas NO se elige: se reporta ambiguo con candidatos. */
          function resolveStrict(ref) {
            var Oe2 = require("obsidian");
            var r = String(ref || "").trim().replace(/^\[\[|\]\]$/g, "");
            if (!r) return { file: null };
            var f = app.vault.getAbstractFileByPath(r);
            if (f instanceof Oe2.TFile) return { file: f };
            f = app.vault.getAbstractFileByPath(r + ".md");
            if (f instanceof Oe2.TFile) return { file: f };
            var low = r.toLowerCase(), matches = [];
            var all = app.vault.getMarkdownFiles();
            for (var i = 0; i < all.length; i++) if (all[i].basename.toLowerCase() === low) matches.push(all[i].path);
            if (matches.length === 1) return { file: app.vault.getAbstractFileByPath(matches[0]) };
            if (matches.length > 1) return { file: null, ambiguous: matches };
            f = app.metadataCache.getFirstLinkpathDest(r, "");
            if (f) return { file: f };
            return { file: null };
          }
          /* Para unpin/focus la nota puede ya no existir: también se resuelve
             contra las rutas pineadas (exacta o basename único). */
          function resolvePinned(ref) {
            var got = resolveStrict(ref);
            if (got.file) return { path: got.file.path };
            var r = String(ref || "").trim().replace(/^\[\[|\]\]$/g, "");
            var pinned = api.boardState(plugin).cards.map(function (c) { return c.path; });
            if (pinned.indexOf(r) >= 0) return { path: r };
            if (pinned.indexOf(r + ".md") >= 0) return { path: r + ".md" };
            var low = r.toLowerCase();
            var matches = pinned.filter(function (p) { return p.replace(/\.md$/i, "").split("/").pop().toLowerCase() === low; });
            if (matches.length === 1) return { path: matches[0] };
            if (matches.length > 1) return { path: null, ambiguous: matches };
            if (got.ambiguous) return { path: null, ambiguous: got.ambiguous };
            return { path: null };
          }
          async function ensureOpen() {
            var opened = await api.openBoard(plugin);
            if (!opened) throw { code: -32603, message: "No se pudo activar la pizarra: el panel Better Local Graph no está disponible." };
          }
          switch (action) {
            case "get":
              return api.boardState(plugin);
            case "open": {
              await ensureOpen();
              return { ok: true, active: true, pinnedCount: api.boardState(plugin).pinnedCount };
            }
            case "close":
              api.closeBoard(plugin);
              return { ok: true, active: false };
            case "fit": {
              await ensureOpen();
              if (!api.fitBoard(plugin)) throw { code: -32603, message: "No se pudo encuadrar la pizarra." };
              return { ok: true };
            }
            case "focus": {
              if (!refs.length) throw { code: -32602, message: "focus requiere 'notes' con la nota a enfocar" };
              var fp = resolvePinned(refs[0]);
              if (fp.ambiguous) return { ok: false, error: "ambiguous", ref: String(refs[0]), candidates: fp.ambiguous };
              if (!fp.path) throw { code: -32602, message: "No hay ninguna tarjeta pineada para: " + refs[0] };
              await ensureOpen();
              if (!api.focusCard(plugin, fp.path)) throw { code: -32603, message: "No se pudo enfocar la tarjeta: " + fp.path };
              return { ok: true, focused: fp.path };
            }
            case "pin": {
              if (!refs.length) throw { code: -32602, message: "pin requiere 'notes' (array de rutas o nombres)" };
              var pinned = [], already = [], notFound = [], ambiguous = [];
              refs.forEach(function (r) {
                var got = resolveStrict(r);
                if (got.ambiguous) { ambiguous.push({ ref: String(r), candidates: got.ambiguous }); return; }
                if (!got.file) { notFound.push(String(r)); return; }
                if (api.isPinned(plugin, got.file.path)) { already.push(got.file.path); return; }
                api.pin(plugin, got.file); pinned.push(got.file.path);
              });
              return { ok: !notFound.length && !ambiguous.length, pinned: pinned, alreadyPinned: already,
                notFound: notFound, ambiguous: ambiguous, pinnedCount: api.boardState(plugin).pinnedCount };
            }
            case "unpin": {
              if (!refs.length) throw { code: -32602, message: "unpin requiere 'notes' (array de rutas o nombres)" };
              var unpinned = [], notPinned = [], notFound2 = [], ambiguous2 = [];
              refs.forEach(function (r) {
                var got = resolvePinned(r);
                if (got.ambiguous) { ambiguous2.push({ ref: String(r), candidates: got.ambiguous }); return; }
                if (!got.path) { notFound2.push(String(r)); return; }
                if (!api.isPinned(plugin, got.path)) { notPinned.push(got.path); return; }
                api.unpin(plugin, got.path); unpinned.push(got.path);
              });
              return { ok: !notFound2.length && !ambiguous2.length, unpinned: unpinned, notPinned: notPinned,
                notFound: notFound2, ambiguous: ambiguous2, pinnedCount: api.boardState(plugin).pinnedCount };
            }
            default:
              throw { code: -32602, message: "action desconocida: '" + action + "'. Usa get|open|close|pin|unpin|focus|fit." };
          }
        }
      },
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
