# Better Local Graph v3.2.0 — Embedded MCP Server

## Installation
1. Copy `main.js`, `manifest.json` and `data.json` to `<vault>/.obsidian/plugins/better-local-graph/`
2. Reload Obsidian or disable/enable the plugin.
3. Console (Ctrl+Shift+I): should show `[BLG MCP] listening on http://127.0.0.1:27125/mcp`.

## Configuration (data.json)
- `mcpEnabled`: true/false
- `mcpPort`: 27125 by default
- `mcpToken`: Bearer token (auto-generated on first run)

## Registering agents

### Claude Code
```bash
claude mcp add --transport http blg http://127.0.0.1:27125/mcp \
  --header "Authorization: Bearer <your-token>"
```

### OpenCode (opencode.json)
```json
"mcp": { "blg": { "type": "remote", "url": "http://127.0.0.1:27125/mcp",
  "headers": { "Authorization": "Bearer <your-token>" } } }
```

### Gemini CLI (~/.gemini/settings.json) — uses httpUrl, not url
```json
"mcpServers": { "blg": { "httpUrl": "http://127.0.0.1:27125/mcp",
  "headers": { "Authorization": "Bearer <your-token>" } } }
```

### OpenClaw
Option A: mcporter (`~/.mcporter/mcporter.json`) with the same URL/header.
Option B: skill with curl (plain JSON-RPC):
```bash
curl -s http://127.0.0.1:27125/mcp \
  -H "Authorization: Bearer <your-token>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"blg_get_tag_graph","arguments":{"tag":"your-tag"}}}'
```
OpenClaw on Oracle Cloud: access via Tailscale. Edit the MCP block at the end of main.js and change `this.srv.listen(this.port, "127.0.0.1", ...)` to your tailnet IP (NEVER 0.0.0.0).

### Hermes (WSL2)
WSL2 `127.0.0.1` does not point to Windows. Enable `networkingMode=mirrored` in `.wslconfig` or use the host IP: `ip route show | grep default`.

## Exposed tools
| Tool | Function |
|---|---|
| blg_list_tags | Vault tags with count (optional prefix filter) |
| blg_get_tag_graph | Nodes + edges + orphans for a tag/subtag. Each edge has `kind` ("wikilink" or "sewing") and `sewn: true` if the pair is also sewn |
| blg_sew | Sew parent→children (identical to plugin format) |
| blg_open_tag_view | Opens tag view in Obsidian UI |
| blg_exit_tag_view | Returns to local view |
| blg_get_note | Frontmatter, tags, links, backlinks, sewing, optional content |
| blg_search_notes | File name search |

## Maintenance
The server is injected at the END of main.js (block `Better Local Graph — Servidor MCP embebido`).
If you regenerate main.js from source, re-append the block: `cat blg-mcp-server.js >> main.js`.
`blg-mcp-server.js` is included standalone for that.

## Quick test
```bash
curl -s http://127.0.0.1:27125/mcp \
  -H "Authorization: Bearer <your-token>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```
