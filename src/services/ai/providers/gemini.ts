import { AIProviderClient, ChatMessage, ChatOptions, AIResponse, ProviderID } from '../types';

export class GeminiProvider implements AIProviderClient {
    id: ProviderID = 'gemini';
    private apiKey: string;
    private baseUrl = 'https://generativelanguage.googleapis.com/v1beta';

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    async chat(messages: ChatMessage[], options?: ChatOptions): Promise<AIResponse> {
        const model = options?.model || 'gemini-1.5-flash';

        // Convert messages to Gemini format
        const contents = messages.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
        }));

        const response = await fetch(
            `${this.baseUrl}/models/${model}:generateContent?key=${this.apiKey}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    contents,
                    generationConfig: {
                        maxOutputTokens: options?.maxTokens || 1024,
                        temperature: options?.temperature || 0.7,
                    },
                }),
            }
        );

        if (!response.ok) {
            throw new Error(`Gemini API error: ${response.status}`);
        }

        const data = await response.json();

        return {
            content: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
            model,
            provider: 'gemini',
            usage: {
                promptTokens: data.usageMetadata?.promptTokenCount || 0,
                completionTokens: data.usageMetadata?.candidatesTokenCount || 0,
                totalTokens: data.usageMetadata?.totalTokenCount || 0,
            },
        };
    }

    async suggestCommand(description: string): Promise<string> {
        const response = await this.chat([
            {
                role: 'user',
                content: `You are a terminal command expert. Given this description, suggest the most appropriate shell command. Reply with ONLY the command, no explanation.\n\nDescription: ${description}`,
            },
        ]);
        return response.content.trim();
    }

    async explainError(command: string, error: string): Promise<string> {
        const response = await this.chat([
            {
                role: 'user',
                content: `You are a helpful terminal assistant. Explain this error concisely and suggest fixes.\n\nCommand: ${command}\n\nError:\n${error}\n\nWhat went wrong and how can I fix it?`,
            },
        ]);
        return response.content;
    }
}
