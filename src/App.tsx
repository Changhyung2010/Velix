import { useState, useCallback, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readDir, readTextFile, DirEntry } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import "./App.css";
import { Settings, AIConfig, AI_PROVIDERS } from "./components/Settings";
import { CodeEditor } from "./components/CodeEditor";
import { ToolPanel } from "./components/ToolPanel";
import { TerminalBlock } from "./components/TerminalBlock";
import { aiService } from "./services/ai";

type Theme = "light" | "dark";

// Terminal tab interface
interface TerminalTab {
  id: string;
  title: string;
}

// Pending AI edit for accept/decline
interface PendingEdit {
  filePath: string;
  fileName: string;
  originalContent: string;
  newContent: string;
  instruction: string;
}

interface FileNode extends DirEntry {
  path: string;
  children?: FileNode[];
  isOpen?: boolean;
  isLoading?: boolean;
}

interface OpenTab {
  id: string;
  path: string;
  name: string;
  content: string;
  isDirty: boolean;
}

function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [aiConfig, setAiConfig] = useState<AIConfig | null>(null);
  const [shellCwd, setShellCwd] = useState<string>("~");
  const [currentDir, setCurrentDir] = useState<string>("");
  const [projectFiles, setProjectFiles] = useState<FileNode[]>([]);
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [showToolPanel, setShowToolPanel] = useState(false);
  const [pendingEdit, setPendingEdit] = useState<PendingEdit | null>(null);

  // Theme state - detect system preference
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window !== "undefined") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return "dark";
  });

  // AI conversation state for the terminal
  const [isAIProcessing, setIsAIProcessing] = useState(false);

  // Terminal tabs
  const [terminalTabs, setTerminalTabs] = useState<TerminalTab[]>([
    { id: "terminal-1", title: "Terminal 1" }
  ]);
  const [activeTerminalId, setActiveTerminalId] = useState("terminal-1");

  // Resizable panel widths (percentages)
  const [terminalWidth, setTerminalWidth] = useState(50);
  const [isResizing, setIsResizing] = useState(false);

  // Get active tab content
  const activeTab = openTabs.find(t => t.id === activeTabId);
  const activeFile = activeTab?.path || null;

  // Listen for system theme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (e: MediaQueryListEvent) => {
      setTheme(e.matches ? "dark" : "light");
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  // Add new terminal tab
  const addTerminalTab = useCallback(() => {
    const newId = `terminal-${Date.now()}`;
    const newTabNumber = terminalTabs.length + 1;
    setTerminalTabs(prev => [...prev, { id: newId, title: `Terminal ${newTabNumber}` }]);
    setActiveTerminalId(newId);
  }, [terminalTabs.length]);

  // Close terminal tab
  const closeTerminalTab = useCallback((tabId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (terminalTabs.length === 1) return; // Don't close last tab

    const tabIndex = terminalTabs.findIndex(t => t.id === tabId);
    setTerminalTabs(prev => prev.filter(t => t.id !== tabId));

    if (activeTerminalId === tabId) {
      // Switch to adjacent tab
      const newIndex = tabIndex > 0 ? tabIndex - 1 : 0;
      const remaining = terminalTabs.filter(t => t.id !== tabId);
      setActiveTerminalId(remaining[newIndex]?.id || remaining[0]?.id);
    }
  }, [terminalTabs, activeTerminalId]);

  // Initialize shell cwd and global keyboard shortcuts
  useEffect(() => {
    invoke<string>("get_shell_cwd").then(cwd => {
      setShellCwd(cwd);
    }).catch(() => {});

    // Load saved API keys and initialize aiService
    const initializeAI = async () => {
      for (const provider of AI_PROVIDERS) {
        try {
          const key = await invoke<string>("get_api_key", { provider: provider.id });
          if (key) {
            await aiService.setApiKey(provider.id, key);
            aiService.setProvider(provider.id, provider.models[0]);
            setAiConfig({
              provider: provider.id,
              model: provider.models[0],
              apiKey: key,
            });
            break;
          }
        } catch {
          // No key for this provider
        }
      }
    };
    initializeAI();

    const handleGlobalKeyDown = async (e: KeyboardEvent) => {
      // Cmd+D: New terminal tab
      if ((e.metaKey || e.ctrlKey) && e.key === "d") {
        e.preventDefault();
        addTerminalTab();
      }
      // Cmd+W: Close current terminal tab (if focused on terminal)
      if ((e.metaKey || e.ctrlKey) && e.key === "w") {
        // Only handle if we have more than one terminal tab
        if (terminalTabs.length > 1) {
          e.preventDefault();
          closeTerminalTab(activeTerminalId);
        }
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [addTerminalTab, closeTerminalTab, terminalTabs.length, activeTerminalId]);

  // Handle panel resize
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);

    const startX = e.clientX;
    const startWidth = terminalWidth;
    const containerWidth = (e.target as HTMLElement).parentElement?.parentElement?.offsetWidth || window.innerWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaPercent = (deltaX / containerWidth) * 100;
      const newWidth = Math.min(Math.max(startWidth + deltaPercent, 20), 80);
      setTerminalWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [terminalWidth]);

  // Handle AI requests from the terminal
  const handleAIRequest = useCallback(async (prompt: string) => {
    if (!aiConfig?.apiKey) {
      console.log("AI not configured");
      return;
    }

    setIsAIProcessing(true);
    try {
      // Here you would integrate with your AI service
      // For now, just log the prompt
      console.log("AI Request:", prompt);
      // const response = await aiService.chat(prompt);
    } catch (error) {
      console.error("AI request failed:", error);
    } finally {
      setIsAIProcessing(false);
    }
  }, [aiConfig]);

  // Update file tree when project changes
  useEffect(() => {
    if (currentDir) {
      loadDirectory(currentDir).then(setProjectFiles);
    }
  }, [currentDir]);

  const loadDirectory = async (path: string): Promise<FileNode[]> => {
    try {
      const entries = await readDir(path);
      return entries
        .map(e => ({ ...e, path: `${path}/${e.name}`, isOpen: false, children: undefined }))
        .sort((a, b) => {
          if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name);
          return a.isDirectory ? -1 : 1;
        });
    } catch (err) {
      console.error("Failed to read dir:", err);
      return [];
    }
  };

  const handleOpenProject = async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected && typeof selected === "string") {
        setCurrentDir(selected);
        // Also cd the shell into the project
        try {
          await invoke("set_shell_cwd", { cwd: selected });
          setShellCwd(selected);
        } catch {}
      }
    } catch (err) {
      console.error("Failed to open project:", err);
    }
  };

  const updateFileNode = (nodes: FileNode[], targetPath: string, updater: (node: FileNode) => FileNode): FileNode[] => {
    return nodes.map(node => {
      if (node.path === targetPath) return updater(node);
      if (node.children) return { ...node, children: updateFileNode(node.children, targetPath, updater) };
      return node;
    });
  };

  const handleFolderToggle = async (folder: FileNode) => {
    if (!folder.isDirectory) return;
    if (folder.isOpen) {
      setProjectFiles(prev => updateFileNode(prev, folder.path, n => ({ ...n, isOpen: false })));
    } else {
      if (!folder.children) {
        setProjectFiles(prev => updateFileNode(prev, folder.path, n => ({ ...n, isLoading: true })));
        const children = await loadDirectory(folder.path);
        setProjectFiles(prev => updateFileNode(prev, folder.path, n => ({ ...n, children, isOpen: true, isLoading: false })));
      } else {
        setProjectFiles(prev => updateFileNode(prev, folder.path, n => ({ ...n, isOpen: true })));
      }
    }
  };

  const handleFileClick = async (file: FileNode) => {
    if (file.isDirectory) { handleFolderToggle(file); return; }
    const existingTab = openTabs.find(t => t.path === file.path);
    if (existingTab) { setActiveTabId(existingTab.id); return; }
    try {
      const content = await readTextFile(file.path);
      const newTab: OpenTab = {
        id: Date.now().toString(),
        path: file.path,
        name: file.name,
        content,
        isDirty: false,
      };
      setOpenTabs(prev => [...prev, newTab]);
      setActiveTabId(newTab.id);
    } catch {
      alert("Cannot read this file (binary or permission denied)");
    }
  };

  const handleCloseTab = (tabId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const tab = openTabs.find(t => t.id === tabId);
    if (tab?.isDirty && !confirm(`${tab.name} has unsaved changes. Close anyway?`)) return;
    setOpenTabs(prev => prev.filter(t => t.id !== tabId));
    if (activeTabId === tabId) {
      const remaining = openTabs.filter(t => t.id !== tabId);
      setActiveTabId(remaining.length > 0 ? remaining[remaining.length - 1].id : null);
    }
  };

  const handleTabContentChange = (tabId: string, content: string) => {
    setOpenTabs(prev => prev.map(t => t.id === tabId ? { ...t, content, isDirty: true } : t));
  };

  const handleTabSaved = (tabId: string) => {
    setOpenTabs(prev => prev.map(t => t.id === tabId ? { ...t, isDirty: false } : t));
  };

  const handleAIConfigSave = useCallback((config: AIConfig) => {
    setAiConfig(config);
    if (config.apiKey) {
      aiService.setApiKey(config.provider, config.apiKey);
      aiService.setProvider(config.provider, config.model);
    }
  }, []);

  const handleModelChange = useCallback((model: string) => {
    if (aiConfig) {
      const newConfig = { ...aiConfig, model };
      setAiConfig(newConfig);
      aiService.setProvider(newConfig.provider, model);
    }
  }, [aiConfig]);

  // Accept pending AI edit
  const handleAcceptEdit = () => {
    if (!pendingEdit) return;
    const tab = openTabs.find(t => t.path === pendingEdit.filePath);
    if (tab) {
      handleTabContentChange(tab.id, pendingEdit.newContent);
    }
    setPendingEdit(null);
  };

  // Decline pending AI edit
  const handleDeclineEdit = () => {
    setPendingEdit(null);
  };

  // File tree renderer
  const renderFileTree = (files: FileNode[], depth: number = 0): React.ReactNode => {
    return files.map(file => (
      <div key={file.path}>
        <div
          className={`tree-item ${file.isDirectory ? "folder" : "file"} ${activeFile === file.path ? "active" : ""}`}
          style={{ paddingLeft: `${12 + depth * 16}px` }}
          onClick={() => handleFileClick(file)}
        >
          <span className={`item-icon ${file.isDirectory && file.isOpen ? "open" : ""}`}>
            {file.isDirectory ? (file.isLoading ? "..." : file.isOpen ? "v" : ">") : ""}
          </span>
          <span className="item-name">{file.name}</span>
        </div>
        {file.isDirectory && file.isOpen && file.children && (
          <div className="tree-children">{renderFileTree(file.children, depth + 1)}</div>
        )}
      </div>
    ));
  };

  // Compute simple line diff for the diff view
  const computeDiff = (original: string, modified: string) => {
    const origLines = original.split("\n");
    const modLines = modified.split("\n");
    const maxLen = Math.max(origLines.length, modLines.length);
    const result: Array<{ type: "same" | "removed" | "added" | "changed"; lineNum: number; original?: string; modified?: string }> = [];

    for (let i = 0; i < maxLen; i++) {
      const orig = origLines[i];
      const mod = modLines[i];
      if (orig === undefined && mod !== undefined) {
        result.push({ type: "added", lineNum: i + 1, modified: mod });
      } else if (mod === undefined && orig !== undefined) {
        result.push({ type: "removed", lineNum: i + 1, original: orig });
      } else if (orig === mod) {
        result.push({ type: "same", lineNum: i + 1, original: orig });
      } else {
        result.push({ type: "changed", lineNum: i + 1, original: orig, modified: mod });
      }
    }
    return result;
  };

  // Is the right panel visible (editor, tool panel, or diff view)
  const hasRightPanel = activeTab !== null || pendingEdit !== null || showToolPanel;

  return (
    <div className={`app ${theme}`}>
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <button className="project-btn" onClick={handleOpenProject}>
            <span className="folder-icon">+</span>
            {currentDir ? currentDir.split("/").pop() : "Open Project..."}
          </button>
        </div>
        <div className="file-tree">
          {!currentDir && <div className="empty-state">No project open</div>}
          {renderFileTree(projectFiles)}
        </div>
        <div className="sidebar-tools">
          <button className={`tool-btn ${showToolPanel ? "active" : ""}`} onClick={() => setShowToolPanel(!showToolPanel)}>
            <span className="tool-icon">T</span><span>Tools</span>
          </button>
          <button className="tool-btn" onClick={() => setShowSettings(true)}>
            <span className="tool-icon">S</span><span>Settings</span>
          </button>
        </div>
      </aside>

      {/* Main content area: terminal (always) + optional right panel */}
      <main className={`main-split ${isResizing ? "resizing" : ""}`}>
        {/* Terminal pane -- always visible */}
        <div
          className={`terminal-pane ${hasRightPanel ? "with-panel" : "full"}`}
          style={hasRightPanel ? { flex: `0 0 ${terminalWidth}%` } : undefined}
        >
          <div className="terminal-topbar">
            {/* Terminal tabs */}
            <div className="terminal-tabs">
              {terminalTabs.map(tab => (
                <div
                  key={tab.id}
                  className={`terminal-tab ${tab.id === activeTerminalId ? "active" : ""}`}
                  onClick={() => setActiveTerminalId(tab.id)}
                >
                  <span className="terminal-tab-title">{tab.title}</span>
                  {terminalTabs.length > 1 && (
                    <button
                      className="terminal-tab-close"
                      onClick={(e) => closeTerminalTab(tab.id, e)}
                    >
                      x
                    </button>
                  )}
                </div>
              ))}
              <button className="terminal-tab-add" onClick={addTerminalTab} title="New Terminal (Cmd+D)">
                +
              </button>
            </div>

            <div className="terminal-topbar-actions">
              {aiConfig?.provider && (
                <div className="model-selector">
                  <span className="provider-label">{aiConfig.provider}</span>
                  <select
                    value={aiConfig.model}
                    onChange={(e) => handleModelChange(e.target.value)}
                    className="model-select"
                  >
                    {AI_PROVIDERS.find(p => p.id === aiConfig.provider)?.models.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          <div className="terminal-body">
            {terminalTabs.map(tab => (
              <div
                key={tab.id}
                className="terminal-tab-content"
                style={{ display: tab.id === activeTerminalId ? "flex" : "none" }}
              >
                <TerminalBlock
                  cwd={shellCwd}
                  onCwdChange={setShellCwd}
                  theme={theme}
                  onAIRequest={handleAIRequest}
                  aiEnabled={!!aiConfig?.apiKey}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Resize handle */}
        {hasRightPanel && (
          <div
            className="resize-handle"
            onMouseDown={handleResizeStart}
          />
        )}

        {/* Right panel: editor tabs + tool panel + diff view */}
        {hasRightPanel && (
          <div className="right-panel">
            {/* Tab bar for open files */}
            {openTabs.length > 0 && (
              <div className="tab-bar">
                {openTabs.map(tab => (
                  <div
                    key={tab.id}
                    className={`tab ${tab.id === activeTabId ? "active" : ""}`}
                    onClick={() => { setActiveTabId(tab.id); setPendingEdit(null); }}
                  >
                    <span className="tab-name">
                      {tab.isDirty && <span className="tab-dirty">*</span>}
                      {tab.name}
                    </span>
                    <button className="tab-close" onClick={(e) => handleCloseTab(tab.id, e)}>x</button>
                  </div>
                ))}
                <div className="tab-actions">
                  <button
                    className={`topbar-tool-btn ${showToolPanel ? "active" : ""}`}
                    onClick={() => setShowToolPanel(!showToolPanel)}
                  >
                    Tools
                  </button>
                </div>
              </div>
            )}

            {/* Diff view for pending AI edit */}
            {pendingEdit ? (
              <div className="diff-view">
                <div className="diff-header">
                  <div className="diff-title">
                    <span>Proposed changes to </span>
                    <strong>{pendingEdit.fileName}</strong>
                  </div>
                  <div className="diff-instruction">{pendingEdit.instruction}</div>
                  <div className="diff-actions">
                    <button className="diff-btn accept" onClick={handleAcceptEdit}>Accept</button>
                    <button className="diff-btn decline" onClick={handleDeclineEdit}>Decline</button>
                  </div>
                </div>
                <div className="diff-content">
                  {computeDiff(pendingEdit.originalContent, pendingEdit.newContent).map((line, i) => {
                    if (line.type === "same") {
                      return (
                        <div key={i} className="diff-line same">
                          <span className="diff-ln">{line.lineNum}</span>
                          <span className="diff-text">{line.original}</span>
                        </div>
                      );
                    }
                    if (line.type === "removed") {
                      return (
                        <div key={i} className="diff-line removed">
                          <span className="diff-ln">{line.lineNum}</span>
                          <span className="diff-marker">-</span>
                          <span className="diff-text">{line.original}</span>
                        </div>
                      );
                    }
                    if (line.type === "added") {
                      return (
                        <div key={i} className="diff-line added">
                          <span className="diff-ln">{line.lineNum}</span>
                          <span className="diff-marker">+</span>
                          <span className="diff-text">{line.modified}</span>
                        </div>
                      );
                    }
                    // changed
                    return (
                      <div key={i}>
                        <div className="diff-line removed">
                          <span className="diff-ln">{line.lineNum}</span>
                          <span className="diff-marker">-</span>
                          <span className="diff-text">{line.original}</span>
                        </div>
                        <div className="diff-line added">
                          <span className="diff-ln">{line.lineNum}</span>
                          <span className="diff-marker">+</span>
                          <span className="diff-text">{line.modified}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : showToolPanel && !activeTab ? (
              <ToolPanel
                filePath={null}
                fileContent=""
                projectDir={currentDir}
                onClose={() => setShowToolPanel(false)}
              />
            ) : activeTab ? (
              <div className="editor-and-tools">
                <div className="editor-pane">
                  <CodeEditor
                    filePath={activeTab.path}
                    content={activeTab.content}
                    onContentChange={(content) => handleTabContentChange(activeTab.id, content)}
                    onSave={() => handleTabSaved(activeTab.id)}
                    onClose={() => handleCloseTab(activeTab.id)}
                  />
                </div>
                {showToolPanel && (
                  <div className="tool-panel-pane">
                    <ToolPanel
                      filePath={activeTab.path}
                      fileContent={activeTab.content}
                      projectDir={currentDir}
                      onClose={() => setShowToolPanel(false)}
                    />
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}
      </main>

      <Settings
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        onSave={handleAIConfigSave}
        currentConfig={aiConfig}
      />
    </div>
  );
}

export default App;
