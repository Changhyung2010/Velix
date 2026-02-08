import { AIProviderClient, ChatMessage, ChatOptions, AIResponse, ProviderID } from '../types';

export class ClaudeProvider implements AIProviderClient {
    id: ProviderID = 'claude';
    private apiKey: string;
    private baseUrl = 'https://api.anthropic.com/v1';

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    async chat(messages: ChatMessage[], options?: ChatOptions): Promise<AIResponse> {
        const model = options?.model || 'claude-3-5-sonnet-20241022';

        const response = await fetch(`${this.baseUrl}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model,
                max_tokens: options?.maxTokens || 1024,
                messages: messages.map(m => ({
                    role: m.role === 'system' ? 'user' : m.role,
                    content: m.content,
                })),
            }),
        });

        if (!response.ok) {
            throw new Error(`Claude API error: ${response.status}`);
        }

        const data = await response.json();

        return {
            content: data.content[0]?.text || '',
            model,
            provider: 'claude',
            usage: {
                promptTokens: data.usage?.input_tokens || 0,
                completionTokens: data.usage?.output_tokens || 0,
                totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
            },
        };
    }

    async suggestCommand(description: string): Promise<string> {
        const response = await this.chat([
            {
                role: 'system',
                content: 'You are a terminal command expert. Given a description, suggest the most appropriate shell command. Reply with ONLY the command, no explanation.',
            },
            {
                role: 'user',
                content: description,
            },
        ]);
        return response.content.trim();
    }

    async explainError(command: string, error: string): Promise<string> {
        const response = await this.chat([
            {
                role: 'system',
                content: 'You are a helpful terminal assistant. Explain errors concisely and suggest fixes.',
            },
            {
                role: 'user',
                content: `Command: ${command}\n\nError:\n${error}\n\nWhat went wrong and how can I fix it?`,
            },
        ]);
        return response.content;
    }
}
