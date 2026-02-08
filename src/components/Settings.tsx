import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./Settings.css";

interface AIProvider {
    id: "claude" | "chatgpt" | "gemini" | "glm4";
    name: string;
    models: string[];
    placeholder: string;
}

export const AI_PROVIDERS: AIProvider[] = [
    {
        id: "claude",
        name: "Claude (Anthropic)",
        models: ["claude-3-5-sonnet-20241022", "claude-3-haiku-20240307", "claude-3-opus-20240229"],
        placeholder: "sk-ant-..."
    },
    {
        id: "chatgpt",
        name: "ChatGPT (OpenAI)",
        models: ["gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"],
        placeholder: "sk-..."
    },
    {
        id: "gemini",
        name: "Gemini (Google)",
        models: ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-pro"],
        placeholder: "AIza..."
    },
    {
        id: "glm4",
        name: "GLM-4 (Zhipu AI)",
        models: ["glm-4", "glm-4-flash", "glm-4-air"],
        placeholder: "..."
    }
];

interface SettingsProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (config: AIConfig) => void;
    currentConfig: AIConfig | null;
}

export interface AIConfig {
    provider: AIProvider["id"];
    model: string;
    apiKey: string;
}

export function Settings({ isOpen, onClose, onSave, currentConfig }: SettingsProps) {
    const [activeTab, setActiveTab] = useState<"providers" | "about">("providers");
    const [selectedProvider, setSelectedProvider] = useState<AIProvider["id"]>(currentConfig?.provider || "claude");
    const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
    const [selectedModels, setSelectedModels] = useState<Record<string, string>>({});
    const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});

    useEffect(() => {
        loadApiKeys();
    }, []);

    const loadApiKeys = async () => {
        for (const provider of AI_PROVIDERS) {
            try {
                const key = await invoke<string>("get_api_key", { provider: provider.id });
                if (key) {
                    setApiKeys(prev => ({ ...prev, [provider.id]: key }));
                }
            } catch (e) {
                // Key not found
            }
        }
    };

    const handleSaveKey = async (providerId: string, key: string) => {
        try {
            await invoke("save_api_key", { provider: providerId, key });
            setApiKeys(prev => ({ ...prev, [providerId]: key }));
        } catch (e) {
            console.error("Failed to save API key:", e);
        }
    };

    const handleSelectProvider = (providerId: AIProvider["id"]) => {
        setSelectedProvider(providerId);
        const provider = AI_PROVIDERS.find(p => p.id === providerId);
        const model = selectedModels[providerId] || provider?.models[0] || "";
        const apiKey = apiKeys[providerId] || "";

        onSave({ provider: providerId, model, apiKey });
    };

    const handleModelChange = (providerId: string, model: string) => {
        setSelectedModels(prev => ({ ...prev, [providerId]: model }));
        if (providerId === selectedProvider) {
            onSave({ provider: selectedProvider, model, apiKey: apiKeys[providerId] || "" });
        }
    };

    if (!isOpen) return null;

    return (
        <div className="settings-overlay" onClick={onClose}>
            <div className="settings-modal" onClick={e => e.stopPropagation()}>
                <div className="settings-header">
                    <h2>Settings</h2>
                    <button className="close-btn" onClick={onClose}>x</button>
                </div>

                <div className="settings-layout">
                    <nav className="settings-nav">
                        <button
                            className={`nav-item ${activeTab === "providers" ? "active" : ""}`}
                            onClick={() => setActiveTab("providers")}
                        >
                            AI Providers
                        </button>
                        <button
                            className={`nav-item ${activeTab === "about" ? "active" : ""}`}
                            onClick={() => setActiveTab("about")}
                        >
                            About
                        </button>
                    </nav>

                    <div className="settings-content">
                        {activeTab === "providers" && (
                            <div className="providers-tab">
                                <p className="settings-description">
                                    Configure your AI provider. Enter your API key to enable AI features.
                                </p>

                                {AI_PROVIDERS.map(provider => (
                                    <div
                                        key={provider.id}
                                        className={`provider-card ${selectedProvider === provider.id ? "active" : ""}`}
                                    >
                                        <div className="provider-header">
                                            <label className="provider-select">
                                                <input
                                                    type="radio"
                                                    name="provider"
                                                    checked={selectedProvider === provider.id}
                                                    onChange={() => handleSelectProvider(provider.id)}
                                                />
                                                <span className="provider-name">{provider.name}</span>
                                            </label>
                                            {selectedProvider === provider.id && (
                                                <span className="active-badge">Active</span>
                                            )}
                                        </div>

                                        <div className="provider-config">
                                            <div className="input-group">
                                                <label>API Key</label>
                                                <div className="key-input-wrapper">
                                                    <input
                                                        type={showKeys[provider.id] ? "text" : "password"}
                                                        placeholder={provider.placeholder}
                                                        value={apiKeys[provider.id] || ""}
                                                        onChange={e => setApiKeys(prev => ({ ...prev, [provider.id]: e.target.value }))}
                                                        onBlur={e => handleSaveKey(provider.id, e.target.value)}
                                                    />
                                                    <button
                                                        className="toggle-visibility"
                                                        onClick={() => setShowKeys(prev => ({ ...prev, [provider.id]: !prev[provider.id] }))}
                                                    >
                                                        {showKeys[provider.id] ? "Hide" : "Show"}
                                                    </button>
                                                </div>
                                            </div>

                                            <div className="input-group">
                                                <label>Model</label>
                                                <select
                                                    value={selectedModels[provider.id] || provider.models[0]}
                                                    onChange={e => handleModelChange(provider.id, e.target.value)}
                                                >
                                                    {provider.models.map(model => (
                                                        <option key={model} value={model}>{model}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {activeTab === "about" && (
                            <div className="about-tab">
                                <h3>Velix</h3>
                                <p>AI-Native Developer Terminal</p>
                                <p className="version">Version 0.1.0</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
