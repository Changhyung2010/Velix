import { useEffect, useMemo, useState, type ReactNode } from "react";
import { invoke } from "../platform/native";
import { AIConfig, AI_PROVIDERS, AIProvider } from "./Settings";
import "./SetupScreen.css";

type Theme = "light" | "dark";
type SaveState = "idle" | "saving" | "saved" | "error";
type SetupScreenPhase = "idle" | "closing" | "loading" | "finishing";

interface SetupScreenProps {
  isOpen: boolean;
  phase?: SetupScreenPhase;
  theme: Theme;
  currentConfig: AIConfig | null;
  onThemeChange: (theme: Theme) => void;
  onSave: (config: AIConfig) => void;
  onClose: () => void;
  onOpenAdvancedSettings?: () => void;
}

interface SidebarGuideItem {
  id: string;
  label: string;
  group: string;
  description: string;
  detail: string;
  icon: ReactNode;
}

const loadingMessages = [
  "Setting up environment",
  "Applying your workspace theme",
  "Preparing terminal sessions",
  "Finalizing the first-run workspace",
];

const sidebarGuideItems: SidebarGuideItem[] = [
  {
    id: "terminal",
    label: "Terminal",
    group: "Top",
    description: "Jump back to the main coding workspace and terminal tabs.",
    detail: "Use this when you want the cleanest view for editing, running commands, and talking to the active terminal.",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <polyline points="7 9 10 12 7 15" />
        <line x1="13" y1="15" x2="17" y2="15" />
      </svg>
    ),
  },
  {
    id: "voice",
    label: "Voice Chat",
    group: "Top",
    description: "Start a real-time voice session once a ChatGPT key is connected.",
    detail: "Velix uses the OpenAI voice stack here, so this button stays in setup mode until you add a ChatGPT API key.",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8" y1="23" x2="16" y2="23" />
      </svg>
    ),
  },
  {
    id: "git",
    label: "Git",
    group: "Middle",
    description: "Open the Git panel to inspect branches and working tree changes.",
    detail: "Use this when you want to review modified files, branch state, and version-control context without leaving Velix.",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <line x1="6" y1="3" x2="6" y2="15" />
        <circle cx="18" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <path d="M18 9a9 9 0 0 1-9 9" />
      </svg>
    ),
  },
  {
    id: "search",
    label: "Search",
    group: "Middle",
    description: "Search across the active project from the side panel.",
    detail: "It is the fastest way to move through large repos when you know a symbol, filename, or text fragment you need to inspect.",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    ),
  },
  {
    id: "swarm",
    label: "Swarm",
    group: "Middle",
    description: "Launch coordinated multi-agent work when a project folder is open.",
    detail: "Swarm is for bigger tasks: coordinator-led breakdowns, multiple workers, and review across the same repository.",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="5" r="2.5" />
        <circle cx="5" cy="19" r="2.5" />
        <circle cx="19" cy="19" r="2.5" />
        <line x1="12" y1="7.5" x2="12" y2="12" />
        <line x1="12" y1="12" x2="5" y2="16.5" />
        <line x1="12" y1="12" x2="19" y2="16.5" />
      </svg>
    ),
  },
  {
    id: "settings",
    label: "Settings",
    group: "Bottom",
    description: "Open the advanced settings modal for the full provider list and appearance controls.",
    detail: "Use Settings when you want the detailed provider list, model management, or to reopen this guide later.",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
];

const claudeProvider = AI_PROVIDERS.find((provider) => provider.id === "claude");

