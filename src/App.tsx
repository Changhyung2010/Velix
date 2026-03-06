import { useState, useCallback, useEffect, useRef } from "react";
import {
  open,
  readDir,
  readTextFile,
  type DirEntry,
  invoke,
} from "./platform/native";
import "./App.css";
import { Settings, AIConfig, AI_PROVIDERS, AIProvider } from "./components/Settings";
import { CodeEditor } from "./components/CodeEditor";
import { ToolPanel } from "./components/ToolPanel";
import { TerminalBlock } from "./components/TerminalBlock";
import QuickFileFinder from "./components/QuickFileFinder";
import { SearchPanel } from "./components/SearchPanel";
import { GitPanel } from "./components/GitPanel";
import { VoiceChat } from "./components/VoiceChat";
import { AutomationPanel } from "./components/AutomationPanel";
import { SwarmPanel } from "./components/swarm/SwarmPanel";
import { aiService } from "./services/ai";
import { workspaceService, WorkspaceContext } from "./services/workspace";
import { TerminalRef } from "./components/TerminalBlock";

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
  const [showQuickFinder, setShowQuickFinder] = useState(false);
  const [allFiles, setAllFiles] = useState<string[]>([]);
  const [projectFileContents, setProjectFileContents] = useState<Record<string, string>>({});
  const [workspaceContext, setWorkspaceContext] = useState<WorkspaceContext | null>(null);
  const [showSearchPanel, setShowSearchPanel] = useState(false);
  const [showGitPanel, setShowGitPanel] = useState(false);
  const [showVoiceChat, setShowVoiceChat] = useState(false);
  const [showVoiceSetup, setShowVoiceSetup] = useState(false);
  const [showAutomation, setShowAutomation] = useState(false);
  const [showSwarm, setShowSwarm] = useState(false);
  const [openaiApiKey, setOpenaiApiKey] = useState<string>('');
  const voiceSetupRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_isAIProcessing, setIsAIProcessing] = useState(false);
  const [configuredProviders, setConfiguredProviders] = useState<Array<{ id: string; name: string }>>([]);

  // Git changes for terminal input bar
  const [gitChanges, setGitChanges] = useState<Array<{ path: string; type: 'M' | 'A' | 'D' | '?' }>>([]);

  // Theme state - check localStorage first, then system preference
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("velix-theme");
      if (saved === "light" || saved === "dark") return saved;
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return "dark";
  });

  // Tab size state - persisted to localStorage
  const [tabSize, setTabSize] = useState<number>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("velix-tab-size");
      const parsed = parseInt(saved || "", 10);
      if (parsed === 2 || parsed === 4 || parsed === 8) return parsed;
    }
    return 4;
  });

  // Handle theme change and persist to localStorage
  const handleThemeChange = useCallback((newTheme: Theme) => {
    setTheme(newTheme);
    localStorage.setItem("velix-theme", newTheme);
  }, []);

  // Handle tab size change and persist to localStorage
  const handleTabSizeChange = useCallback((size: number) => {
    setTabSize(size);
    localStorage.setItem("velix-tab-size", String(size));
  }, []);

  const terminalRefs = useRef<Map<string, TerminalRef>>(new Map());
  // Commands queued for new automation terminals — consumed when the TerminalBlock mounts
  const pendingAutomationCommands = useRef<Map<string, string>>(new Map());



  // Terminal tabs
  const [terminalTabs, setTerminalTabs] = useState<TerminalTab[]>([
    { id: "terminal-1", title: "Terminal 1" }
  ]);
  const [activeTerminalId, setActiveTerminalId] = useState("terminal-1");

  // Resizable panel widths (percentages)
  const [terminalWidth, setTerminalWidth] = useState(50);
  const [isResizing, setIsResizing] = useState(false);

  // Per-terminal widths (%) when multiple terminals are open in split view
  const [splitWidths, setSplitWidths] = useState<number[]>([100]);
  // Reset to equal distribution whenever the tab count changes
  useEffect(() => {
    setSplitWidths(terminalTabs.map(() => 100 / terminalTabs.length));
  }, [terminalTabs.length]);

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
    }).catch(() => { });

    // Load saved API keys and initialize aiService
    const initializeAI = async () => {
      // Try to load OpenAI key for voice features
      try {
        const openaiKey = await invoke<string>("get_api_key", { provider: "chatgpt" });
        if (openaiKey) {
          setOpenaiApiKey(openaiKey);
        }
      } catch {
        // No OpenAI key saved
      }

      // Find all configured providers
      const providerOrder = ['claude', 'chatgpt', 'gemini', 'glm4', 'minimax', 'kimi', 'deepseek', 'groq', 'mistral'];
      const orderedProviders = providerOrder.map(id => AI_PROVIDERS.find(p => p.id === id)).filter((p): p is AIProvider => p !== undefined);

      console.log('Available providers:', orderedProviders.map(p => p.id));

      const configured: Array<{ id: string; name: string }> = [];
      let firstConfigured: AIProvider | null = null;

      for (const provider of orderedProviders) {
        try {
          const key = await invoke<string>("get_api_key", { provider: provider.id });
          console.log(`Checking provider ${provider.id}:`, key ? 'Key found' : 'No key');
          if (key) {
            await aiService.setApiKey(provider.id, key);
            configured.push({ id: provider.id, name: provider.name });

            if (!firstConfigured) {
              firstConfigured = provider;
              console.log(`Initializing with provider ${provider.id}`);
              aiService.setProvider(provider.id, provider.models[0]);
              setAiConfig({
                provider: provider.id,
                model: provider.models[0],
                apiKey: key,
              });
              console.log('AI service initialized successfully');
            }
          }
        } catch (error) {
          console.error(`Error checking provider ${provider.id}:`, error);
          // No key for this provider
        }
      }

      setConfiguredProviders(configured);
    };
    initializeAI();

    const handleGlobalKeyDown = async (e: KeyboardEvent) => {
      // Cmd+P: Quick file finder
      if ((e.metaKey || e.ctrlKey) && e.key === "p") {
        e.preventDefault();
        setShowQuickFinder(true);
      }
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

  // Handle editor/terminal panel resize
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);

    const startX = e.clientX;
    const startWidth = terminalWidth;
    // The resize handle is a direct child of .terminal-pane
    const containerWidth = (e.target as HTMLElement).parentElement?.offsetWidth || window.innerWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaPercent = (deltaX / containerWidth) * 100;
      const newWidth = Math.min(Math.max(startWidth + deltaPercent, 15), 75);
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

  // Drag handler for resizing individual split-terminal panes
  const handleSplitResizeStart = useCallback((e: React.MouseEvent, index: number) => {
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startWidths = [...splitWidths];
    const containerWidth =
      (e.target as HTMLElement).closest('.terminal-body')?.clientWidth || window.innerWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaPercent = (deltaX / containerWidth) * 100;
      const newLeft = startWidths[index] + deltaPercent;
      const newRight = startWidths[index + 1] - deltaPercent;
      const minPanelWidth = 10; // minimum 10% per terminal
      if (newLeft >= minPanelWidth && newRight >= minPanelWidth) {
        setSplitWidths(prev => {
          const next = [...prev];
          next[index] = newLeft;
          next[index + 1] = newRight;
          return next;
        });
      }
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [splitWidths]);

  // Handle AI requests from the terminal with full project context
  const handleAIRequest = useCallback(async (prompt: string) => {
    if (!aiConfig?.apiKey) {
      terminalRefs.current.forEach((terminal) => {
        terminal.write('\x1b[31mAI not configured. Please add an API key in Settings.\x1b[0m\r\n');
      });
      return;
    }

    setIsAIProcessing(true);
    try {
      // Build project context using WorkspaceService
      let contextMessage = '';
      let projectContentsForAI: Record<string, string> = {};

      if (currentDir) {
        try {
          // Use workspace service for structured context
          const wsContext = workspaceContext || await workspaceService.scan(currentDir);
          if (!workspaceContext) setWorkspaceContext(wsContext);

          contextMessage = workspaceService.buildContextPrompt(
            wsContext,
            activeTab ? activeTab.path.replace(currentDir + '/', '') : undefined
          );
          projectContentsForAI = wsContext.loadedFiles;
        } catch (e) {
          console.log('WorkspaceService scan failed, falling back:', e);
          contextMessage += `Working directory: ${currentDir}\n`;
          // Fallback: try Rust backend directly
          try {
            const projectFilesMap = await invoke<Record<string, string>>('read_project_source_files', { directory: currentDir });
            if (projectFilesMap && Object.keys(projectFilesMap).length > 0) {
              contextMessage += `\n=== PROJECT SOURCE FILES ===\n`;
              for (const [filePath, content] of Object.entries(projectFilesMap)) {
                contextMessage += `\n--- ${filePath} ---\n${content.slice(0, 3000)}\n`;
              }
              projectContentsForAI = projectFilesMap;
            }
          } catch {
            if (projectFiles && projectFiles.length > 0) {
              const fileList = projectFiles.slice(0, 100).map(f => f.path).join('\n');
              contextMessage += `\nProject files (first 100):\n${fileList}\n`;
            }
          }
        }
      }

      // Add current file context if available
      if (activeTab) {
        contextMessage += `\n=== CURRENTLY OPEN FILE ===\n`;
        contextMessage += `Path: ${activeTab.path}\n`;
        contextMessage += `\`\`\`${activeTab.path.split('.').pop() || 'text'}\n${activeTab.content.slice(0, 15000)}\n\`\`\`\n`;
      }

      // Build system prompt with project context
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

Working directory: ${currentDir || 'unknown'}`;

      // Make AI request with context
      const messages = [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: prompt }
      ];

      // Write AI thinking status
      terminalRefs.current.forEach((terminal) => {
        terminal.write('\x1b[36mAI is thinking...\x1b[0m\r\n');
      });

      // Call AI service with project contents
      const response = await aiService.chat(messages, {
        projectContents: Object.keys(projectContentsForAI).length > 0 ? projectContentsForAI : undefined,
      });

      let responseText = response.content;

      // Handle ALL file write commands (global regex for multi-file support)
      const fileWriteRegex = /\[FILE_WRITE_START\]([\s\S]*?)\[FILE_WRITE_END\]/g;
      let writeMatch;
      while ((writeMatch = fileWriteRegex.exec(responseText)) !== null) {
        const writeContent = writeMatch[1];
        const pathMatch = writeContent.match(/path:\s*(.+)/);
        const contentMatch = writeContent.match(/content:\s*\|([\s\S]*)/);

        if (pathMatch && contentMatch && currentDir) {
          const filePath = pathMatch[1].trim();
          const fileContent = contentMatch[1].trim();
          const fullPath = filePath.startsWith('/') ? filePath : `${currentDir}/${filePath}`;

          try {
            await invoke('execute_shell_command', {
              command: `cat > "${fullPath}" << 'VELIX_EOF'\n${fileContent}\nVELIX_EOF`,
              cwd: currentDir
            });
            terminalRefs.current.forEach((terminal) => {
              terminal.write(`\x1b[32m✓ File modified: ${fullPath}\x1b[0m\r\n`);
            });
          } catch (err) {
            console.error('File write error:', err);
            terminalRefs.current.forEach((terminal) => {
              terminal.write(`\x1b[31m✗ Failed to write: ${fullPath}: ${err}\x1b[0m\r\n`);
            });
          }
        }
      }

      // Handle ALL file create commands (global regex for multi-file support)
      const fileCreateRegex = /\[FILE_CREATE_START\]([\s\S]*?)\[FILE_CREATE_END\]/g;
      let createMatch;
      while ((createMatch = fileCreateRegex.exec(responseText)) !== null) {
        const createContent = createMatch[1];
        const pathMatch = createContent.match(/path:\s*(.+)/);
        const contentMatch = createContent.match(/content:\s*\|([\s\S]*)/);

        if (pathMatch && contentMatch && currentDir) {
          const filePath = pathMatch[1].trim();
          const fileContent = contentMatch[1].trim();
          const fullPath = filePath.startsWith('/') ? filePath : `${currentDir}/${filePath}`;

          try {
            // Ensure parent directory exists
            const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'));
            await invoke('execute_shell_command', {
              command: `mkdir -p "${parentDir}" && cat > "${fullPath}" << 'VELIX_EOF'\n${fileContent}\nVELIX_EOF`,
              cwd: currentDir
            });
            terminalRefs.current.forEach((terminal) => {
              terminal.write(`\x1b[32m✓ File created: ${fullPath}\x1b[0m\r\n`);
            });
          } catch (err) {
            console.error('File create error:', err);
            terminalRefs.current.forEach((terminal) => {
              terminal.write(`\x1b[31m✗ Failed to create: ${fullPath}: ${err}\x1b[0m\r\n`);
            });
          }
        }
      }

      // Refresh file tree and workspace context after modifications
      if (currentDir && (fileWriteRegex.lastIndex > 0 || fileCreateRegex.lastIndex > 0)) {
        const files = await loadDirectory(currentDir);
        setProjectFiles(files);
        workspaceService.invalidateCache();
      }

      // Strip file command blocks and markdown formatting for display
      const displayText = responseText
        .replace(/\[FILE_WRITE_START\][\s\S]*?\[FILE_WRITE_END\]/g, '')
        .replace(/\[FILE_CREATE_START\][\s\S]*?\[FILE_CREATE_END\]/g, '')
        .replace(/^#+\s*/gm, '')
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        .replace(/`(.*?)`/g, '$1')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/^\s*[-*+]\s+/gm, '• ')
        .replace(/^\s*\d+\.\s+/gm, '')
        .trim();

      // Write AI response to terminal
      terminalRefs.current.forEach((terminal) => {
        terminal.write('\r\x1b[2K\r');
        terminal.write('\x1b[32mAI:\x1b[0m ');
        terminal.write(displayText + '\r\n');
      });

      console.log("AI Response:", response.content);

    } catch (error) {
      console.error("AI request failed:", error);
      terminalRefs.current.forEach((terminal) => {
        terminal.write(`\x1b[31mAI Error: ${error instanceof Error ? error.message : 'Unknown error'}\x1b[0m\r\n`);
      });
    } finally {
      setIsAIProcessing(false);
    }
  }, [aiConfig, currentDir, activeTab, projectFiles, workspaceContext]);

  // Update file tree when project changes
  useEffect(() => {
    if (currentDir) {
      loadDirectory(currentDir)
        .then(setProjectFiles)
        .catch(err => console.error("Failed to load directory:", err));
    }
  }, [currentDir]);

  // Load git status for terminal input bar
  useEffect(() => {
    const loadGitChanges = async () => {
      if (!currentDir) {
        setGitChanges([]);
        return;
      }

      try {
        const status = await invoke<{ files: Array<{ path: string; status: string }> }>('get_git_status', {
          repoPath: currentDir,
        });

        // Convert git status to simpler format
        const changes = status.files.map(file => ({
          path: file.path,
          type: file.status.includes('M') ? 'M' as const :
            file.status.includes('A') ? 'A' as const :
              file.status.includes('D') ? 'D' as const :
                '?' as const
        }));

        setGitChanges(changes);
      } catch (err) {
        // Not a git repo or git command failed
        setGitChanges([]);
      }
    };

    loadGitChanges();
    // Refresh git status every 5 seconds
    const interval = setInterval(loadGitChanges, 5000);
    return () => clearInterval(interval);
  }, [currentDir]);

  // Close voice setup popup when clicking outside
  useEffect(() => {
    if (!showVoiceSetup) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (voiceSetupRef.current && !voiceSetupRef.current.contains(e.target as Node)) {
        setShowVoiceSetup(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showVoiceSetup]);

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

  // Load all project files and their contents for AI context
  const loadProjectFiles = useCallback(async (directory: string) => {
    if (!directory || directory === '~') return;
    try {
      // Use WorkspaceService for structured scanning
      const wsContext = await workspaceService.scan(directory);
      setWorkspaceContext(wsContext);
      setProjectFileContents(wsContext.loadedFiles);

      // Also get flat file list for quick finder
      const files = await invoke<string[]>("get_all_files", { directory });
      setAllFiles(files);

      console.log(`📁 WorkspaceService loaded ${wsContext.totalLoadedFiles}/${wsContext.totalFiles} files (${Math.round(wsContext.totalLoadedSize / 1024)}KB) for AI context`);
    } catch (err) {
      console.error("WorkspaceService scan failed, using fallback:", err);
      // Fallback to original loading method
      try {
        const files = await invoke<string[]>("get_all_files", { directory });
        setAllFiles(files);

        const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx', '.css', '.html', '.json', '.rs', '.toml', '.md', '.py', '.go', '.java', '.c', '.cpp', '.h', '.swift', '.yaml', '.yml', '.sh', '.sql'];
        const skipDirs = ['node_modules', '.git', 'target', 'dist', 'build', '.next', '.cache', '__pycache__', '.claude'];
        const sourceFiles = files.filter(f => {
          const lower = f.toLowerCase();
          if (skipDirs.some(d => lower.includes(`/${d}/`) || lower.includes(`\\${d}\\`))) return false;
          return sourceExtensions.some(ext => lower.endsWith(ext));
        });

        const contents: Record<string, string> = {};
        let totalSize = 0;
        const maxTotalSize = 80000;
        for (const filePath of sourceFiles) {
          if (totalSize >= maxTotalSize) break;
          try {
            const content = await readTextFile(filePath);
            if (content.length > 10000) continue;
            const relativePath = filePath.replace(directory + '/', '');
            contents[relativePath] = content;
            totalSize += content.length;
          } catch {
            // Skip unreadable files
          }
        }
        setProjectFileContents(contents);
      } catch (fallbackErr) {
        console.error("Fallback loading also failed:", fallbackErr);
      }
    }
  }, []);

  // Auto-load project files when currentDir is explicitly set
  useEffect(() => {
    if (currentDir && currentDir !== '~' && currentDir !== '') {
      loadProjectFiles(currentDir);
    }
  }, [currentDir, loadProjectFiles]);

  const handleOpenProject = async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected && typeof selected === "string") {
        setCurrentDir(selected);
        // Also cd the shell into the project
        try {
          await invoke("set_shell_cwd", { cwd: selected });
          setShellCwd(selected);
        } catch { }

        await loadProjectFiles(selected);
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

  const handleQuickFinderSelect = async (filePath: string) => {
    const fullPath = currentDir ? `${currentDir}/${filePath}` : filePath;
    const fileName = filePath.split('/').pop() || filePath;

    const existingTab = openTabs.find(t => t.path === fullPath);
    if (existingTab) {
      setActiveTabId(existingTab.id);
      return;
    }

    try {
      const content = await readTextFile(fullPath);
      const newTab: OpenTab = {
        id: Date.now().toString(),
        path: fullPath,
        name: fileName,
        content,
        isDirty: false,
      };
      setOpenTabs(prev => [...prev, newTab]);
      setActiveTabId(newTab.id);
    } catch {
      alert("Cannot read this file (binary or permission denied)");
    }
  };

  const handleSearchResultClick = async (file: string, _line: number) => {
    const fullPath = currentDir ? `${currentDir}/${file}` : file;
    const fileName = file.split('/').pop() || file;

    const existingTab = openTabs.find(t => t.path === fullPath);
    if (existingTab) {
      setActiveTabId(existingTab.id);
      // TODO: Scroll to line number
      return;
    }

    try {
      const content = await readTextFile(fullPath);
      const newTab: OpenTab = {
        id: Date.now().toString(),
        path: fullPath,
        name: fileName,
        content,
        isDirty: false,
      };
      setOpenTabs(prev => [...prev, newTab]);
      setActiveTabId(newTab.id);
      // TODO: Scroll to line number
    } catch {
      alert("Cannot read this file (binary or permission denied)");
    }
  };

  const handleWriteToTerminal = useCallback((data: string) => {
    const activeRef = terminalRefs.current.get(activeTerminalId);
    if (activeRef) {
      activeRef.write(data);
      activeRef.focus();
    }
  }, [activeTerminalId]);

  // Open one terminal tab per prompt and run `claude "<prompt>"` in each
  const handleStartAutomation = useCallback((prompts: string[]) => {
    if (prompts.length === 0) return;

    const newTabs: TerminalTab[] = prompts.map((_, i) => ({
      id: `automation-${Date.now()}-${i}`,
      title: `Agent ${i + 1}`,
    }));

    // Store the claude command for each tab — consumed when the TerminalBlock mounts
    prompts.forEach((prompt, i) => {
      const escaped = prompt.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      pendingAutomationCommands.current.set(newTabs[i].id, `claude "${escaped}"\r`);
    });

    setTerminalTabs(prev => [...prev, ...newTabs]);
    setActiveTerminalId(newTabs[0].id);
  }, []);

  const handleGitFileClick = async (file: string) => {
    const fullPath = currentDir ? `${currentDir}/${file}` : file;
    const fileName = file.split('/').pop() || file;

    const existingTab = openTabs.find(t => t.path === fullPath);
    if (existingTab) {
      setActiveTabId(existingTab.id);
      return;
    }

    try {
      const content = await readTextFile(fullPath);
      const newTab: OpenTab = {
        id: Date.now().toString(),
        path: fullPath,
        name: fileName,
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

    // Calculate remaining tabs before updating state to avoid race condition
    const remaining = openTabs.filter(t => t.id !== tabId);
    setOpenTabs(remaining);

    if (activeTabId === tabId) {
      setActiveTabId(remaining.length > 0 ? remaining[remaining.length - 1].id : null);
    }
  };

  const handleTabContentChange = (tabId: string, content: string) => {
    setOpenTabs(prev => prev.map(t => t.id === tabId ? { ...t, content, isDirty: true } : t));
  };

  const handleTabSaved = (tabId: string) => {
    setOpenTabs(prev => prev.map(t => t.id === tabId ? { ...t, isDirty: false } : t));
  };

  const handleAIConfigSave = useCallback(async (config: AIConfig) => {
    setAiConfig(config);
    if (config.apiKey) {
      await aiService.setApiKey(config.provider, config.apiKey);
      aiService.setProvider(config.provider, config.model);

      // Add to configuredProviders if not already present
      setConfiguredProviders(prev => {
        if (prev.find(p => p.id === config.provider)) return prev;
        const providerInfo = AI_PROVIDERS.find(p => p.id === config.provider);
        return [...prev, { id: config.provider, name: providerInfo?.name ?? config.provider }];
      });

      // If this is the OpenAI/ChatGPT provider, also update the openaiApiKey for voice features
      if (config.provider === 'chatgpt') {
        setOpenaiApiKey(config.apiKey);
      }
    }
  }, []);

  const handleModelChange = useCallback((model: string) => {
    if (aiConfig) {
      const newConfig = { ...aiConfig, model };
      setAiConfig(newConfig);
      aiService.setProvider(newConfig.provider, model);
    }
  }, [aiConfig]);

  const handleProviderChange = useCallback(async (providerId: string) => {
    const provider = AI_PROVIDERS.find(p => p.id === providerId);
    if (!provider) return;

    try {
      const key = await invoke<string>("get_api_key", { provider: providerId });
      if (key) {
        aiService.setProvider(providerId as AIProvider["id"], provider.models[0]);
        setAiConfig({
          provider: providerId as AIProvider["id"],
          model: provider.models[0],
          apiKey: key,
        });
      }
    } catch (error) {
      console.error(`Failed to switch to provider ${providerId}:`, error);
    }
  }, []);

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
          style={{ paddingLeft: `${10 + depth * 14}px` }}
          onClick={() => handleFileClick(file)}
        >
          <span className="item-icon">
            {file.isDirectory ? (
              file.isLoading ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{opacity: 0.5}}>
                  <circle cx="12" cy="12" r="10"/>
                </svg>
              ) : file.isOpen ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 6 15 12 9 18"/>
                </svg>
              )
            ) : null}
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

  // Voice chat requires an API key to show
  const canShowVoiceChat = showVoiceChat && !!openaiApiKey;

  // Is the right panel visible (tool panel, search panel, git panel, voice chat, automation, or swarm)
  // Only show right panel if there's actually something to display
  const hasRightPanel = showToolPanel || showSearchPanel || showGitPanel || canShowVoiceChat || showAutomation || showSwarm;

  return (
    <div className={`app ${theme}`}>
      {/* Sidebar: activity bar + explorer panel */}
      <aside className="sidebar">
        {/* Narrow activity bar with icon buttons */}
        <div className="activity-bar">
          <div className="activity-top">
            <button
              className={`activity-btn ${!hasRightPanel ? 'active' : ''}`}
              title="Explorer"
              onClick={() => {
                setShowToolPanel(false);
                setShowSearchPanel(false);
                setShowGitPanel(false);
                setShowVoiceChat(false);
                setShowAutomation(false);
                setShowSwarm(false);
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3h6l2 3h10a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/>
              </svg>
            </button>
          </div>

          <div className="activity-middle">
            {/* Voice button — shows setup popup when no API key configured */}
            <div className="activity-btn-wrap" ref={voiceSetupRef}>
              <button
                className={`activity-btn ${showVoiceChat ? 'active' : ''} ${!openaiApiKey ? 'needs-setup' : ''}`}
                onClick={() => {
                  if (!openaiApiKey) {
                    setShowVoiceSetup(v => !v);
                    return;
                  }
                  setShowVoiceSetup(false);
                  setShowVoiceChat(!showVoiceChat);
                  if (!showVoiceChat) { setShowGitPanel(false); setShowSearchPanel(false); setShowToolPanel(false); setShowAutomation(false); setShowSwarm(false); }
                }}
                title={openaiApiKey ? "Voice Chat" : "Voice Chat — setup required"}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <line x1="12" y1="19" x2="12" y2="23"/>
                  <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
                {!openaiApiKey && <span className="activity-btn-badge" />}
              </button>

              {showVoiceSetup && !openaiApiKey && (
                <div className="voice-setup-popup">
                  <div className="voice-setup-header">
                    <div className="voice-setup-icon">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                        <line x1="12" y1="19" x2="12" y2="23"/>
                        <line x1="8" y1="23" x2="16" y2="23"/>
                      </svg>
                    </div>
                    <span className="voice-setup-title">Voice Chat</span>
                    <button className="voice-setup-close" onClick={() => setShowVoiceSetup(false)}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                    </button>
                  </div>
                  <p className="voice-setup-desc">
                    Voice Chat requires an OpenAI API key. Here's how to get started:
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
                    onClick={() => { setShowSettings(true); setShowVoiceSetup(false); }}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="3"/>
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                    </svg>
                    Open Settings
                  </button>
                </div>
              )}
            </div>

            <button
              className={`activity-btn ${showGitPanel ? 'active' : ''}`}
              onClick={() => {
                setShowGitPanel(!showGitPanel);
                if (!showGitPanel) { setShowVoiceChat(false); setShowSearchPanel(false); setShowToolPanel(false); setShowAutomation(false); setShowSwarm(false); }
              }}
              title="Git"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <line x1="6" y1="3" x2="6" y2="15"/>
                <circle cx="18" cy="6" r="3"/>
                <circle cx="6" cy="18" r="3"/>
                <path d="M18 9a9 9 0 0 1-9 9"/>
              </svg>
            </button>

            <button
              className={`activity-btn ${showSearchPanel ? 'active' : ''}`}
              onClick={() => {
                setShowSearchPanel(!showSearchPanel);
                if (!showSearchPanel) { setShowVoiceChat(false); setShowGitPanel(false); setShowToolPanel(false); setShowAutomation(false); setShowSwarm(false); }
              }}
              title="Search"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </button>

            <button
              className={`activity-btn ${showToolPanel ? 'active' : ''}`}
              onClick={() => {
                setShowToolPanel(!showToolPanel);
                if (!showToolPanel) { setShowVoiceChat(false); setShowGitPanel(false); setShowSearchPanel(false); setShowAutomation(false); setShowSwarm(false); }
              }}
              title="Tools"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
              </svg>
            </button>

            <button
              className={`activity-btn ${showAutomation ? 'active' : ''}`}
              onClick={() => {
                setShowAutomation(!showAutomation);
                if (!showAutomation) { setShowVoiceChat(false); setShowGitPanel(false); setShowSearchPanel(false); setShowToolPanel(false); setShowSwarm(false); }
              }}
              disabled={!aiConfig?.apiKey}
              title={!aiConfig?.apiKey ? "Automation requires an API key. Add one in Settings." : "Automation — Run multiple AI agents automatically"}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
              </svg>
            </button>

            <button
              className={`activity-btn ${showSwarm ? 'active' : ''}`}
              onClick={() => {
                setShowSwarm(!showSwarm);
                if (!showSwarm) { setShowVoiceChat(false); setShowGitPanel(false); setShowSearchPanel(false); setShowToolPanel(false); setShowAutomation(false); }
              }}
              disabled={!aiConfig?.apiKey || !currentDir}
              title={!aiConfig?.apiKey ? "Swarm requires an API key. Add one in Settings." : !currentDir ? "Swarm requires an open project." : "Swarm — Multi-agent orchestration"}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="5" r="2.5"/>
                <circle cx="5" cy="19" r="2.5"/>
                <circle cx="19" cy="19" r="2.5"/>
                <line x1="12" y1="7.5" x2="12" y2="12"/>
                <line x1="12" y1="12" x2="5" y2="16.5"/>
                <line x1="12" y1="12" x2="19" y2="16.5"/>
              </svg>
            </button>
          </div>

          <div className="activity-bottom">
            <button className="activity-btn" onClick={() => setShowSettings(true)} title="Settings">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Explorer panel: project name + file tree */}
        <div className="explorer-panel">
          <div className="explorer-header">
            <span className="explorer-title">
              {currentDir ? currentDir.split("/").pop()?.toUpperCase() : "EXPLORER"}
            </span>
            <button className="explorer-open-btn" onClick={handleOpenProject} title="Open Folder">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
            </button>
          </div>
          <div className="file-tree">
            {!currentDir && <div className="empty-state">Open a project to get started</div>}
            {renderFileTree(projectFiles)}
          </div>
        </div>
      </aside>

      {/* Main content area: editor + terminal + optional right panel */}
      <main className="main-split">
        {/* Terminal pane — horizontal split: editor left, terminal right */}
        <div className="terminal-pane">

          {/* Left: Editor panel — visible when one or more files are open */}
          {openTabs.length > 0 && (
            <>
              <div
                className="editor-section"
                style={{ width: `${terminalWidth}%` }}
              >
                <div className="editor-tabs">
                  {openTabs.map(tab => (
                    <div
                      key={tab.id}
                      className={`editor-tab ${tab.id === activeTabId ? 'active' : ''}`}
                      onClick={() => setActiveTabId(tab.id)}
                    >
                      <span className="editor-tab-name">
                        {tab.name}{tab.isDirty ? ' ●' : ''}
                      </span>
                      <button
                        className="editor-tab-close"
                        onClick={(e) => handleCloseTab(tab.id, e)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>

                {activeTab && (
                  <CodeEditor
                    filePath={activeTab.path}
                    content={activeTab.content}
                    onContentChange={(content) => handleTabContentChange(activeTabId!, content)}
                    onSave={() => handleTabSaved(activeTabId!)}
                    tabSize={tabSize}
                  />
                )}
              </div>

              {/* Drag handle between editor and terminal */}
              <div
                className={`editor-resize-handle${isResizing ? ' resizing' : ''}`}
                onMouseDown={handleResizeStart}
              />
            </>
          )}

          {/* Right: Terminal area */}
          <div className="terminal-area">
            <div className="terminal-topbar">
              <div className="terminal-tabs">
                {terminalTabs.map(tab => (
                  <div
                    key={tab.id}
                    className={`terminal-tab ${tab.id === activeTerminalId ? "active" : ""}`}
                    onClick={() => setActiveTerminalId(tab.id)}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="terminal-tab-icon">
                      <polyline points="4 17 10 11 4 5"/>
                      <line x1="12" y1="19" x2="20" y2="19"/>
                    </svg>
                    <span className="terminal-tab-title">{tab.title}</span>
                    {terminalTabs.length > 1 && (
                      <button
                        className="terminal-tab-close"
                        onClick={(e) => closeTerminalTab(tab.id, e)}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
                <button className="terminal-tab-add" onClick={addTerminalTab} title="New Terminal (Cmd+D)">
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19"/>
                    <line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                </button>
              </div>
            </div>

            <div className={`terminal-body ${terminalTabs.length > 1 ? 'split-view' : ''}`}>
              {terminalTabs.flatMap((tab, index) => {
                const isVisible = terminalTabs.length > 1 || tab.id === activeTerminalId;
                const widthStyle = terminalTabs.length > 1 && splitWidths.length === terminalTabs.length
                  ? { flexBasis: `${splitWidths[index]}%`, flexGrow: 0, flexShrink: 0 }
                  : {};
                const tabEl = (
                <div
                  key={tab.id}
                  className={`terminal-tab-content ${tab.id === activeTerminalId ? 'active' : ''}`}
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
                    ref={(el) => {
                      if (el) {
                        terminalRefs.current.set(tab.id, el);
                        const pendingCmd = pendingAutomationCommands.current.get(tab.id);
                        if (pendingCmd) {
                          pendingAutomationCommands.current.delete(tab.id);
                          setTimeout(() => el.write(pendingCmd), 800);
                        }
                      } else {
                        terminalRefs.current.delete(tab.id);
                      }
                    }}
                    cwd={shellCwd}
                    onCwdChange={setShellCwd}
                    theme={theme}
                    onAIRequest={handleAIRequest}
                    aiEnabled={!!aiConfig?.apiKey}
                    recentFiles={openTabs.map(tab => tab.path)}
                    gitChanges={gitChanges}
                    currentFile={activeTab ? {
                      path: activeTab.path,
                      content: activeTab.content,
                      language: activeTab.path.split('.').pop() || 'text'
                    } : undefined}
                    onFileUpdate={(path, content) => {
                      const tab = openTabs.find(t => t.path === path);
                      if (tab) {
                        handleTabContentChange(tab.id, content);
                      }
                    }}
                    onOpenGitPanel={() => {
                      setShowGitPanel(true);
                      setShowVoiceChat(false);
                      setShowSearchPanel(false);
                      setShowToolPanel(false);
                      setShowAutomation(false);
                      setShowSwarm(false);
                    }}
                    projectDir={currentDir}
                    projectFileList={allFiles}
                    projectFileContents={projectFileContents}
                    workspaceContext={workspaceContext}
                  />
                </div>
                );
                const elements = [tabEl];
                if (terminalTabs.length > 1 && index < terminalTabs.length - 1) {
                  elements.push(
                    <div
                      key={`split-handle-${index}`}
                      className="split-resize-handle"
                      onMouseDown={(e) => handleSplitResizeStart(e, index)}
                    />
                  );
                }
                return elements;
              })}
            </div>
          </div>
        </div>

        {/* Right panel: tools, search, git, voice, automation, or swarm */}
        <div className={`right-panel${hasRightPanel ? ' open' : ''}`}>
          {showToolPanel && (
            <ToolPanel
              filePath={null}
              fileContent=""
              projectDir={currentDir}
              onClose={() => setShowToolPanel(false)}
            />
          )}
          {showSearchPanel && (
            <SearchPanel
              currentDir={currentDir}
              onResultClick={async (path: string) => {
                try {
                  const fullPath = currentDir ? `${currentDir}/${path}` : path;
                  const content = await readTextFile(fullPath);
                  const newTab = {
                    id: Date.now().toString(),
                    path: fullPath,
                    name: path.split('/').pop() || path,
                    content,
                    isDirty: false,
                  };
                  setOpenTabs(prev => [...prev, newTab]);
                  setActiveTabId(newTab.id);
                  setShowSearchPanel(false);
                } catch {
                  alert("Cannot read this file");
                }
              }}
            />
          )}
          {showGitPanel && (
            <GitPanel
              currentDir={currentDir}
              onFileClick={async (path: string) => {
                try {
                  const fullPath = currentDir ? `${currentDir}/${path}` : path;
                  const content = await readTextFile(fullPath);
                  const newTab = {
                    id: Date.now().toString(),
                    path: fullPath,
                    name: path.split('/').pop() || path,
                    content,
                    isDirty: false,
                  };
                  setOpenTabs(prev => [...prev, newTab]);
                  setActiveTabId(newTab.id);
                } catch {
                  alert("Cannot read this file");
                }
              }}
            />
          )}
          {showAutomation && (
            <AutomationPanel
              isOpen={showAutomation}
              onClose={() => setShowAutomation(false)}
              theme={theme}
              hasApiKey={!!aiConfig?.apiKey}
              configuredProviders={configuredProviders}
              terminalTabs={terminalTabs}
              terminalRefs={terminalRefs}
              onAddTerminal={addTerminalTab}
              onGeneratePrompts={(goal, count) => aiService.generateAutomationPrompts(goal, count)}
              onStartAutomation={handleStartAutomation}
            />
          )}
          {showSwarm && (
            <SwarmPanel
              isOpen={showSwarm}
              onClose={() => setShowSwarm(false)}
              theme={theme}
              workspacePath={currentDir}
              hasApiKey={!!aiConfig?.apiKey}
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

      {/* Status bar */}
      <div className="status-bar">
        <div className="status-left">
          {currentDir ? (
            <>
              <span className="status-item status-branch">
                <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="6" y1="3" x2="6" y2="15"/>
                  <circle cx="18" cy="6" r="3"/>
                  <circle cx="6" cy="18" r="3"/>
                  <path d="M18 9a9 9 0 0 1-9 9"/>
                </svg>
                <span>main</span>
              </span>
              <span className="status-sep"/>
              <span className="status-item">{currentDir.split("/").pop()}</span>
            </>
          ) : (
            <span className="status-item status-muted">No project open</span>
          )}
        </div>
        <div className="status-right">
          {activeTab && (
            <span className="status-item status-lang">
              {activeTab.path.split('.').pop()?.toUpperCase() || 'TEXT'}
            </span>
          )}
          <button
            className="status-item status-theme-btn"
            onClick={() => handleThemeChange(theme === 'dark' ? 'light' : 'dark')}
            title="Toggle Theme"
          >
            {theme === 'dark' ? '☀' : '◗'}
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
        tabSize={tabSize}
        onTabSizeChange={handleTabSizeChange}
      />

      <QuickFileFinder
        isOpen={showQuickFinder}
        onClose={() => setShowQuickFinder(false)}
        files={allFiles}
        onFileSelect={handleQuickFinderSelect}
      />
    </div>
  );
}

export default App;
