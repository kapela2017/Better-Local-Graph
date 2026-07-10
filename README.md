# Better Local Graph

![GitHub stars](https://img.shields.io/github/stars/pablozambrano/better-local-graph?style=social)
![GitHub release](https://img.shields.io/github/v/release/pablozambrano/better-local-graph)
![License](https://img.shields.io/github/license/pablozambrano/better-local-graph)

![Preview](assets/Preview.png)

A powerful local graph view for Obsidian that shows the neighborhood of your active note with **Lucide icons**, **link direction arrows**, and **age-based node coloring**. Includes a **Tag Overview mode** using the fcose layout to explore your entire vault filtered by tag, plus a visual **sewing session** to create parent-child relationships between notes.

## Features

**Local Graph** — See the connections of your active note at a glance. Nodes show Lucide icons, edges have direction arrows, and colors reflect how recently notes were modified (subtle pulse animation for fresh content).

**Tag Overview** — Switch to tag mode and filter the whole vault by a tag or subtag. The fcose layout arranges nodes in a clustered, readable graph. Age-based coloring and pulse make old vs new content instantly visible.

**Sewing** — A visual session to create parent-child relationships between notes. Select a parent note, pick children, and the plugin handles the bidirectional frontmatter links — `sewing` property on the parent, tag-based routing on the children.

**AI Tooltips** — Hover over any node to see an AI-generated summary of that note. Bring Your Own Key (BYOK) — works with any OpenAI-compatible provider.

**MCP Server** — Embedded Streamable HTTP server on `localhost` so external AI agents (Claude Code, OpenCode, Gemini, OpenClaw) can query your tag graph and sew notes programmatically.

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
