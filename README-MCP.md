# Better Local Graph v3.2.0 — Servidor MCP embebido

## Instalación
1. Copia `main.js`, `manifest.json` y `data.json` a `<vault>/.obsidian/plugins/better-local-graph/`
   (respaldar antes tu `data.json` actual si cambiaste settings después de compartirlo).
2. **Pega tu NUEVA API key de DeepSeek en `aiApiKey`** (la anterior quedó expuesta — revócala).
3. Recarga Obsidian o desactiva/activa el plugin.
4. Consola (Ctrl+Shift+I): debe aparecer `[BLG MCP] escuchando en http://127.0.0.1:27125/mcp`.

## Configuración (data.json)
- `mcpEnabled`: true/false
- `mcpPort`: 27125 por defecto
- `mcpToken`: Bearer token (ya generado en este data.json):
  `6c05913d2bdbb08fb541c4fd4fa31912ed1ee651483586d8`

## Registrar agentes

### Claude Code
```bash
claude mcp add --transport http blg http://127.0.0.1:27125/mcp \
  --header "Authorization: Bearer 6c05913d2bdbb08fb541c4fd4fa31912ed1ee651483586d8"
```

### OpenCode (opencode.json)
```json
"mcp": { "blg": { "type": "remote", "url": "http://127.0.0.1:27125/mcp",
  "headers": { "Authorization": "Bearer 6c05913d2bdbb08fb541c4fd4fa31912ed1ee651483586d8" } } }
```

### Gemini CLI (~/.gemini/settings.json) — usa httpUrl, no url
```json
"mcpServers": { "blg": { "httpUrl": "http://127.0.0.1:27125/mcp",
  "headers": { "Authorization": "Bearer 6c05913d2bdbb08fb541c4fd4fa31912ed1ee651483586d8" } } }
```

### OpenClaw
Opción A: mcporter (`~/.mcporter/mcporter.json`) con la misma URL/header.
Opción B: skill con curl (JSON-RPC plano):
```bash
curl -s http://127.0.0.1:27125/mcp \
  -H "Authorization: Bearer 6c05913d2bdbb08fb541c4fd4fa31912ed1ee651483586d8" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"blg_get_tag_graph","arguments":{"tag":"herreria"}}}'
```
OpenClaw en Oracle Cloud: accede via Tailscale. En ese caso edita el bloque MCP al final
de main.js y cambia `this.srv.listen(this.port, "127.0.0.1", ...)` por tu IP de tailnet
(NUNCA 0.0.0.0).

### Hermes (WSL2)
`127.0.0.1` de WSL2 no es el de Windows. Activa `networkingMode=mirrored` en `.wslconfig`
o usa la IP del host: `ip route show | grep default`.

## Herramientas expuestas
| Tool | Función |
|---|---|
| blg_list_tags | Tags del vault con conteo (filtro por prefijo opcional) |
| blg_get_tag_graph | Nodos + aristas + huérfanas de un tag/subtag. Cada arista trae `kind` ("wikilink" o "sewing") y `sewn: true` si el par además está cosido — igual que la clase `sewing` de la vista visual |
| blg_sew | Cose padre→hijos (formato idéntico al plugin) |
| blg_open_tag_view | Abre la vista tag en la UI de Obsidian |
| blg_exit_tag_view | Vuelve a la vista local |
| blg_get_note | Frontmatter, tags, links, backlinks, costuras, contenido opcional |
| blg_search_notes | Búsqueda por nombre de archivo |

## Mantenimiento
El servidor está inyectado al FINAL de main.js (bloque `Better Local Graph — Servidor MCP embebido`).
Si regeneras main.js desde tu build, reanexa el bloque: `cat blg-mcp-server.js >> main.js`.
Se incluye `blg-mcp-server.js` standalone para eso.

## Prueba rápida
```bash
curl -s http://127.0.0.1:27125/mcp \
  -H "Authorization: Bearer 6c05913d2bdbb08fb541c4fd4fa31912ed1ee651483586d8" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```