export function SetupScreen({
  isOpen,
  phase = "idle",
  theme,
  currentConfig,
  onThemeChange,
  onSave,
  onClose,
  onOpenAdvancedSettings,
}: SetupScreenProps) {
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [expandedProviders, setExpandedProviders] = useState<Record<string, boolean>>({ claude: true });
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const [activeSidebarItemId, setActiveSidebarItemId] = useState(sidebarGuideItems[0].id);
  const [defaultProviderId, setDefaultProviderId] = useState<AIProvider["id"]>(currentConfig?.provider || "claude");
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);

  const optionalProviders = useMemo(
    () => AI_PROVIDERS.filter((provider) => provider.id !== "claude"),
    [],
  );

  const configuredProvidersCount = useMemo(
    () => AI_PROVIDERS.filter((provider) => Boolean(apiKeys[provider.id]?.trim())).length,
    [apiKeys],
  );

  const activeSidebarItem = sidebarGuideItems.find((item) => item.id === activeSidebarItemId) || sidebarGuideItems[0];
  const isInteractive = phase === "idle";

  useEffect(() => {
    setDefaultProviderId(currentConfig?.provider || "claude");
  }, [currentConfig]);

  useEffect(() => {
    if (phase !== "loading") {
      setLoadingMessageIndex(0);
      return;
    }

    const timers = loadingMessages.map((_, index) =>
      window.setTimeout(() => {
        setLoadingMessageIndex(index);
      }, index * 360),
    );

    return () => {
      timers.forEach((timerId) => window.clearTimeout(timerId));
    };
  }, [phase]);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    const loadApiKeys = async () => {
      const entries = await Promise.all(
        AI_PROVIDERS.map(async (provider) => {
          try {
            const key = await invoke<string>("get_api_key", { provider: provider.id });
            return [provider.id, key || ""] as const;
          } catch {
            return [provider.id, ""] as const;
          }
        }),
      );

      if (cancelled) return;

      const nextKeys = Object.fromEntries(entries) as Record<string, string>;
      const nextExpanded = entries.reduce<Record<string, boolean>>(
        (acc, [providerId, key]) => {
          if (providerId === "claude" || Boolean(key)) {
            acc[providerId] = true;
          }
          return acc;
        },
        { claude: true },
      );

      setApiKeys(nextKeys);
      setExpandedProviders(nextExpanded);

      const activeProviderWithKey = AI_PROVIDERS.find((provider) => nextKeys[provider.id]?.trim());
      if (!currentConfig?.provider && activeProviderWithKey) {
        setDefaultProviderId(activeProviderWithKey.id);
      }
    };

    loadApiKeys().catch((error) => {
      console.error("Failed to load API keys for setup screen:", error);
    });

    return () => {
      cancelled = true;
    };
  }, [currentConfig?.provider, isOpen]);

  if (!isOpen || !claudeProvider) return null;

  const updateKeyDraft = (providerId: string, value: string) => {
    if (!isInteractive) return;
    setApiKeys((prev) => ({ ...prev, [providerId]: value }));
  };

  const toggleProviderOpen = (providerId: string) => {
    if (!isInteractive) return;
    setExpandedProviders((prev) => ({ ...prev, [providerId]: !prev[providerId] }));
  };

  const toggleKeyVisibility = (providerId: string) => {
    if (!isInteractive) return;
    setShowKeys((prev) => ({ ...prev, [providerId]: !prev[providerId] }));
  };

  const markProviderSaved = (providerId: string, state: SaveState) => {
    setSaveStates((prev) => ({ ...prev, [providerId]: state }));
  };

  const getProviderModel = (provider: AIProvider) => {
    if (currentConfig?.provider === provider.id && currentConfig.model) {
      return currentConfig.model;
    }
    return provider.models[0];
  };

  const saveProviderKey = async (provider: AIProvider, activateAfterSave = false) => {
    if (!isInteractive) return;
    const trimmedKey = apiKeys[provider.id]?.trim() || "";
    if (!trimmedKey) return;

    markProviderSaved(provider.id, "saving");

    try {
      await invoke("save_api_key", { provider: provider.id, key: trimmedKey });
      setApiKeys((prev) => ({ ...prev, [provider.id]: trimmedKey }));
      markProviderSaved(provider.id, "saved");

      if (activateAfterSave) {
        setDefaultProviderId(provider.id);
        onSave({
          provider: provider.id,
          model: getProviderModel(provider),
          apiKey: trimmedKey,
        });
      }

      window.setTimeout(() => {
        setSaveStates((prev) => (prev[provider.id] === "saved" ? { ...prev, [provider.id]: "idle" } : prev));
      }, 1600);
    } catch (error) {
      console.error(`Failed to save ${provider.name} key:`, error);
      markProviderSaved(provider.id, "error");
    }
  };

  const activateExistingProvider = (provider: AIProvider) => {
    if (!isInteractive) return;
    const trimmedKey = apiKeys[provider.id]?.trim() || "";
    if (!trimmedKey) return;

    setDefaultProviderId(provider.id);
    onSave({
      provider: provider.id,
      model: getProviderModel(provider),
      apiKey: trimmedKey,
    });
  };

  const getStatusLabel = (provider: AIProvider) => {
    if (saveStates[provider.id] === "saving") return "Saving";
    if (saveStates[provider.id] === "saved") return "Saved";
    if (saveStates[provider.id] === "error") return "Retry";
    if (defaultProviderId === provider.id && apiKeys[provider.id]?.trim()) return "Default";
    if (apiKeys[provider.id]?.trim()) return "Connected";
    if (provider.id === "claude") return "Recommended";
    return provider.isFree ? "Optional free" : "Optional";
  };

  return (
    <div className={`setup-screen-overlay phase-${phase}`}>
      <div className={`setup-screen-shell ${phase !== "idle" ? "is-transitioning" : ""}`}>
        <aside className="setup-screen-intro">
          <span className="setup-eyebrow">Velix Setup</span>
          <h1>Start with a cleaner workspace, a live model, and a faster mental map.</h1>
          <p className="setup-intro-copy">
            This guide handles the first few decisions that matter: interface theme, Claude access,
            optional backup providers, and what every sidebar control is there for.
          </p>

          <div className="setup-intro-metrics">
            <div className="setup-metric-card">
              <span className="setup-metric-label">Theme</span>
              <strong>{theme === "dark" ? "Dark mode" : "Light mode"}</strong>
            </div>
            <div className="setup-metric-card">
              <span className="setup-metric-label">Providers</span>
              <strong>{configuredProvidersCount} connected</strong>
            </div>
          </div>

          <div className="setup-outline">
            <div className="setup-outline-item">
              <span>01</span>
              <div>
                <strong>Appearance</strong>
                <p>Pick the mode you want to work in.</p>
              </div>
            </div>
            <div className="setup-outline-item">
              <span>02</span>
              <div>
                <strong>AI access</strong>
                <p>Connect Claude first, then add extras if you want them.</p>
              </div>
            </div>
            <div className="setup-outline-item">
              <span>03</span>
              <div>
                <strong>Sidebar guide</strong>
                <p>Learn what each rail button opens before you dive in.</p>
              </div>
            </div>
          </div>

          <div className="setup-intro-actions">
            <button className="setup-secondary-btn" onClick={onClose} disabled={!isInteractive}>
              Skip for now
            </button>
            {onOpenAdvancedSettings && (
              <button className="setup-ghost-btn" onClick={onOpenAdvancedSettings} disabled={!isInteractive}>
                Advanced settings
              </button>
            )}
          </div>
        </aside>

        <div className="setup-screen-main">
          <div className="setup-screen-scroll">
            <section className="setup-panel">
              <div className="setup-panel-header">
                <span className="setup-panel-step">01</span>
                <div>
                  <h2>Choose your interface mode</h2>
                  <p>Switch instantly between a bright drafting surface and a darker terminal-heavy workspace.</p>
                </div>
              </div>

              <div className="setup-theme-grid">
                <button
                  className={`setup-theme-card ${theme === "light" ? "active" : ""}`}
                  onClick={() => onThemeChange("light")}
                  disabled={!isInteractive}
                >
                  <div className="setup-theme-preview light">
                    <span className="setup-theme-preview-bar" />
                    <span className="setup-theme-preview-panel" />
                    <span className="setup-theme-preview-panel secondary" />
                  </div>
                  <div className="setup-theme-copy">
                    <strong>Light</strong>
                    <span>Bright, paper-like contrast for scanning code and panels.</span>
                  </div>
                </button>

                <button
                  className={`setup-theme-card ${theme === "dark" ? "active" : ""}`}
                  onClick={() => onThemeChange("dark")}
                  disabled={!isInteractive}
                >
                  <div className="setup-theme-preview dark">
                    <span className="setup-theme-preview-bar" />
                    <span className="setup-theme-preview-panel" />
                    <span className="setup-theme-preview-panel secondary" />
                  </div>
                  <div className="setup-theme-copy">
                    <strong>Dark</strong>
                    <span>Lower-glare surfaces for longer terminal and coding sessions.</span>
                  </div>
                </button>
              </div>
            </section>

            <section className="setup-panel">
              <div className="setup-panel-header">
                <span className="setup-panel-step">02</span>
                <div>
                  <h2>Connect Claude first</h2>
                  <p>Claude is the default path here. Save it once, then add extra providers only if you want backup options.</p>
                </div>
              </div>

              <div className="setup-provider-featured">
                <div className="setup-provider-header">
                  <div>
                    <h3>{claudeProvider.name}</h3>
                    <p>{claudeProvider.apiKeyUrl?.replace("https://", "")}</p>
                  </div>
                  <span className={`setup-status-chip status-${getStatusLabel(claudeProvider).toLowerCase().replace(/\s+/g, "-")}`}>
                    {getStatusLabel(claudeProvider)}
                  </span>
                </div>

                <div className="setup-provider-actions-row">
                  <div className="setup-provider-input">
                    <input
                      type={showKeys.claude ? "text" : "password"}
                      placeholder={claudeProvider.placeholder}
                      value={apiKeys.claude || ""}
                      onChange={(e) => updateKeyDraft("claude", e.target.value)}
                      disabled={!isInteractive}
                    />
                    <button className="setup-inline-btn" onClick={() => toggleKeyVisibility("claude")} disabled={!isInteractive}>
                      {showKeys.claude ? "Hide" : "Show"}
                    </button>
                  </div>
                  <button
                    className="setup-primary-btn"
                    onClick={() => saveProviderKey(claudeProvider, true)}
                    disabled={!isInteractive || !apiKeys.claude?.trim()}
                  >
                    Save Claude
                  </button>
                </div>

                <div className="setup-provider-notes">
                  <ol>
                    {claudeProvider.apiKeySteps?.slice(0, 3).map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                  {claudeProvider.apiKeyUrl && (
                    <a
                      href={isInteractive ? claudeProvider.apiKeyUrl : undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`setup-provider-link ${!isInteractive ? "disabled" : ""}`}
                      onClick={(e) => {
                        if (!isInteractive) e.preventDefault();
                      }}
                    >
                      Open Claude console
                    </a>
                  )}
                </div>
              </div>

              <div className="setup-optional-section">
                <div className="setup-optional-header">
                  <div>
                    <h3>Add more providers if you want them</h3>
                    <p>Optional keys stay ready for later. You can promote any saved provider to the default slot.</p>
                  </div>
                </div>

                <div className="setup-provider-grid">
                  {optionalProviders.map((provider) => {
                    const isExpanded = Boolean(expandedProviders[provider.id]);
                    const hasKey = Boolean(apiKeys[provider.id]?.trim());

                    return (
                      <article
                        key={provider.id}
                        className={`setup-provider-tile ${isExpanded ? "expanded" : ""} ${defaultProviderId === provider.id ? "default" : ""}`}
                      >
                        <button className="setup-provider-tile-head" onClick={() => toggleProviderOpen(provider.id)} disabled={!isInteractive}>
                          <div className="setup-provider-tile-title">
                            <strong>{provider.name}</strong>
                            <span>{getStatusLabel(provider)}</span>
                          </div>
                          <span className="setup-provider-toggle">{isExpanded ? "Hide" : "Add"}</span>
                        </button>

                        {isExpanded && (
                          <div className="setup-provider-tile-body">
                            {provider.description && <p className="setup-provider-description">{provider.description}</p>}

                            <div className="setup-provider-input compact">
                              <input
                                type={showKeys[provider.id] ? "text" : "password"}
                                placeholder={provider.placeholder}
                                value={apiKeys[provider.id] || ""}
                                onChange={(e) => updateKeyDraft(provider.id, e.target.value)}
                                disabled={!isInteractive}
                              />
                              <button className="setup-inline-btn" onClick={() => toggleKeyVisibility(provider.id)} disabled={!isInteractive}>
                                {showKeys[provider.id] ? "Hide" : "Show"}
                              </button>
                            </div>

                            <div className="setup-provider-tile-actions">
                              <button
                                className="setup-inline-action"
                                onClick={() => saveProviderKey(provider, defaultProviderId === provider.id)}
                                disabled={!isInteractive || !apiKeys[provider.id]?.trim()}
                              >
                                Save key
                              </button>
                              {hasKey && (
                                <button className="setup-inline-action strong" onClick={() => activateExistingProvider(provider)} disabled={!isInteractive}>
                                  Use as default
                                </button>
                              )}
                              {provider.apiKeyUrl && (
                                <a
                                  href={isInteractive ? provider.apiKeyUrl : undefined}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={`setup-provider-link ${!isInteractive ? "disabled" : ""}`}
                                  onClick={(e) => {
                                    if (!isInteractive) e.preventDefault();
                                  }}
                                >
                                  Provider console
                                </a>
                              )}
                            </div>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </div>
            </section>

            <section className="setup-panel">
              <div className="setup-panel-header">
                <span className="setup-panel-step">03</span>
                <div>
                  <h2>Learn the sidebar once</h2>
                  <p>The left rail is compact on purpose. Click any button below to see what it opens and when to use it.</p>
                </div>
              </div>

              <div className="setup-sidebar-tour">
                <div className="setup-sidebar-preview">
                  <div className="setup-sidebar-rail">
                    {sidebarGuideItems.map((item) => (
                      <button
                        key={item.id}
                        className={`setup-sidebar-btn ${activeSidebarItemId === item.id ? "active" : ""}`}
                        onClick={() => setActiveSidebarItemId(item.id)}
                        title={item.label}
                        disabled={!isInteractive}
                      >
                        {item.icon}
                      </button>
                    ))}
                  </div>
                  <p>Pick a control to inspect its role in the layout.</p>
                </div>

                <div className="setup-sidebar-detail">
                  <span className="setup-sidebar-group">{activeSidebarItem.group} rail</span>
                  <h3>{activeSidebarItem.label}</h3>
                  <p className="setup-sidebar-description">{activeSidebarItem.description}</p>
                  <p className="setup-sidebar-detail-copy">{activeSidebarItem.detail}</p>
                </div>
              </div>
            </section>
          </div>

          <div className="setup-screen-footer">
            <div className="setup-footer-copy">
              <strong>You're ready to work.</strong>
              <span>This onboarding fades away after first launch and hands off to the workspace.</span>
            </div>

            <div className="setup-footer-actions">
              {onOpenAdvancedSettings && (
                <button className="setup-secondary-btn" onClick={onOpenAdvancedSettings} disabled={!isInteractive}>
                  Open settings
                </button>
              )}
              <button className="setup-primary-btn" onClick={onClose} disabled={!isInteractive}>
                Finish setup
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className={`setup-loading-screen ${phase === "loading" || phase === "finishing" ? "active" : ""}`}>
        <div className="setup-loading-card">
          <div className="setup-loading-spinner" />
          <span className="setup-loading-label">{loadingMessages[loadingMessageIndex]}</span>
          <p>Preparing your workspace, restoring settings, and bringing the main view online.</p>
          <div className="setup-loading-dots" aria-hidden="true">
            {loadingMessages.map((message, index) => (
              <span key={message} className={index <= loadingMessageIndex ? "active" : ""} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
