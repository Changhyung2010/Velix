import { useState, useCallback, useEffect, useRef } from "react";
import { open, invoke } from "./platform/native";
import "./App.css";
import { Settings, AIConfig, AI_PROVIDERS, AIProvider } from "./components/Settings";
import { TerminalBlock, TerminalRef } from "./components/TerminalBlock";
import { SearchPanel } from "./components/SearchPanel";
import { GitPanel } from "./components/GitPanel";
import { VoiceChat } from "./components/VoiceChat";
import { SwarmPanel } from "./components/swarm/SwarmPanel";
import { aiService } from "./services/ai";
import { workspaceService, WorkspaceContext } from "./services/workspace";

type Theme = "light" | "dark";

interface TerminalTab {
  id: string;
  title: string;
}

function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [aiConfig, setAiConfig] = useState<AIConfig | null>(null);
  const [shellCwd, setShellCwd] = useState<string>("~");
  const [currentDir, setCurrentDir] = useState<string>("");
  const [projectFileContents, setProjectFileContents] = useState<Record<string, string>>({});
  const [workspaceContext, setWorkspaceContext] = useState<WorkspaceContext | null>(null);
  const [showSearchPanel, setShowSearchPanel] = useState(false);
  const [showGitPanel, setShowGitPanel] = useState(false);
  const [showVoiceChat, setShowVoiceChat] = useState(false);
  const [showVoiceSetup, setShowVoiceSetup] = useState(false);
  const [swarmTabOpen, setSwarmTabOpen] = useState(false);
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const voiceSetupRef = useRef<HTMLDivElement>(null);
  const [_isAIProcessing, setIsAIProcessing] = useState(false);

  const [gitChanges, setGitChanges] = useState<Array<{ path: string; type: "M" | "A" | "D" | "?" }>>([]);
  const [currentBranch, setCurrentBranch] = useState("");

  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("velix-theme");
      if (saved === "light" || saved === "dark") return saved;
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return "dark";
  });

  const handleThemeChange = useCallback((newTheme: Theme) => {
    setTheme(newTheme);
    localStorage.setItem("velix-theme", newTheme);
  }, []);

  const terminalRefs = useRef<Map<string, TerminalRef>>(new Map());

  const [terminalTabs, setTerminalTabs] = useState<TerminalTab[]>([
    { id: "terminal-1", title: "Terminal 1" },
  ]);
  const [activeTerminalId, setActiveTerminalId] = useState("terminal-1");
  const [splitWidths, setSplitWidths] = useState<number[]>([100]);

  useEffect(() => {
    setSplitWidths(terminalTabs.map(() => 100 / terminalTabs.length));
  }, [terminalTabs.length]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (e: MediaQueryListEvent) => {
      setTheme(e.matches ? "dark" : "light");
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  const addTerminalTab = useCallback(() => {
    const newId = `terminal-${Date.now()}`;
    const newTabNumber = terminalTabs.length + 1;
    setTerminalTabs((prev) => [...prev, { id: newId, title: `Terminal ${newTabNumber}` }]);
    setActiveTerminalId(newId);
  }, [terminalTabs.length]);

  const closeSwarmTab = useCallback(() => {
    setSwarmTabOpen(false);
    setActiveTerminalId((prev) => prev === 'swarm' ? terminalTabs[0]?.id || 'terminal-1' : prev);
  }, [terminalTabs]);

  const closeTerminalTab = useCallback((tabId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (terminalTabs.length === 1) return;

    const tabIndex = terminalTabs.findIndex((tab) => tab.id === tabId);
    setTerminalTabs((prev) => prev.filter((tab) => tab.id !== tabId));

    if (activeTerminalId === tabId) {
      const remaining = terminalTabs.filter((tab) => tab.id !== tabId);
      const newIndex = tabIndex > 0 ? tabIndex - 1 : 0;
      setActiveTerminalId(remaining[newIndex]?.id || remaining[0]?.id);
    }
  }, [terminalTabs, activeTerminalId]);

  useEffect(() => {
    invoke<string>("get_shell_cwd")
      .then((cwd) => setShellCwd(cwd))
      .catch(() => {});

    const initializeAI = async () => {
      try {
        const openaiKey = await invoke<string>("get_api_key", { provider: "chatgpt" });
        if (openaiKey) {
          setOpenaiApiKey(openaiKey);
        }
      } catch {
        // No OpenAI key saved.
      }

      const providerOrder = ["claude", "chatgpt", "gemini", "glm4", "minimax", "kimi", "deepseek", "groq", "mistral"];
      const orderedProviders = providerOrder
        .map((id) => AI_PROVIDERS.find((provider) => provider.id === id))
        .filter((provider): provider is AIProvider => provider !== undefined);

      for (const provider of orderedProviders) {
        try {
          const key = await invoke<string>("get_api_key", { provider: provider.id });
          if (!key) continue;

          await aiService.setApiKey(provider.id, key);
          aiService.setProvider(provider.id, provider.models[0]);
          setAiConfig({
            provider: provider.id,
            model: provider.models[0],
            apiKey: key,
          });
          break;
        } catch (error) {
          console.error(`Error checking provider ${provider.id}:`, error);
        }
      }
    };

    initializeAI();

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "d") {
        e.preventDefault();
        addTerminalTab();
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "w" && terminalTabs.length > 1) {
        e.preventDefault();
        closeTerminalTab(activeTerminalId);
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [addTerminalTab, closeTerminalTab, terminalTabs.length, activeTerminalId]);

  const handleSplitResizeStart = useCallback((e: React.MouseEvent, index: number) => {
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startWidths = [...splitWidths];
    const containerWidth =
      (e.target as HTMLElement).closest(".terminal-body")?.clientWidth || window.innerWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaPercent = (deltaX / containerWidth) * 100;
      const newLeft = startWidths[index] + deltaPercent;
      const newRight = startWidths[index + 1] - deltaPercent;
      const minPanelWidth = 10;

      if (newLeft >= minPanelWidth && newRight >= minPanelWidth) {
        setSplitWidths((prev) => {
          const next = [...prev];
          next[index] = newLeft;
          next[index + 1] = newRight;
          return next;
        });
      }
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [splitWidths]);

  const handleAIRequest = useCallback(async (prompt: string) => {
    if (!aiConfig?.apiKey) {
      terminalRefs.current.forEach((terminal) => {
        terminal.write("\x1b[31mAI not configured. Please add an API key in Settings.\x1b[0m\r\n");
      });
      return;
    }

    setIsAIProcessing(true);
    try {
      let contextMessage = "";
      let projectContentsForAI: Record<string, string> = {};

      if (currentDir) {
        try {
          const wsContext = workspaceContext || await workspaceService.scan(currentDir);
          if (!workspaceContext) {
            setWorkspaceContext(wsContext);
          }

          contextMessage = workspaceService.buildContextPrompt(wsContext);
          projectContentsForAI = wsContext.loadedFiles;
        } catch (error) {
          console.log("WorkspaceService scan failed, falling back:", error);
          contextMessage += `Working directory: ${currentDir}\n`;

          try {
            const projectFilesMap = await invoke<Record<string, string>>("read_project_source_files", {
              directory: currentDir,
            });
            if (projectFilesMap && Object.keys(projectFilesMap).length > 0) {
              contextMessage += "\n=== PROJECT SOURCE FILES ===\n";
              for (const [filePath, content] of Object.entries(projectFilesMap)) {
                contextMessage += `\n--- ${filePath} ---\n${content.slice(0, 3000)}\n`;
              }
              projectContentsForAI = projectFilesMap;
            }
          } catch {
            // No project files available.
          }
        }
      }

      const systemPrompt = `You are an AI coding assistant in a developer terminal/IDE called Velix. You have access to the user's ENTIRE project workspace.

${contextMessage}

IMPORTANT INSTRUCTIONS:
1. You have access to ALL source files in the project — analyze them holistically.
2. When the user asks about code, reference actual file paths, functions, and variables from the loaded files.
3. When the user asks to modify or create files, you can edit MULTIPLE files in a single response.
4. Always use relative paths from the project root.
5. Keep explanations concise and focused on code.

FILE MODIFICATION COMMANDS (you can use multiple in one response):
To modify an existing file:
[FILE_WRITE_START]
path: relative/path/to/file.ext
content: |
  ... full updated file content here ...
[FILE_WRITE_END]

To create a new file:
[FILE_CREATE_START]
path: relative/path/to/newfile.ext
content: |
  ... file content here ...
[FILE_CREATE_END]

Working directory: ${currentDir || "unknown"}`;

      const messages = [
        { role: "system" as const, content: systemPrompt },
        { role: "user" as const, content: prompt },
      ];

      terminalRefs.current.forEach((terminal) => {
        terminal.write("\x1b[36mAI is thinking...\x1b[0m\r\n");
      });

      const response = await aiService.chat(messages, {
        projectContents: Object.keys(projectContentsForAI).length > 0 ? projectContentsForAI : undefined,
      });

      const responseText = response.content;
      const fileWriteRegex = /\[FILE_WRITE_START\]([\s\S]*?)\[FILE_WRITE_END\]/g;
      let writeMatch: RegExpExecArray | null;
      while ((writeMatch = fileWriteRegex.exec(responseText)) !== null) {
        const writeContent = writeMatch[1];
        const pathMatch = writeContent.match(/path:\s*(.+)/);
        const contentMatch = writeContent.match(/content:\s*\|([\s\S]*)/);

        if (pathMatch && contentMatch && currentDir) {
          const filePath = pathMatch[1].trim();
          const fileContent = contentMatch[1].trim();
          const fullPath = filePath.startsWith("/") ? filePath : `${currentDir}/${filePath}`;

          try {
            await invoke("execute_shell_command", {
              command: `cat > "${fullPath}" << 'VELIX_EOF'\n${fileContent}\nVELIX_EOF`,
              cwd: currentDir,
            });
            terminalRefs.current.forEach((terminal) => {
              terminal.write(`\x1b[32m✓ File modified: ${fullPath}\x1b[0m\r\n`);
            });
          } catch (error) {
            console.error("File write error:", error);
            terminalRefs.current.forEach((terminal) => {
              terminal.write(`\x1b[31m✗ Failed to write: ${fullPath}: ${error}\x1b[0m\r\n`);
            });
          }
        }
      }

      const fileCreateRegex = /\[FILE_CREATE_START\]([\s\S]*?)\[FILE_CREATE_END\]/g;
      let createMatch: RegExpExecArray | null;
      while ((createMatch = fileCreateRegex.exec(responseText)) !== null) {
        const createContent = createMatch[1];
        const pathMatch = createContent.match(/path:\s*(.+)/);
        const contentMatch = createContent.match(/content:\s*\|([\s\S]*)/);

        if (pathMatch && contentMatch && currentDir) {
          const filePath = pathMatch[1].trim();
          const fileContent = contentMatch[1].trim();
          const fullPath = filePath.startsWith("/") ? filePath : `${currentDir}/${filePath}`;
          const parentDir = fullPath.substring(0, fullPath.lastIndexOf("/"));

          try {
            await invoke("execute_shell_command", {
              command: `mkdir -p "${parentDir}" && cat > "${fullPath}" << 'VELIX_EOF'\n${fileContent}\nVELIX_EOF`,
              cwd: currentDir,
            });
            terminalRefs.current.forEach((terminal) => {
              terminal.write(`\x1b[32m✓ File created: ${fullPath}\x1b[0m\r\n`);
            });
          } catch (error) {
            console.error("File create error:", error);
            terminalRefs.current.forEach((terminal) => {
              terminal.write(`\x1b[31m✗ Failed to create: ${fullPath}: ${error}\x1b[0m\r\n`);
            });
          }
        }
      }

      if (currentDir && (fileWriteRegex.lastIndex > 0 || fileCreateRegex.lastIndex > 0)) {
        workspaceService.invalidateCache();
      }

      const displayText = responseText
        .replace(/\[FILE_WRITE_START\][\s\S]*?\[FILE_WRITE_END\]/g, "")
        .replace(/\[FILE_CREATE_START\][\s\S]*?\[FILE_CREATE_END\]/g, "")
        .replace(/^#+\s*/gm, "")
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/\*(.*?)\*/g, "$1")
        .replace(/`(.*?)`/g, "$1")
        .replace(/```[\s\S]*?```/g, "")
        .replace(/^\s*[-*+]\s+/gm, "• ")
        .replace(/^\s*\d+\.\s+/gm, "")
        .trim();

      terminalRefs.current.forEach((terminal) => {
        terminal.write("\r\x1b[2K\r");
        terminal.write("\x1b[32mAI:\x1b[0m ");
        terminal.write(displayText + "\r\n");
      });
    } catch (error) {
      console.error("AI request failed:", error);
      terminalRefs.current.forEach((terminal) => {
        terminal.write(`\x1b[31mAI Error: ${error instanceof Error ? error.message : "Unknown error"}\x1b[0m\r\n`);
      });
    } finally {
      setIsAIProcessing(false);
    }
  }, [aiConfig, currentDir, workspaceContext]);

  useEffect(() => {
    const loadGitChanges = async () => {
      if (!currentDir) {
        setGitChanges([]);
        setCurrentBranch("");
        return;
      }

      try {
        const status = await invoke<{ branch?: string; files: Array<{ path: string; status: string }> }>("get_git_status", {
          repoPath: currentDir,
        });

        const changes = status.files.map((file) => ({
          path: file.path,
          type: file.status.includes("M") ? "M" as const
            : file.status.includes("A") ? "A" as const
            : file.status.includes("D") ? "D" as const
            : "?" as const,
        }));

        setGitChanges(changes);
        setCurrentBranch(status.branch || "");
      } catch {
        setGitChanges([]);
        setCurrentBranch("");
      }
    };

    loadGitChanges();
    const interval = setInterval(loadGitChanges, 5000);
    return () => clearInterval(interval);
  }, [currentDir]);

  useEffect(() => {
    if (!showVoiceSetup) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (voiceSetupRef.current && !voiceSetupRef.current.contains(e.target as Node)) {
        setShowVoiceSetup(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showVoiceSetup]);

  const loadProjectFiles = useCallback(async (directory: string) => {
    if (!directory || directory === "~") return;

    try {
      const wsContext = await workspaceService.scan(directory);
      setWorkspaceContext(wsContext);
      setProjectFileContents(wsContext.loadedFiles);
    } catch (error) {
      console.error("WorkspaceService scan failed, using fallback:", error);
      setWorkspaceContext(null);

      try {
        const projectFilesMap = await invoke<Record<string, string>>("read_project_source_files", {
          directory,
        });
        setProjectFileContents(projectFilesMap || {});
      } catch (fallbackError) {
        console.error("Fallback loading also failed:", fallbackError);
        setProjectFileContents({});
      }
    }
  }, []);

  useEffect(() => {
    if (currentDir && currentDir !== "~") {
      loadProjectFiles(currentDir);
    }
  }, [currentDir, loadProjectFiles]);

  const handleOpenProject = useCallback(async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected && typeof selected === "string") {
        setCurrentDir(selected);
        try {
          await invoke("set_shell_cwd", { cwd: selected });
          setShellCwd(selected);
        } catch {}

        await loadProjectFiles(selected);
      }
    } catch (error) {
      console.error("Failed to open project:", error);
    }
  }, [loadProjectFiles]);

  const handleAIConfigSave = useCallback(async (config: AIConfig) => {
    setAiConfig(config);
    if (!config.apiKey) return;

    await aiService.setApiKey(config.provider, config.apiKey);
    aiService.setProvider(config.provider, config.model);

    if (config.provider === "chatgpt") {
      setOpenaiApiKey(config.apiKey);
    }
  }, []);

  const refreshWorkspaceAfterBranchChange = useCallback(async () => {
    if (!currentDir) return;
    workspaceService.invalidateCache();
    await loadProjectFiles(currentDir);
  }, [currentDir, loadProjectFiles]);

  const togglePanel = (panel: "search" | "git" | "voice" | "swarm" | null) => {
    setShowVoiceSetup(false);

    if (panel === null) {
      setShowSearchPanel(false);
      setShowGitPanel(false);
      setShowVoiceChat(false);
      return;
    }

    if (panel === "swarm") {
      if (!swarmTabOpen) {
        setSwarmTabOpen(true);
        setActiveTerminalId('swarm');
      } else if (activeTerminalId !== 'swarm') {
        setActiveTerminalId('swarm');
      } else {
        closeSwarmTab();
      }
      return;
    }

    setShowSearchPanel(panel === "search" ? !showSearchPanel : false);
    setShowGitPanel(panel === "git" ? !showGitPanel : false);
    setShowVoiceChat(panel === "voice" ? !showVoiceChat : false);
  };

  const canShowVoiceChat = showVoiceChat && !!openaiApiKey;
  const hasRightPanel = showSearchPanel || showGitPanel || canShowVoiceChat;
  const projectName = currentDir ? currentDir.split("/").pop() || currentDir : "No project open";
  const activeTerminalTitle = activeTerminalId === 'swarm'
    ? 'Swarm'
    : terminalTabs.find((tab) => tab.id === activeTerminalId)?.title || 'Terminal';

  return (
    <div className={`app ${theme}`}>
      {/* ── Left activity sidebar ── */}
      <div className="activity-bar">
        <div className="activity-top">
          <button
            className={`activity-btn ${!hasRightPanel ? "active" : ""}`}
            title="Terminal"
            onClick={() => togglePanel(null)}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <polyline points="7 9 10 12 7 15" />
              <line x1="13" y1="15" x2="17" y2="15" />
            </svg>
          </button>

          <div className="activity-btn-wrap" ref={voiceSetupRef}>
            <button
              className={`activity-btn ${showVoiceChat ? "active" : ""} ${!openaiApiKey ? "needs-setup" : ""}`}
              onClick={() => {
                if (!openaiApiKey) {
                  setShowVoiceSetup((visible) => !visible);
                  return;
                }
                togglePanel("voice");
              }}
              title={openaiApiKey ? "Voice Chat" : "Voice Chat — setup required"}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
              {!openaiApiKey && <span className="activity-btn-badge" />}
            </button>

            {showVoiceSetup && !openaiApiKey && (
              <div className="voice-setup-popup">
                <div className="voice-setup-header">
                  <div className="voice-setup-icon">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" y1="19" x2="12" y2="23" />
                      <line x1="8" y1="23" x2="16" y2="23" />
                    </svg>
                  </div>
                  <span className="voice-setup-title">Voice Chat</span>
                  <button className="voice-setup-close" onClick={() => setShowVoiceSetup(false)}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
                <p className="voice-setup-desc">
                  Voice Chat requires an OpenAI API key. Here&apos;s how to get started:
                </p>
                <ol className="voice-setup-steps">
                  <li>
                    <span className="voice-setup-step-num">1</span>
                    <span>Open <strong>Settings</strong> below</span>
                  </li>
                  <li>
                    <span className="voice-setup-step-num">2</span>
                    <span>Select <strong>ChatGPT</strong> as your AI provider</span>
                  </li>
                  <li>
                    <span className="voice-setup-step-num">3</span>
                    <span>Paste your <strong>OpenAI API key</strong></span>
                  </li>
                </ol>
                <button
                  className="voice-setup-action-btn"
                  onClick={() => {
                    setShowSettings(true);
                    setShowVoiceSetup(false);
                  }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                  Open Settings
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="activity-middle">
          <button
            className={`activity-btn ${showGitPanel ? "active" : ""}`}
            onClick={() => togglePanel("git")}
            title="Git"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
          </button>

          <button
            className={`activity-btn ${showSearchPanel ? "active" : ""}`}
            onClick={() => togglePanel("search")}
            title="Search"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>

          <button
            className={`activity-btn ${activeTerminalId === 'swarm' ? "active" : ""}`}
            onClick={() => togglePanel("swarm")}
            disabled={!currentDir}
            title={!currentDir ? "Swarm requires an open project." : "Swarm Mode — coordinator, scout, builders, and reviewer"}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="5" r="2.5" />
              <circle cx="5" cy="19" r="2.5" />
              <circle cx="19" cy="19" r="2.5" />
              <line x1="12" y1="7.5" x2="12" y2="12" />
              <line x1="12" y1="12" x2="5" y2="16.5" />
              <line x1="12" y1="12" x2="19" y2="16.5" />
            </svg>
          </button>
        </div>

        <div className="activity-bottom">
          <button className="activity-btn" onClick={() => setShowSettings(true)} title="Settings">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </div>

      <main className="main-split">
        <div className="terminal-pane">
          <div className="terminal-area">
            <div className="terminal-topbar">
              <div className="workspace-bar">
                <button className="workspace-open-btn" onClick={handleOpenProject} title="Open Project">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                </button>
                <div className="workspace-summary">
                  <span className="workspace-name">{projectName}</span>
                  <span className="workspace-path">
                    {currentDir || "Choose a folder to load search, git, and workspace context."}
                  </span>
                </div>
              </div>

              <div className="terminal-tabs">
                {terminalTabs.map((tab) => (
                  <div
                    key={tab.id}
                    className={`terminal-tab ${tab.id === activeTerminalId ? "active" : ""}`}
                    onClick={() => setActiveTerminalId(tab.id)}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="terminal-tab-icon">
                      <polyline points="4 17 10 11 4 5" />
                      <line x1="12" y1="19" x2="20" y2="19" />
                    </svg>
                    <span className="terminal-tab-title">{tab.title}</span>
                    {terminalTabs.length > 1 && (
                      <button className="terminal-tab-close" onClick={(e) => closeTerminalTab(tab.id, e)}>
                        ×
                      </button>
                    )}
                  </div>
                ))}
                {swarmTabOpen && (
                  <div
                    className={`terminal-tab terminal-tab-swarm${activeTerminalId === 'swarm' ? ' active' : ''}`}
                    onClick={() => setActiveTerminalId('swarm')}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="terminal-tab-icon">
                      <circle cx="12" cy="5" r="2.5" />
                      <circle cx="5" cy="19" r="2.5" />
                      <circle cx="19" cy="19" r="2.5" />
                      <line x1="12" y1="7.5" x2="12" y2="12" />
                      <line x1="12" y1="12" x2="5" y2="16.5" />
                      <line x1="12" y1="12" x2="19" y2="16.5" />
                    </svg>
                    <span className="terminal-tab-title">Swarm</span>
                    <button className="terminal-tab-close" onClick={(e) => { e.stopPropagation(); closeSwarmTab(); }}>×</button>
                  </div>
                )}
                <button className="terminal-tab-add" onClick={addTerminalTab} title="New Terminal (Cmd+D)">
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className={`terminal-body ${activeTerminalId !== 'swarm' && terminalTabs.length > 1 ? "split-view" : ""}`}>
              {activeTerminalId === 'swarm' && swarmTabOpen && (
                <SwarmPanel
                  isOpen={true}
                  onClose={closeSwarmTab}
                  theme={theme}
                  workspacePath={currentDir}
                  hasApiKey={!!aiConfig?.apiKey}
                />
              )}
              {terminalTabs.flatMap((tab, index) => {
                const isVisible = activeTerminalId !== 'swarm' && (terminalTabs.length > 1 || tab.id === activeTerminalId);
                const widthStyle = terminalTabs.length > 1 && splitWidths.length === terminalTabs.length
                  ? { flexBasis: `${splitWidths[index]}%`, flexGrow: 0, flexShrink: 0 }
                  : {};

                const terminalElement = (
                  <div
                    key={tab.id}
                    className={`terminal-tab-content ${tab.id === activeTerminalId ? "active" : ""}`}
                    style={{ display: isVisible ? "flex" : "none", ...widthStyle }}
                    onClick={() => setActiveTerminalId(tab.id)}
                  >
                    {terminalTabs.length > 1 && (
                      <div className="split-terminal-header">
                        <span>{tab.title}</span>
                        <button
                          className="split-terminal-close"
                          onClick={(e) => {
                            e.stopPropagation();
                            closeTerminalTab(tab.id, e);
                          }}
                        >
                          ×
                        </button>
                      </div>
                    )}
                    <TerminalBlock
                      ref={(element) => {
                        if (element) {
                          terminalRefs.current.set(tab.id, element);
                        } else {
                          terminalRefs.current.delete(tab.id);
                        }
                      }}
                      cwd={shellCwd}
                      onCwdChange={setShellCwd}
                      theme={theme}
                      onAIRequest={handleAIRequest}
                      aiEnabled={!!aiConfig?.apiKey}
                      gitChanges={gitChanges}
                      onOpenGitPanel={() => togglePanel("git")}
                      projectDir={currentDir}
                      projectFileContents={projectFileContents}
                      workspaceContext={workspaceContext}
                    />
                  </div>
                );

                const elements = [terminalElement];
                if (terminalTabs.length > 1 && index < terminalTabs.length - 1) {
                  elements.push(
                    <div
                      key={`split-handle-${index}`}
                      className="split-resize-handle"
                      onMouseDown={(e) => handleSplitResizeStart(e, index)}
                    />,
                  );
                }
                return elements;
              })}
            </div>
          </div>
        </div>

        <div className={`right-panel${hasRightPanel ? " open" : ""}`}>
          {showSearchPanel && <SearchPanel currentDir={currentDir} />}
          {showGitPanel && (
            <GitPanel
              currentDir={currentDir}
              onBranchChange={refreshWorkspaceAfterBranchChange}
            />
          )}
          {canShowVoiceChat && (
            <VoiceChat
              apiKey={openaiApiKey}
              onClose={() => setShowVoiceChat(false)}
            />
          )}
        </div>
      </main>

      <div className="status-bar">
        <div className="status-left">
          {currentDir ? (
            <>
              {currentBranch && (
                <>
                  <span className="status-item status-branch">
                    <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="6" y1="3" x2="6" y2="15" />
                      <circle cx="18" cy="6" r="3" />
                      <circle cx="6" cy="18" r="3" />
                      <path d="M18 9a9 9 0 0 1-9 9" />
                    </svg>
                    <span>{currentBranch}</span>
                  </span>
                  <span className="status-sep" />
                </>
              )}
              <span className="status-item">{projectName}</span>
            </>
          ) : (
            <span className="status-item status-muted">No project open</span>
          )}
        </div>

        <div className="status-right">
          <span className="status-item">{activeTerminalTitle}</span>
          <button
            className="status-item status-theme-btn"
            onClick={() => handleThemeChange(theme === "dark" ? "light" : "dark")}
            title="Toggle Theme"
          >
            {theme === "dark" ? "☀" : "◗"}
          </button>
          <span className="status-item status-brand">Velix</span>
        </div>
      </div>

      <Settings
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        onSave={handleAIConfigSave}
        currentConfig={aiConfig}
        theme={theme}
        onThemeChange={handleThemeChange}
      />
    </div>
  );
}

export default App;
