import { AIProviderClient, ChatMessage, ChatOptions, AIResponse, ProviderID } from '../types';

export class GLM4Provider implements AIProviderClient {
    id: ProviderID = 'glm4';
    private apiKey: string;
    private baseUrl = 'https://open.bigmodel.cn/api/paas/v4';

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    async chat(messages: ChatMessage[], options?: ChatOptions): Promise<AIResponse> {
        const model = options?.model || 'glm-4';

        const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
                model,
                max_tokens: options?.maxTokens || 1024,
                temperature: options?.temperature || 0.7,
                messages: messages.map(m => ({
                    role: m.role,
                    content: m.content,
                })),
            }),
        });

        if (!response.ok) {
            throw new Error(`GLM-4 API error: ${response.status}`);
        }

        const data = await response.json();

        return {
            content: data.choices?.[0]?.message?.content || '',
            model,
            provider: 'glm4',
            usage: {
                promptTokens: data.usage?.prompt_tokens || 0,
                completionTokens: data.usage?.completion_tokens || 0,
                totalTokens: data.usage?.total_tokens || 0,
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
