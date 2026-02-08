import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";
import "./TerminalBlock.css";

interface TerminalBlockProps {
  cwd?: string;
  onCwdChange?: (cwd: string) => void;
  theme?: "light" | "dark";
  onAIRequest?: (prompt: string) => void;
  aiEnabled?: boolean;
}

interface PtyOutput {
  session_id: string;
  data: string;
}

interface PtyExit {
  session_id: string;
  exit_code: number | null;
}

// Detect if input is an AI request (starts with natural language patterns)
function isAIRequest(input: string): boolean {
  const trimmed = input.trim().toLowerCase();

  // Empty or very short inputs are terminal commands
  if (trimmed.length < 3) return false;

  // AI trigger patterns
  const aiPatterns = [
    /^(can you|could you|please|help me|how (do|can|to)|what is|explain|create|make|build|fix|add|remove|update|change|modify|write|generate|show me|tell me|why|where|when|who)/i,
    /^(i want|i need|i'd like|let's|lets)/i,
    /\?$/, // Questions ending with ?
  ];

  // Terminal command patterns (common commands)
  const terminalPatterns = [
    /^(ls|cd|pwd|cat|echo|mkdir|rm|cp|mv|touch|grep|find|chmod|chown|sudo|apt|brew|npm|yarn|pnpm|git|docker|python|node|cargo|go|make|cmake|gcc|clang|vim|nano|code|open|which|whereis|man|exit|clear|history|alias|export|source|curl|wget|ssh|scp|tar|zip|unzip|ping|ifconfig|netstat|ps|top|htop|kill|killall|df|du|head|tail|less|more|sort|uniq|wc|sed|awk|xargs|tee|diff|patch|file|stat|ln|env|set|unset|read|test|expr|true|false|sleep|date|cal|bc|who|w|id|groups|passwd|su|chsh|finger|last|uptime|free|mount|umount|fdisk|mkfs|fsck|dd|lsblk|blkid|parted|lvm|systemctl|service|journalctl|dmesg|modprobe|lsmod|insmod|rmmod|uname|hostname|domainname|ifup|ifdown|route|arp|traceroute|nslookup|dig|host|whois|iptables|firewall-cmd|selinux|crontab|at|batch|watch|screen|tmux|nohup|disown|fg|bg|jobs|wait|trap|ulimit|nice|renice|time|timeout|strace|ltrace|gdb|valgrind|objdump|nm|ldd|strings|xxd|od|hexdump|base64|md5sum|sha1sum|sha256sum|sha512sum|gpg|openssl|ssh-keygen|ssh-add|ssh-agent|sshd|rsync|rclone|aws|gcloud|az|kubectl|helm|terraform|ansible|vagrant|packer)(\s|$)/,
    /^\.\//, // ./something
    /^\//, // /absolute/path
    /^\.\.$/, // ..
    /^~/, // ~/path
  ];

  // Check if it matches terminal patterns first
  for (const pattern of terminalPatterns) {
    if (pattern.test(trimmed)) return false;
  }

  // Check if it matches AI patterns
  for (const pattern of aiPatterns) {
    if (pattern.test(trimmed)) return true;
  }

  // If contains multiple words and looks like natural language
  const words = trimmed.split(/\s+/);
  if (words.length >= 3) {
    // Check if first word looks like a verb/question word
    const firstWord = words[0];
    const naturalStarters = ['the', 'a', 'an', 'this', 'that', 'these', 'those', 'my', 'your', 'our', 'their', 'its', 'i', 'we', 'you', 'he', 'she', 'it', 'they'];
    if (naturalStarters.includes(firstWord)) return true;
  }

  return false;
}

