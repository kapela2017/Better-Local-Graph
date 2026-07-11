# Better Local Graph — Conectar tu agente de IA al MCP

Better Local Graph incluye un servidor MCP embebido que permite a agentes externos (OpenCode, Claude Code, Cursor, etc.) leer y operar tu grafo local desde fuera de Obsidian.

---

## Requisitos

1. **Obsidian desktop** abierto (el MCP no funciona en móvil).
2. Plugin **Better Local Graph** instalado y activo.
3. MCP habilitado en `data.json`:

```json
{
  "mcpEnabled": true,
  "mcpPort": 27125,
  "mcpToken": "tu-token-aqui"
}
```

> Si `mcpToken` no existe, reinicia Obsidian con el plugin activo. El servidor lo generará automáticamente.

---

## Forma rápida (recomendada)

1. Abre Obsidian.
2. Abre la paleta de comandos (`Ctrl+P` / `Cmd+P`).
3. Busca **"Better Local Graph: Copiar prompt de agente MCP"**.
4. Ejecútalo. El prompt completo con tu token real se copia al portapapeles.
5. Pégalo en tu agente (chat, contexto, configuración, etc.).

---

## Forma manual

### 1. Obtener tu token

Abre el archivo:

```
Mi Boveda/.obsidian/plugins/better-local-graph/data.json
```

Copia el valor de `mcpToken`.

### 2. Datos del servidor

| Dato | Valor |
|---|---|
| URL | `http://127.0.0.1:27125/mcp` |
| Método | `POST` |
| Auth | `Authorization: Bearer <TU_TOKEN>` |
| Protocolo | MCP Streamable HTTP (JSON-RPC 2.0) |

### 3. Probar con curl

```bash
curl -X POST http://127.0.0.1:27125/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TU_TOKEN>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Deberías ver la lista de herramientas disponibles.

---

## Prompt para pasar a tu agente

Copia este texto, sustituye `<TU_TOKEN>` por tu token real, y pégalo en tu agente:

```
Tienes acceso al servidor MCP Better Local Graph de mi Obsidian.

- URL: http://127.0.0.1:27125/mcp
- Token: <TU_TOKEN>

Herramientas disponibles:
- blg_get_current_view: detecta qué vista del plugin tengo activa (local, tag, sewing) y devuelve la nota central, el bookmark si existe, y si coinciden.
- blg_get_active_note_relations: devuelve la nota activa y sus relaciones salientes (wikilinks y costuras).
- blg_get_tag_graph: devuelve el grafo completo de un tag (notas, aristas, costuras).
- blg_get_note: devuelve metadatos de una nota concreta (frontmatter, tags, links, costuras).
- blg_search_notes: busca notas por coincidencia parcial en el nombre.
- blg_list_tags: lista todos los tags del vault con su conteo.
- blg_sew: cose (relaciona) notas padre→hijas usando el formato del plugin.
- blg_open_tag_view: abre la vista de tag en Obsidian.
- blg_exit_tag_view: cierra la vista de tag y vuelve a la vista local.

Usa estas herramientas cuando te pida cosas como:
- "¿qué estoy viendo?" → blg_get_current_view
- "muéstrame el grafo del tag X" → blg_get_tag_graph
- "cose Y a Z" → blg_sew
- "busca notas sobre X" → blg_search_notes

Si blg_get_current_view no responde, probablemente Obsidian no está abierto o el token cambió. Pregunta antes de intentar otra cosa.
```

---

## Configuración por cliente

### OpenCode

En `opencode.json`:

```json
{
  "mcpServers": {
    "better-local-graph": {
      "url": "http://127.0.0.1:27125/mcp",
      "headers": {
        "Authorization": "Bearer <TU_TOKEN>"
      }
    }
  }
}
```

### Claude Code

En el archivo de configuración de Claude Code:

```json
{
  "mcpServers": {
    "better-local-graph": {
      "url": "http://127.0.0.1:27125/mcp",
      "headers": {
        "Authorization": "Bearer <TU_TOKEN>"
      }
    }
  }
}
```

### Cursor u otro editor con soporte MCP

Usa los mismos datos:

```
URL: http://127.0.0.1:27125/mcp
Headers: Authorization: Bearer <TU_TOKEN>
```

---

## Aviso WSL2

Si Obsidian corre en **Windows** y tu agente corre en **WSL2**, `127.0.0.1` dentro de WSL2 no apunta a Windows salvo que tengas `networkingMode=mirrored` en `.wslconfig`.

Solución: añade esto a `%USERPROFILE%\.wslconfig`:

```ini
[wsl2]
networkingMode=mirrored
```

Reinicia WSL con `wsl --shutdown`.

Alternativamente, usa la IP de Windows (ejecuta `ipconfig` en PowerShell) en lugar de `127.0.0.1`.

---

## Seguridad

- No compartas `data.json`. Contiene tu token en texto plano.
- No subas `mcpToken` a Git. El `.gitignore` ya excluye `data.json`.
- El servidor solo escucha en `127.0.0.1`; no está expuesto fuera de tu equipo.
- Si sospechas que el token se filtró, bórralo de `data.json` y reinicia Obsidian para generar uno nuevo.
