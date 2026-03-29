# Velix

> An AI-powered desktop IDE that brings multi-provider AI, a full terminal, and a code editor into one native application.

Built with React + TypeScript on the frontend and **Tauri 2** (Rust) for the desktop shell. Designed around a minimal, distraction-free workflow — warm neutrals, deep teal accents, and everything you need in a single window.

---

## Features

**Core IDE**
- Native desktop app — macOS, Windows, Linux via Tauri
- Full PTY terminal with tabs, split views, and persistent sessions
- File explorer with tree-view sidebar
- Syntax-highlighted code editor with configurable tab sizes and theme support
- Quick file finder — `Cmd/Ctrl+P` to jump anywhere instantly
- Global search across your entire workspace
- Light and dark themes with automatic system preference detection

**AI-Powered Development**
- Multi-provider support — Claude, OpenAI, Gemini, GLM4
- Full workspace context — AI reads your project structure and files
- Inline assistance from the terminal — ask, create, edit, refactor
- Voice chat for hands-free interaction (requires OpenAI API key)

**Multi-Agent Orchestration**
- Automation panel — run multiple AI agents on complex, multi-step tasks
- Swarm Mode — coordinator-led coding with scout, builder, and reviewer roles
  - File ownership lanes to reduce overlap
  - Real-time coordination board and sync rounds
  - Review gates before work is considered done
  - Per-agent terminal views for full visibility

**Git Integration**
- Git panel — view diffs, stage changes, manage your repo
- File status indicators (modified, added, deleted)
- AI-aware git context for smarter suggestions

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Rust](https://www.rust-lang.org/tools/install) (required for the Tauri desktop app)
- An API key from at least one supported AI provider

### Install

```bash
git clone https://github.com/your-username/velix.git
cd velix
npm install
```

### Run

```bash
npm run tauri dev
```

### Build

```bash
# Frontend only (e.g. static check)
npm run build

# Tauri desktop bundle
npm run tauri build
```

### Configure

1. Open Velix and go to **Settings** in the sidebar
2. Add your API key(s) for the AI provider(s) you want
3. Select a model
4. Open a project folder — the AI will index it automatically

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl + P` | Quick file finder |
| `Cmd/Ctrl + D` | New terminal tab |
| `Cmd/Ctrl + W` | Close current terminal tab |

---

## Architecture

```
velix/
├── src/                  # React 19 + TypeScript frontend
│   ├── components/       # UI components (editor, terminal, panels, AI chat)
│   ├── services/         # AI, workspace, audio, and git services
│   ├── styles/           # Component and global styles
│   └── App.tsx           # Root application
├── src-tauri/            # Rust backend (Tauri 2)
│   └── src/              # Tauri commands, PTY, native integrations
└── public/               # Static assets
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite |
| Desktop | Tauri 2 (Rust) |
| Terminal | xterm.js + PTY via Tauri (`portable-pty` in Rust) |
| AI Engine | Custom multi-provider agent |
| Styling | CSS custom properties, JetBrains Mono, Inter |

---

## Development Setup

Recommended: [VS Code](https://code.visualstudio.com/) with these extensions:
- [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
- [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=Changhyung2010/Velix&type=Date)](https://www.star-history.com/#Changhyung2010/Velix&Date)

---

## License

See [LICENSE](LICENSE) for details.
