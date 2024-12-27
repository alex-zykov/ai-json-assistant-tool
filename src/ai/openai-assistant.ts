// src/ai/openai-assistant.ts

import OpenAI from "openai";
import chalk from 'chalk';
import { s } from "ajv-ts";
import { OpenAIProviderConfig } from "./types";

export interface AssistantOptions {
    model: string;
    name: string;
    schema?: s.Object;
    basePrompt: string;
}

export interface Assistant {
    id: string;
    name?: string;
    model: string;
    instructions?: string;
}

export interface ThreadResult {
    threadId: string;
    assistantResponse: string;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

export class OpenAIAssistantService {
    private client: OpenAI;
    private config: OpenAIProviderConfig;

    constructor(config: Partial<OpenAIProviderConfig> = {}) {
        // Load from environment variables with fallbacks
        const envConfig = {
            apiKey: process.env.OPENAI_API_KEY,
            baseUrl: process.env.OPENAI_BASE_URL,
            temperature: process.env.OPENAI_TEMPERATURE ? parseFloat(process.env.OPENAI_TEMPERATURE) : undefined,
            maxTokens: process.env.OPENAI_MAX_TOKENS ? parseInt(process.env.OPENAI_MAX_TOKENS) : undefined,
            topP: process.env.OPENAI_TOP_P ? parseFloat(process.env.OPENAI_TOP_P) : undefined,
            presencePenalty: process.env.OPENAI_PRESENCE_PENALTY ? parseFloat(process.env.OPENAI_PRESENCE_PENALTY) : undefined,
            frequencyPenalty: process.env.OPENAI_FREQUENCY_PENALTY ? parseFloat(process.env.OPENAI_FREQUENCY_PENALTY) : undefined,
            seed: process.env.OPENAI_SEED ? parseInt(process.env.OPENAI_SEED) : undefined,
            organizationId: process.env.OPENAI_ORGANIZATION_ID,
            projectId: process.env.OPENAI_PROJECT_ID,
        };

        // Remove undefined values
        const cleanEnvConfig = Object.fromEntries(
            Object.entries(envConfig).filter(([_, value]) => value !== undefined && value !== '')
        );

        this.config = OpenAIProviderConfig.parse({
            ...cleanEnvConfig,
            ...config // Allow overrides from constructor
        });

        if (!this.config.apiKey) {
            throw new Error('OPENAI_API_KEY environment variable is required');
        }

        this.client = new OpenAI({
            apiKey: this.config.apiKey,
            baseURL: this.config.baseUrl || "https://api.openai.com/v1",
            organization: this.config.organizationId,
            project: this.config.projectId,
        });
    }