export function TerminalBlock({ cwd, theme = "dark", onAIRequest, aiEnabled = false }: TerminalBlockProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string>("");
  const unlistenOutputRef = useRef<UnlistenFn | null>(null);
  const unlistenExitRef = useRef<UnlistenFn | null>(null);

  const [inputValue, setInputValue] = useState("");
  const [inputMode, setInputMode] = useState<"terminal" | "ai">("terminal");
  const [showInputBar, setShowInputBar] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  // Generate a unique session ID
  const generateSessionId = () => {
    return `pty-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  };

  // Create PTY session
  const createPtySession = useCallback(async (rows: number, cols: number) => {
    const sessionId = generateSessionId();
    sessionIdRef.current = sessionId;

    try {
      await invoke("pty_create", {
        sessionId,
        rows,
        cols,
        cwd: cwd || undefined,
      });
      return sessionId;
    } catch (error) {
      console.error("Failed to create PTY session:", error);
      throw error;
    }
  }, [cwd]);

  // Write to PTY
  const writeToPty = useCallback(async (data: string) => {
    if (!sessionIdRef.current) return;

    try {
      await invoke("pty_write", {
        sessionId: sessionIdRef.current,
        data,
      });
    } catch (error) {
      console.error("Failed to write to PTY:", error);
    }
  }, []);

  // Resize PTY
  const resizePty = useCallback(async (rows: number, cols: number) => {
    if (!sessionIdRef.current) return;

    try {
      await invoke("pty_resize", {
        sessionId: sessionIdRef.current,
        rows,
        cols,
      });
    } catch (error) {
      console.error("Failed to resize PTY:", error);
    }
  }, []);

  // Kill PTY session
  const killPtySession = useCallback(async () => {
    if (!sessionIdRef.current) return;

    try {
      await invoke("pty_kill", {
        sessionId: sessionIdRef.current,
      });
    } catch (error) {
      // Session might already be dead
      console.log("PTY session cleanup:", error);
    }
    sessionIdRef.current = "";
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    // Theme configurations
    const darkTheme = {
      background: "#0d1117",
      foreground: "#c9d1d9",
      cursor: "#58a6ff",
      cursorAccent: "#0d1117",
      selectionBackground: "#264f78",
      selectionForeground: "#ffffff",
      black: "#484f58",
      red: "#ff7b72",
      green: "#3fb950",
      yellow: "#d29922",
      blue: "#58a6ff",
      magenta: "#bc8cff",
      cyan: "#39c5cf",
      white: "#b1bac4",
      brightBlack: "#6e7681",
      brightRed: "#ffa198",
      brightGreen: "#56d364",
      brightYellow: "#e3b341",
      brightBlue: "#79c0ff",
      brightMagenta: "#d2a8ff",
      brightCyan: "#56d4dd",
      brightWhite: "#f0f6fc",
    };

    const lightTheme = {
      background: "#ffffff",
      foreground: "#24292f",
      cursor: "#0969da",
      cursorAccent: "#ffffff",
      selectionBackground: "#0969da33",
      selectionForeground: "#24292f",
      black: "#24292f",
      red: "#cf222e",
      green: "#116329",
      yellow: "#4d2d00",
      blue: "#0969da",
      magenta: "#8250df",
      cyan: "#1b7c83",
      white: "#6e7781",
      brightBlack: "#57606a",
      brightRed: "#a40e26",
      brightGreen: "#1a7f37",
      brightYellow: "#633c01",
      brightBlue: "#218bff",
      brightMagenta: "#a475f9",
      brightCyan: "#3192aa",
      brightWhite: "#8c959f",
    };

    // Create terminal instance
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontSize: 13,
      fontFamily: "'SF Mono', 'JetBrains Mono', 'Menlo', 'Monaco', monospace",
      letterSpacing: 0,
      lineHeight: 1.5,
      allowProposedApi: true,
      scrollback: 10000,
      theme: theme === "light" ? lightTheme : darkTheme,
    });

    // Create and load fit addon
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    fitAddonRef.current = fitAddon;

    // Open terminal in container
    term.open(containerRef.current);
    termRef.current = term;

    // Fit terminal to container
    setTimeout(() => {
      fitAddon.fit();
    }, 0);

    // Setup event listeners and PTY session
    const setup = async () => {
      // Listen for PTY output
      unlistenOutputRef.current = await listen<PtyOutput>("pty-output", (event) => {
        if (event.payload.session_id === sessionIdRef.current) {
          term.write(event.payload.data);
        }
      });

      // Listen for PTY exit
      unlistenExitRef.current = await listen<PtyExit>("pty-exit", (event) => {
        if (event.payload.session_id === sessionIdRef.current) {
          term.writeln("\r\n\x1b[90m[Process exited]\x1b[0m");
          // Optionally restart the shell
          setTimeout(async () => {
            try {
              await createPtySession(term.rows, term.cols);
            } catch (error) {
              term.writeln("\x1b[31mFailed to restart shell\x1b[0m");
            }
          }, 500);
        }
      });

      // Create PTY session
      try {
        await createPtySession(term.rows, term.cols);
      } catch (error) {
        term.writeln(`\x1b[31mFailed to create terminal session: ${error}\x1b[0m`);
      }
    };

    setup();

    // Handle user input - send to PTY
    const onDataDisposable = term.onData((data) => {
      writeToPty(data);
    });

    // Handle terminal resize
    const onResizeDisposable = term.onResize(({ rows, cols }) => {
      resizePty(rows, cols);
    });

    // Handle window resize
    const handleWindowResize = () => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
      }
    };
    window.addEventListener("resize", handleWindowResize);

    // Observe container size changes
    const resizeObserver = new ResizeObserver(() => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
      }
    });
    resizeObserver.observe(containerRef.current);

    // Cleanup
    return () => {
      onDataDisposable.dispose();
      onResizeDisposable.dispose();
      window.removeEventListener("resize", handleWindowResize);
      resizeObserver.disconnect();

      if (unlistenOutputRef.current) {
        unlistenOutputRef.current();
      }
      if (unlistenExitRef.current) {
        unlistenExitRef.current();
      }

      killPtySession();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [createPtySession, writeToPty, resizePty, killPtySession, theme]);

  // Handle input change and detect mode
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);

    // Always detect mode visually, regardless of aiEnabled
    if (value.trim()) {
      setInputMode(isAIRequest(value) ? "ai" : "terminal");
    } else {
      setInputMode("terminal");
    }
  };

  // Handle input submission
  const handleInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!inputValue.trim()) return;

    if (inputMode === "ai") {
      if (aiEnabled && onAIRequest) {
        onAIRequest(inputValue);
      } else {
        // AI not configured, show message in terminal
        if (termRef.current) {
          termRef.current.writeln("\r\n\x1b[33m[AI not configured. Go to Settings to add your API key.]\x1b[0m\r\n");
        }
      }
    } else {
      // Send to terminal
      writeToPty(inputValue + "\r");
    }

    setInputValue("");
    setInputMode("terminal");
  };

  // Handle key events in the terminal area
  const handleTerminalClick = () => {
    // Focus the input when clicking on terminal
    inputRef.current?.focus();
  };

  return (
    <div className={`terminal-wrapper ${theme}`}>
      <div
        className="terminal-scroll-area"
        onClick={handleTerminalClick}
      >
        <div
          className="terminal-container"
          ref={containerRef}
        />
      </div>

      {showInputBar && (
        <form className="terminal-input-bar" onSubmit={handleInputSubmit}>
          <div className={`input-mode-indicator ${inputMode}`}>
            {inputMode === "ai" ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"/>
                <circle cx="7.5" cy="14.5" r="1.5"/>
                <circle cx="16.5" cy="14.5" r="1.5"/>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="4 17 10 11 4 5"/>
                <line x1="12" y1="19" x2="20" y2="19"/>
              </svg>
            )}
          </div>

          <input
            ref={inputRef}
            type="text"
            className={`terminal-smart-input ${inputMode}`}
            value={inputValue}
            onChange={handleInputChange}
            placeholder="Type a command or ask AI (e.g., 'how do I...')"
            autoFocus
          />

          <div className="input-actions">
            {inputMode === "ai" && (
              <span className="mode-badge ai">AI</span>
            )}
            <button type="submit" className="submit-btn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
