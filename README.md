# Better Local Graph

![GitHub stars](https://img.shields.io/github/stars/pablozambrano/better-local-graph?style=social)
![GitHub release](https://img.shields.io/github/v/release/pablozambrano/better-local-graph)
![License](https://img.shields.io/github/license/pablozambrano/better-local-graph)

[![Click to watch demo — Better Local Graph in action](assets/Preview.png)](assets/0805.mp4)

**Better Local Graph** is an Obsidian plugin that transforms the local graph into a **live project context for you and your AI agents**. It goes beyond visualization: it lets you define meaningful parent-child relationships between notes through a visual **Sewing** session, bookmark nodes for quick access, and cross-reference tags from the tag panel. The embedded **MCP server** exposes your note graph to external AI agents (Claude Code, OpenCode, Gemini, etc.), giving them precise context about what you're working on — **your agent will never search your entire vault again, saving tokens and providing direct context on what you're currently viewing**.

No more generic graphs. Your agent knows your current project structure because you built it, note by note, through the `sewing` property.

## Features

**Local Graph** — See the connections of your active note at a glance. Nodes show Lucide icons, edges have direction arrows, and colors reflect how recently notes were modified (subtle pulse animation for fresh content). Right-click any node to bookmark it and access it later from any note via the **Coser A** command.

**Sewing (`sewing` property)** — The core relationship system. Create **parent-child** links between notes through a visual session or the command palette:

> **Example**: You're working on a project called "Apolo". You sew `Apolo` as parent and add `Diseño`, `Backend`, `API Docs` as children. The plugin writes `sewing: [Diseño, Backend, API Docs]` in `Apolo`'s frontmatter and assigns each child a tag like `apolo/sewing/diseno`. Now your AI agent, querying via MCP, instantly knows the scope of "Apolo" — it doesn't need to scan the whole vault.

> **Cross-tag relationships**: From the tag panel, you can select nodes from different tag branches and sew them together, creating relationships that cut across your classification system — a note tagged `ia/agentes` can be parent to one tagged `backend/api`, bridging silos.

**Bookmarks** — Right-click any node in the graph to **bookmark** it (adds it to the bookmark selection panel). Then, from any other note, run the command **"Coser A"** (Sew To) to quickly relate the active note to your bookmarked nodes — seamless, no hunting.

**Tag Overview** — Switch to tag mode and filter the whole vault by a tag or subtag. The fcose layout arranges nodes in a clustered, readable graph. Age-based coloring and pulse make old vs new content instantly visible. Select nodes and sew them across tags for cross-domain relationships.

**AI Tooltips** — Hover over any node to see an AI-generated summary of that note. Bring Your Own Key (BYOK) — works with any OpenAI-compatible provider.

**MCP Server** — Embedded Streamable HTTP server on `localhost` so external AI agents can query and manipulate your graph in real time.

> **MCP usage example**: Your coding agent needs to know the context of your current feature. It calls `sewingTargets("Apolo.md")` via MCP and immediately gets `["Diseño", "Backend", "API Docs"]` — the exact scope. It can then call `getTagGraph("apolo")` to explore the full subtree, or `sew("Diseño.md", ["Mockups.md"])` to add a new child programmatically. Your agent works *with your structure*, not against it.

**Bilingual** — Full English & Spanish interface.

## Requirements

- Obsidian v1.4.0+
- Desktop only (uses canvas/graph rendering)
- Optional: OpenAI-compatible API key for AI tooltips

## Installation

### From Obsidian Community Plugins (recommended)

1. Open Obsidian → Settings → Community plugins → Browse
2. Search for "Better Local Graph" and click Install
3. Enable the plugin

### From GitHub Release

1. Go to [Releases](https://github.com/kapela2017/Better-Local-Graph/releases)
2. Download `better-local-graph-x.x.x.zip` from the latest release
3. Extract to your vault's `.obsidian/plugins/better-local-graph/` folder
4. Enable the plugin in Obsidian settings

### From Source (development)

```bash
git clone git@github.com:kapela2017/Better-Local-Graph.git
cd Better-Local-Graph
# Ensure the build outputs (main.js, styles.css, manifest.json) are present
# No npm/build step required — this is a distribution bundle
```

## Configuration

Key settings in the plugin options tab:

| Setting | Description |
|---------|-------------|
| MCP Enabled | Enable the embedded MCP server for AI agent integration |
| MCP Port | Server port (default: 27125) |
| MCP Token | Bearer token for MCP authentication |
| AI Provider | OpenAI-compatible endpoint for AI tooltips |
| UI Language | English or Spanish |

## MCP Server

The plugin includes a built-in MCP server for AI agents.

**One click, done:** the plugin has a button in Settings called "MCP: copy agent prompt" (also available from the command palette Ctrl+P as "Copy agent MCP prompt"). Click it, it copies the full prompt with your URL, token and tools to your clipboard. Paste into ChatGPT, Claude or Gemini, and you are ready.

If you prefer direct config for your coding agent (Claude Code, OpenCode, Cursor):

```json
{
  "mcpServers": {
    "better-local-graph": {
      "url": "http://localhost:27125/mcp",
      "headers": {
        "Authorization": "Bearer <your-token>"
      }
    }
  }
}
```

Available tools: `blg_get_current_view`, `blg_get_active_note_relations`, `blg_get_tag_graph`, `blg_get_note`, `blg_search_notes`, `blg_list_tags`, `blg_sew`, `blg_open_tag_view`, `blg_exit_tag_view`.

## License

MIT
