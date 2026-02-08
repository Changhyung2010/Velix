import { invoke } from '@tauri-apps/api/core';
import { AIProviderClient, ChatMessage, ChatOptions, AIResponse, ProviderID, PROVIDERS } from './types';
import { ClaudeProvider } from './providers/claude';
import { ChatGPTProvider } from './providers/chatgpt';
import { GeminiProvider } from './providers/gemini';
import { GLM4Provider } from './providers/glm4';

/**
 * AIService provides a unified interface to multiple AI providers.
 * It handles provider selection, API key management, and routing requests.
 */
export class AIService {
    private currentProvider: ProviderID = 'claude';
    private currentModel: string = 'claude-3-5-sonnet-20241022';
    private providerInstances: Map<ProviderID, AIProviderClient> = new Map();

    /**
     * Initialize the service with a specific provider and model
     */
    async initialize(provider: ProviderID, model?: string): Promise<boolean> {
        this.currentProvider = provider;

        const providerConfig = PROVIDERS.find(p => p.id === provider);
        this.currentModel = model || providerConfig?.models[0] || '';

        try {
            const apiKey = await invoke<string>('get_api_key', { provider });
            if (apiKey) {
                this.createProviderInstance(provider, apiKey);
                return true;
            }
        } catch (e) {
            console.warn(`No API key found for ${provider}`);
        }

        return false;
    }

    /**
     * Set the API key for a provider and create the client instance
     */
    async setApiKey(provider: ProviderID, apiKey: string): Promise<void> {
        await invoke('save_api_key', { provider, key: apiKey });
        this.createProviderInstance(provider, apiKey);
    }

    /**
     * Create a provider client instance
     */
    private createProviderInstance(provider: ProviderID, apiKey: string): void {
        let client: AIProviderClient;

        switch (provider) {
            case 'claude':
                client = new ClaudeProvider(apiKey);
                break;
            case 'chatgpt':
                client = new ChatGPTProvider(apiKey);
                break;
            case 'gemini':
                client = new GeminiProvider(apiKey);
                break;
            case 'glm4':
                client = new GLM4Provider(apiKey);
                break;
            default:
                throw new Error(`Unknown provider: ${provider}`);
        }

        this.providerInstances.set(provider, client);
    }

    /**
     * Get the current provider client
     */
    private getClient(): AIProviderClient {
        const client = this.providerInstances.get(this.currentProvider);
        if (!client) {
            throw new Error(`Provider ${this.currentProvider} not initialized. Please set an API key.`);
        }
        return client;
    }

    /**
     * Send a chat message to the current provider
     */
    async chat(messages: ChatMessage[], options?: ChatOptions): Promise<AIResponse> {
        const client = this.getClient();
        return client.chat(messages, { model: this.currentModel, ...options });
    }

    /**
     * Suggest a shell command based on natural language description
     */
    async suggestCommand(description: string): Promise<string> {
        const client = this.getClient();
        return client.suggestCommand(description);
    }

    /**
     * Explain an error and suggest fixes
     */
    async explainError(command: string, error: string): Promise<string> {
        const client = this.getClient();
        return client.explainError(command, error);
    }

    /**
     * Edit a file based on natural language instruction
     */
    async editFile(path: string, content: string, instruction: string): Promise<string> {
        const client = this.getClient();

        const messages: ChatMessage[] = [
            {
                role: 'system',
                content: `You are an expert code editor. You will receive the content of a file and an instruction to modify it.
                Return ONLY the modified file content. Do not include markdown code blocks, backticks, or any explanations.
                Just the raw code.`
            },
            {
                role: 'user',
                content: `File: ${path}\n\nContent:\n${content}\n\nInstruction: ${instruction}`
            }
        ];

        const response = await client.chat(messages);
        let newContent = response.content;

        // Cleanup if model adds markdown blocks despite instructions
        if (newContent.startsWith('```')) {
            const lines = newContent.split('\n');
            if (lines[0].startsWith('```')) lines.shift();
            if (lines[lines.length - 1].startsWith('```')) lines.pop();
            newContent = lines.join('\n');
        }

        return newContent;
    }

    /**
     * Switch to a different provider
     */
    setProvider(provider: ProviderID, model?: string): void {
        this.currentProvider = provider;
        const providerConfig = PROVIDERS.find(p => p.id === provider);
        this.currentModel = model || providerConfig?.models[0] || '';
    }

    /**
     * Get current configuration
     */
    getConfig(): { provider: ProviderID; model: string } {
        return {
            provider: this.currentProvider,
            model: this.currentModel,
        };
    }

    /**
     * Check if a provider is ready (has API key set)
     */
    isProviderReady(provider?: ProviderID): boolean {
        const p = provider || this.currentProvider;
        return this.providerInstances.has(p);
    }

    /**
     * Analyze a code file and return explanation
     */
    async analyzeCode(options: {
        filePath: string;
        code: string;
        imports: string[];
        gitHistory?: string;
        dangerZones?: import('../analysis').DangerZone | null;
        mode?: 'beginner' | 'senior';
    }): Promise<string> {
        const client = this.getClient();

        // Dynamic import to avoid circular dependencies
        const { CODE_ANALYSIS_SYSTEM_PROMPT, buildFileAnalysisPrompt } = await import('./prompts');

        const prompt = buildFileAnalysisPrompt(options);

        const messages: ChatMessage[] = [
            { role: 'system', content: CODE_ANALYSIS_SYSTEM_PROMPT },
            { role: 'user', content: prompt }
        ];

        const response = await client.chat(messages, {
            model: this.currentModel,
            maxTokens: 2000,
            temperature: 0.5
        });

        return response.content;
    }

    /**
     * Analyze a project and return overview
     */
    async analyzeProject(options: {
        projectData: import('../analysis').ProjectData;
        filesContent: Array<{ path: string; content: string; imports: string[] }>;
        mode?: 'beginner' | 'senior';
    }): Promise<string> {
        const client = this.getClient();

        const { buildProjectAnalysisPrompt } = await import('./prompts');

        const prompt = buildProjectAnalysisPrompt(options);

        const messages: ChatMessage[] = [
            {
                role: 'system',
                content: 'You are a senior software architect analyzing code project structures. Provide clear, structured insights about project organization, file relationships, and architecture patterns. Use markdown formatting with headers and lists.'
            },
            { role: 'user', content: prompt }
        ];

        const response = await client.chat(messages, {
            model: this.currentModel,
            maxTokens: 4000,
            temperature: 0.5
        });

        return response.content;
    }

    /**
     * Chat about code with context
     */
    async chatAboutCode(options: {
        question: string;
        filePath?: string;
        fileContent?: string;
        previousAnalysis?: string;
        projectContext?: string;
    }): Promise<string> {
        const client = this.getClient();

        const { CHAT_SYSTEM_PROMPT, buildChatContextPrompt } = await import('./prompts');

        const prompt = buildChatContextPrompt({
            userQuestion: options.question,
            filePath: options.filePath,
            fileContent: options.fileContent,
            previousAnalysis: options.previousAnalysis,
            projectContext: options.projectContext,
        });

        const messages: ChatMessage[] = [
            { role: 'system', content: CHAT_SYSTEM_PROMPT },
            { role: 'user', content: prompt }
        ];

        const response = await client.chat(messages, {
            model: this.currentModel,
            maxTokens: 2000,
            temperature: 0.7
        });

        return response.content;
    }
}

// Export singleton instance
export const aiService = new AIService();
