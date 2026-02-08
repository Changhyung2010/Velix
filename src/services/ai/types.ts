// AI Provider types and interfaces

export type ProviderID = 'claude' | 'chatgpt' | 'gemini' | 'glm4';

export interface AIProvider {
    id: ProviderID;
    name: string;
    models: string[];
}

export interface AIConfig {
    provider: ProviderID;
    model: string;
    apiKey: string;
}

export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

export interface AIResponse {
    content: string;
    model: string;
    provider: ProviderID;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}

export interface AIProviderClient {
    id: ProviderID;
    chat(messages: ChatMessage[], options?: ChatOptions): Promise<AIResponse>;
    suggestCommand(description: string): Promise<string>;
    explainError(command: string, error: string): Promise<string>;
}

export interface ChatOptions {
    model?: string;
    maxTokens?: number;
    temperature?: number;
}

export const PROVIDERS: AIProvider[] = [
    {
        id: 'claude',
        name: 'Claude (Anthropic)',
        models: ['claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307', 'claude-3-opus-20240229'],
    },
    {
        id: 'chatgpt',
        name: 'ChatGPT (OpenAI)',
        models: ['gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    },
    {
        id: 'gemini',
        name: 'Gemini (Google)',
        models: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-pro'],
    },
    {
        id: 'glm4',
        name: 'GLM-4 (Zhipu AI)',
        models: ['glm-4', 'glm-4-flash', 'glm-4-air'],
    },
];