    /**
     * Create a new assistant
     */
    async createAssistant(options: AssistantOptions): Promise<Assistant> {
        try {
            const assistant = await this.client.beta.assistants.create({
                model: options.model,
                name: options.name,
                instructions: options.basePrompt,
                temperature: this.config.temperature,
                top_p: this.config.topP,
                ...(options.schema && {
                    response_format: {
                        type: "json_schema",
                        json_schema: {
                            name: "output",
                            schema: options.schema.schema,
                            strict: true
                        }
                    }
                }),
            });

            return this.transformAssistant(assistant);
        } catch (error) {
            throw new Error(`Failed to create assistant: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Retrieve an assistant by ID
     */
    async getAssistant(assistantId: string): Promise<Assistant> {
        try {
            const assistant = await this.client.beta.assistants.retrieve(assistantId);
            return this.transformAssistant(assistant);
        } catch (error) {
            throw new Error(`Failed to get assistant: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Update an existing assistant
     */
    async updateAssistant(assistantId: string, options: Partial<AssistantOptions>): Promise<Assistant> {
        try {
            const updateData: any = {};

            if (options.model) updateData.model = options.model;
            if (options.name) updateData.name = options.name;
            if (options.basePrompt) updateData.instructions = options.basePrompt;
            if (options.schema) {
                updateData.response_format = {
                    type: "json_schema",
                    json_schema: {
                        name: "output",
                        schema: options.schema.schema,
                        strict: true
                    }
                };
            }

            const assistant = await this.client.beta.assistants.update(assistantId, updateData);

            return this.transformAssistant(assistant);
        } catch (error) {
            throw new Error(`Failed to update assistant: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Delete an assistant
     */
    async deleteAssistant(assistantId: string): Promise<void> {
        try {
            await this.client.beta.assistants.del(assistantId);
        } catch (error) {
            throw new Error(`Failed to delete assistant: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * List assistants
     */
    async listAssistants(limit: number = 20, order: "asc" | "desc" = "desc"): Promise<Assistant[]> {
        try {
            const response = await this.client.beta.assistants.list({
                limit,
                order,
            });

            return response.data.map(assistant => this.transformAssistant(assistant));
        } catch (error) {
            throw new Error(`Failed to list assistants: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Start a new thread with user instructions and message, wait for completion
     */
    async startThread(
        assistantId: string,
        userInstructions: string,
        userMessage: string
    ): Promise<ThreadResult> {
        try {
            // Create and run thread in one request
            const run = await this.client.beta.threads.createAndRun({
                assistant_id: assistantId,
                thread: {
                    messages: [{ role: "user", content: userMessage }]
                },
                instructions: userInstructions,
            });

            // Wait for completion
            const completedRun = await this.waitForCompletion(run.thread_id, run.id);
            
            // Get the assistant's response
            const assistantResponse = await this.getLatestAssistantMessage(run.thread_id);

            return {
                threadId: run.thread_id,
                assistantResponse,
                usage: completedRun.usage,
            };
        } catch (error) {
            throw new Error(`Failed to start thread: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Follow up on existing thread with new user message
     */
    async followUp(
        assistantId: string,
        threadId: string,
        followUpUserMessage: string
    ): Promise<ThreadResult> {
        try {
            // Add user message to existing thread
            await this.client.beta.threads.messages.create(threadId, {
                role: "user",
                content: followUpUserMessage,
            });

            // Create run for existing thread
            const run = await this.client.beta.threads.runs.create(threadId, {
                assistant_id: assistantId,
            });

            // Wait for completion
            const completedRun = await this.waitForCompletion(threadId, run.id);
            
            // Get the assistant's response
            const assistantResponse = await this.getLatestAssistantMessage(threadId);

            return {
                threadId,
                assistantResponse,
                usage: completedRun.usage,
            };
        } catch (error) {
            throw new Error(`Failed to follow up: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Clean up stale threads (older than specified hours)
     * Note: This is a simplified implementation that deletes threads by ID
     */
    async clean(threadIds: string[]): Promise<number> {
        try {
            let deletedCount = 0;

            for (const threadId of threadIds) {
                try {
                    await this.client.beta.threads.del(threadId);
                    deletedCount++;
                } catch (deleteError) {
                    // Log error but continue with other threads
                    console.warn(`Failed to delete thread ${threadId}:`, deleteError);
                }
            }

            return deletedCount;
        } catch (error) {
            throw new Error(`Failed to clean threads: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }



    /**
     * Get color for run status display
     */
    private getRunStatusColor(status: string) {
        switch (status) {
            case 'completed': return chalk.green;
            case 'failed':
            case 'cancelled':
            case 'expired': return chalk.red;
            case 'in_progress': return chalk.blue;
            case 'queued': return chalk.yellow;
            default: return chalk.gray;
        }
    }

    /**
     * Transform OpenAI Assistant response to our interface
     */
    private transformAssistant(assistant: any): Assistant {
        return {
            id: assistant.id,
            name: assistant.name,
            model: assistant.model,
            instructions: assistant.instructions,
        };
    }

    /**
     * Wait for a run to complete with polling
     */
    private async waitForCompletion(
        threadId: string,
        runId: string,
        pollIntervalMs: number = 1000,
        maxWaitMs: number = 300000 // 5 minutes
    ): Promise<any> {
        const startTime = Date.now();
        let lastStatus = '';

        while (Date.now() - startTime < maxWaitMs) {
            const run = await this.client.beta.threads.runs.retrieve(threadId, runId);

            // Show status updates
            if (run.status !== lastStatus) {
                const elapsed = Math.round((Date.now() - startTime) / 1000);
                console.log(chalk.blue(`[${elapsed}s]`), chalk.cyan('Run Status:'), this.getRunStatusColor(run.status)(run.status));
                lastStatus = run.status;
            }

            // Check if run is complete
            if (['completed', 'failed', 'cancelled', 'expired'].includes(run.status)) {
                if (run.status === 'failed') {
                    throw new Error(`Run failed: ${run.last_error?.message || 'Unknown error'}`);
                }
                if (run.status === 'cancelled' || run.status === 'expired') {
                    throw new Error(`Run ${run.status}`);
                }
                return run;
            }

            // Wait before next poll
            await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
        }

        throw new Error(`Run did not complete within ${maxWaitMs}ms`);
    }

    /**
     * Get the latest assistant message from a thread
     */
    private async getLatestAssistantMessage(threadId: string): Promise<string> {
        try {
            const messages = await this.client.beta.threads.messages.list(threadId, {
                limit: 10,
                order: 'desc'
            });

            // Find the most recent assistant message
            const assistantMessage = messages.data.find(msg => msg.role === 'assistant');
            if (!assistantMessage) {
                throw new Error('No assistant response found');
            }

            // Extract text content from the message
            const textContent = assistantMessage.content?.find((c: any) => c.type === 'text');
            if (!textContent || !('text' in textContent) || !textContent.text?.value) {
                throw new Error('No text content found in assistant response');
            }

            return textContent.text.value;
        } catch (error) {
            throw new Error(`Failed to get assistant response: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }


    /**
     * Validate that a model supports assistants (including fine-tuned models)
     */
    isValidAssistantModel(model: string): boolean {
        const supportedModels = [
            'gpt-4o',
            'gpt-4o-mini',
            'gpt-4-turbo',
            'gpt-4',
            'gpt-3.5-turbo',
        ];

        // Check if it's a fine-tuned model (starts with 'ft:')
        if (model.startsWith('ft:')) {
            // Extract base model from fine-tuned model ID
            // Format: ft:gpt-3.5-turbo-0125:org-id:suffix:job-id
            const parts = model.split(':');
            if (parts.length >= 2) {
                const baseModel = parts[1];
                return supportedModels.some(supportedModel => baseModel.includes(supportedModel));
            }
            return false;
        }

        // Check regular models
        return supportedModels.some(supportedModel => model.includes(supportedModel));
    }

    /**
     * Get estimated cost for assistant usage
     */
    getEstimatedCost(usage: { prompt_tokens: number; completion_tokens: number }, model: string): number {
        // Use the same pricing structure as the main OpenAI provider
        const pricing: Record<string, { input: number; output: number }> = {
            'gpt-4o': { input: 0.0025, output: 0.01 },
            'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
            'gpt-4-turbo': { input: 0.01, output: 0.03 },
            'gpt-4': { input: 0.03, output: 0.06 },
            'gpt-3.5-turbo': { input: 0.0015, output: 0.002 },
        };

        const modelPricing = pricing[model] || pricing['gpt-4o-mini']; // fallback to cheapest
        const inputCost = (usage.prompt_tokens / 1000) * modelPricing.input;
        const outputCost = (usage.completion_tokens / 1000) * modelPricing.output;

        return Number((inputCost + outputCost).toFixed(6));
    }
}
