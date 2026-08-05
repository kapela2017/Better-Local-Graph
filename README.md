# Better Local Graph

![GitHub stars](https://img.shields.io/github/stars/pablozambrano/better-local-graph?style=social)
![GitHub release](https://img.shields.io/github/v/release/pablozambrano/better-local-graph)
![License](https://img.shields.io/github/license/pablozambrano/better-local-graph)

![Preview](assets/Preview.png)

[![Demo Video](assets/0805.mp4)](assets/0805.mp4)

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

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/pablozambrano/better-local-graph/releases/latest)
2. Create a folder called `better-local-graph` in your vault's plugins folder:
   ```
   /path/to/vault/.obsidian/plugins/better-local-graph/
   ```
3. Copy the downloaded files into the folder
4. Enable the plugin in Obsidian Settings → Community plugins

### From source (development)

1. Clone into your vault's plugins folder:
   ```bash
   cd /path/to/vault/.obsidian/plugins
   git clone https://github.com/pablozambrano/better-local-graph.git
   cd better-local-graph
   ```
2. Install dependencies and build:
   ```bash
   npm install
   npm run build
   ```
3. Enable the plugin in Obsidian

## Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| AI Provider URL | OpenAI-compatible endpoint for tooltips | `https://api.openai.com/v1` |
| AI Model | Model name for tooltip generation | `gpt-4o-mini` |
| API Key | Your API key (stored locally, never sent) | — |
| Max Nodes | Maximum nodes in the local graph | `50` |
| Pulse Duration | Age pulse animation speed (ms) | `2000` |
| Sewing Tag Format | Path format for child tags | `slug-parent/sewing/slug-child` |

## Comparison with similar plugins

| Feature | Better Local Graph | Obsidian Local Graph | Graph Analysis |
|---------|-------------------|---------------------|----------------|
| Lucide icons per node | ✅ | ❌ | ❌ |
| Link direction arrows | ✅ | ❌ | ❌ |
| Age-based coloring | ✅ | ❌ | ❌ |
| Tag Overview (fcose) | ✅ | ❌ | ❌ |
| Sewing (parent-child) | ✅ | ❌ | ❌ |
| AI tooltips (BYOK) | ✅ | ❌ | ❌ |
| MCP server for agents | ✅ | ❌ | ❌ |
| Bilingual (ES/EN) | ✅ | ✅ | ❌ |

## Privacy & Data

- **AI tooltips**: Your note content is sent only if you configure an API key. No data is sent by default.
- **MCP server**: Listens on `localhost` only. Not exposed to the network.
- **No telemetry**: Better Local Graph does not collect usage data or phone home.

## Troubleshooting

### Graph not showing

If the graph view is blank, check that your vault has at least one note with internal links. The local graph requires at least one connected note to render.

### MCP server won't start

Ensure port `3100` (default) is not in use by another application. Check the plugin settings for the correct port and try restarting Obsidian.

### AI tooltips not working

| Issue | Check |
|-------|-------|
| Provider URL correct? | Must be an OpenAI-compatible endpoint (e.g. `https://api.openai.com/v1`) |
| API key set? | Entered in plugin settings |
| Model exists? | Verify the model name is valid for your provider |
| Network? | Obsidian needs internet access to reach the provider |

### Sewing doesn't create child tags

Make sure the child notes exist in your vault. The plugin looks up notes by filename — if the name has changed after linking, the sewing tag won't be created.

## Architecture

```
better-local-graph/
├── main.js                 # Plugin entry point
├── manifest.json           # Plugin metadata
├── styles.css              # Graph styling
├── data.json               # User settings
├── blg-mcp-server.js       # Embedded MCP server
├── README-MCP.md           # MCP server documentation
└── README.md               # You are here
```

## Development

```bash
# Watch mode
npm run dev

# Production build
npm run build
```

## License

Licensed under the [MIT License](LICENSE).

## Star History

<a href="https://www.star-history.com/#pablozambrano/better-local-graph&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=pablozambrano/better-local-graph&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=pablozambrano/better-local-graph&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/image?repos=pablozambrano/better-local-graph&type=Date" />
 </picture>
</a>
