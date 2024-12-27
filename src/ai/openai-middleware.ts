// openai-middleware.ts
import OpenAI from "openai";
import {s} from "ajv-ts";
import {
    MessageGlobal,
    NetworkError,
    JSONParseError,
    SchemaValidationError,
    ProviderResponse,
    ModelInfo,
    ModelPricing
} from "../models/types";
import { BaseProvider } from "./base-provider";
import { OpenAIProviderConfig } from "./types";
export { OpenAIProviderConfig };

export enum OpenAIModel {
    // Structured Output Models
    GPT4O_LATEST = "gpt-4o",
    GPT4O_MINI = "gpt-4o-mini",

    // JSON Output Models
    GPT4_TURBO = "gpt-4-turbo",
    GPT35_TURBO = "gpt-3.5-turbo",

    // Other Models
    GPT4 = "gpt-4",
}

export const OPENAI_PRICING = {
    [OpenAIModel.GPT4O_LATEST]: {
        input: 0.0025,
        output: 0.01
    },
    [OpenAIModel.GPT4O_MINI]: {
        input: 0.00015,
        output: 0.0006
    },

    [OpenAIModel.GPT4_TURBO]: {
        input: 0.01,
        output: 0.03
    },
    [OpenAIModel.GPT35_TURBO]: {
        input: 0.0005,
        output: 0.0015
    },

    [OpenAIModel.GPT4]: {
        input: 0.03,
        output: 0.06
    },

};

export class OpenAIProvider extends BaseProvider {
    protected client: OpenAI;
    protected config: OpenAIProviderConfig;

    constructor(config: Partial<OpenAIProviderConfig> = {}) {
        super('openai'); // Initialize base provider with name

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
     * Fetch available models from OpenAI API
     */
    protected async fetchModelsFromAPI(): Promise<ModelInfo[]> {
        try {
            const response = await this.client.models.list();
            const apiModels = response.data;

            // Filter for compatible models and transform to ModelInfo
            const compatibleModels = this.filterCompatibleModels(apiModels);

            return compatibleModels.map(model => ({
                id: model.id,
                name: model.id,
                provider: 'openai',
                description: `OpenAI ${model.id}`,
                contextWindow: this.getContextWindow(model.id),
                maxOutput: this.getMaxOutput(model.id),
                pricing: this.getStaticPricing(model.id),
                supportedFeatures: this.getModelFeatures(model.id),
                availability: 'available',
                deprecated: this.isDeprecated(model.id)
            }));

        } catch (error) {
            throw new Error(`Failed to fetch OpenAI models: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get static/fallback model list
     */
    protected getStaticModelList(): ModelInfo[] {
        return Object.values(OpenAIModel).map(model => ({
            id: model,
            name: model,
            provider: 'openai',
            description: `OpenAI ${model}`,
            contextWindow: this.getContextWindow(model),
            maxOutput: this.getMaxOutput(model),
            pricing: this.getStaticPricing(model),
            supportedFeatures: this.getModelFeatures(model),
            availability: 'available',
            deprecated: this.isDeprecated(model)
        }));
    }

    /**
     * Filter models that are compatible with our use case
     */
    protected filterCompatibleModels(models: any[]): any[] {
        return models.filter(model => {
            const modelId = model.id;

            // Include GPT models that support chat completions
            if (modelId.includes('gpt-')) {
                // Include fine-tuned models (ft:gpt-*) and exclude other variants
                return !modelId.includes('instruct') &&
                    !modelId.includes('edit') &&
                    !modelId.includes('code') &&
                    !modelId.includes('davinci') &&
                    !modelId.includes('curie') &&
                    !modelId.includes('babbage') &&
                    !modelId.includes('ada');
            }

            return false;
        });
    }

    /**
     * Get static pricing for known models
     */
    private getStaticPricing(modelId: string): ModelPricing | undefined {
        const pricing = OPENAI_PRICING[modelId as OpenAIModel];
        return pricing ? {
            input: pricing.input,
            output: pricing.output,
            currency: 'USD'
        } : undefined;
    }

    /**
     * Get context window size for models
     */
    private getContextWindow(modelId: string): number | undefined {
        const contextWindows: Record<string, number> = {
            'gpt-4o': 128000,
            'gpt-4o-mini': 128000,
            'gpt-4-turbo': 128000,
            'gpt-4': 8192,
            'gpt-3.5-turbo': 16385
        };
        return contextWindows[modelId];
    }

    /**
     * Get max output tokens for models
     */
    private getMaxOutput(modelId: string): number | undefined {
        const maxOutputs: Record<string, number> = {
            'gpt-4o': 16384,
            'gpt-4o-mini': 16384,
            'gpt-4-turbo': 4096,
            'gpt-4': 4096,
            'gpt-3.5-turbo': 4096
        };
        return maxOutputs[modelId];
    }

    /**
     * Get supported features for models
     */
    private getModelFeatures(modelId: string): string[] {
        const features = ['chat', 'json_mode'];

        if (this.isStructuredOutputModel(modelId)) {
            features.push('structured_output');
        }

        if (modelId.includes('gpt-4')) {
            features.push('function_calling');
        }

        if (this.isFineTuningSupported(modelId)) {
            features.push('fine_tuning');
        }

        return features;
    }

    /**
     * Check if model supports fine-tuning
     */
    private isFineTuningSupported(modelId: string): boolean {
        const supportedModels = [
            // GPT-4.1
            'gpt-4.1-nano-2025-04-14',
            'gpt-4.1-mini-2025-04-14',
            'gpt-4.1-2025-04-14',
            // GPT-4o
            'gpt-4o-mini-2024-07-18',
            'gpt-4o-2024-08-06',
            // GPT-3.5
            'gpt-3.5-turbo-1106',
            'gpt-3.5-turbo-0125',
        ];

        return supportedModels.includes(modelId);
    }

    /**
     * Check if model is deprecated
     */
    private isDeprecated(modelId: string): boolean {
        const deprecatedModels = ['gpt-4', 'gpt-3.5-turbo'];
        return deprecatedModels.includes(modelId);
    }

    protected isStructuredOutputModel(model: string): boolean {
        return [
            OpenAIModel.GPT4O_MINI,
            OpenAIModel.GPT4O_LATEST,
        ].includes(model as OpenAIModel);
    }

    protected isJSONOutputModel(model: string): boolean {
        return [
            OpenAIModel.GPT4_TURBO,
            OpenAIModel.GPT35_TURBO
        ].includes(model as OpenAIModel);
    }

    protected calculateCost(model: string, promptTokens: number, completionTokens: number): number {
        const pricing = OPENAI_PRICING[model as OpenAIModel];

        if (!pricing) {
            throw new Error(`No pricing configuration found for model: ${model}`);
        }

        const inputCost = (promptTokens / 1000) * pricing.input;
        const outputCost = (completionTokens / 1000) * pricing.output;

        return Number((inputCost + outputCost).toFixed(6));
    }

    async run<T>(
        model: string,
        prompt: MessageGlobal[],
        schema: s.Object | undefined,
        text: string
    ): Promise<ProviderResponse> {
        const startTime = performance.now();

        try {
            let result: T;
            let usage: { prompt_tokens: number; completion_tokens: number; };
            let isStructured = false;

            if (schema && this.isStructuredOutputModel(model)) {
                const completion = await this.handleStructuredOutput(model, prompt, schema, text);
                result = completion.data;
                usage = completion.usage;
                isStructured = true;
            } else if (schema) {
                const completion = await this.handleJSONOutput(model, prompt, schema, text);
                result = completion.data;
                usage = completion.usage;
                isStructured = true;
            } else {
                const completion = await this.handlePlainTextOutput(model, prompt, text);
                result = completion.data;
                usage = completion.usage;
                isStructured = false;
            }

            const endTime = performance.now();
            const timeElapsed = endTime - startTime;

            const estimatedCost = this.calculateCost(
                model,
                usage.prompt_tokens,
                usage.completion_tokens
            );

            return {
                data: result,
                metrics: {
                    timeElapsed,
                    estimatedCost,
                    totalTokens: usage.prompt_tokens + usage.completion_tokens,
                    promptTokens: usage.prompt_tokens,
                    completionTokens: usage.completion_tokens,
                },
                isStructured
            };
        } catch (error) {
            throw error;
        }
    }

    private async handlePlainTextOutput(
        model: string,
        prompt: MessageGlobal[],
        text: string
    ): Promise<{ data: any; usage: { prompt_tokens: number; completion_tokens: number; } }> {
        const initialMessages = prompt.map((message) => {
            return message as OpenAI.Chat.ChatCompletionMessageParam;
        });

        const completion = await this.client.chat.completions.create({
            model: model,
            messages: [
                ...initialMessages,
                { role: "user", content: text },
            ],
            temperature: this.config.temperature,
            max_tokens: this.config.maxTokens,
            top_p: this.config.topP,
            presence_penalty: this.config.presencePenalty,
            frequency_penalty: this.config.frequencyPenalty,
            seed: this.config.seed,
        }).catch(error => {
            throw new NetworkError(
                `Failed to make API request: ${error.message}`,
                error
            );
        });

        const responseBody = completion.choices[0].message.content || "";

        return {
            data: responseBody,
            usage: {
                prompt_tokens: completion.usage?.prompt_tokens || 0,
                completion_tokens: completion.usage?.completion_tokens || 0
            }
        };
    }

    private async handleStructuredOutput(
        model: string,
        prompt: MessageGlobal[],
        schema: s.Object,
        text: string
    ): Promise<{ data: any; usage: { prompt_tokens: number; completion_tokens: number; } }> {
        const initialMessages = prompt.map((message) => {
            return message as OpenAI.Chat.ChatCompletionMessageParam;
        });

        const completion = await this.client.beta.chat.completions.parse({
            model: model,
            messages: [
                ...initialMessages,
                { role: "user", content: text },
            ],
            response_format: {
                type: "json_schema",
                json_schema: {
                    name: "output",
                    schema: schema.schema,
                    strict: true
                }
            },
            temperature: this.config.temperature,
            max_tokens: this.config.maxTokens,
            top_p: this.config.topP,
            presence_penalty: this.config.presencePenalty,
            frequency_penalty: this.config.frequencyPenalty,
            seed: this.config.seed,
        });

        const parsed = completion.choices[0].message.parsed;
        if (!parsed) {
            throw Error(`Error on structured output of open AI`);
        }

        return {
            data: parsed,
            usage: {
                prompt_tokens: completion.usage?.prompt_tokens || 0,
                completion_tokens: completion.usage?.completion_tokens || 0
            }
        };
    }

    private async handleJSONOutput(
        model: string,
        prompt: MessageGlobal[],
        schema: s.Object,
        text: string
    ): Promise<{ data: any; usage: { prompt_tokens: number; completion_tokens: number; } }> {
        const initialMessages = prompt.map((message) => {
            return message as OpenAI.Chat.ChatCompletionMessageParam;
        });

        const completion = await this.client.chat.completions.create({
            model: model,
            messages: [
                ...initialMessages,
                { role: "user", content: text },
            ],
            ...(this.isJSONOutputModel(model) && {
                response_format: { type: "json_object" }
            }),
            temperature: this.config.temperature,
            max_tokens: this.config.maxTokens,
            top_p: this.config.topP,
            presence_penalty: this.config.presencePenalty,
            frequency_penalty: this.config.frequencyPenalty,
            seed: this.config.seed,
        }).catch(error => {
            throw new NetworkError(
                `Failed to make API request: ${error.message}`,
                error
            );
        });

        const responseBody = completion.choices[0].message.content || "{}";
        let jsonResponse;
        try {
            jsonResponse = JSON.parse(responseBody);
        } catch (error) {
            throw new JSONParseError(
                `Failed to parse JSON response: ${error instanceof Error ? error.message : 'Unknown error'}`,
                error instanceof Error ? error : new Error('Unknown error'),
                responseBody
            );
        }

        let validatedData;
        try {
            validatedData = schema.parse(jsonResponse);
        } catch (error) {
            throw new SchemaValidationError(
                `Failed to validate schema: ${error instanceof Error ? error.message : 'Unknown error'}`,
                error instanceof Error ? error : new Error('Unknown error'),
                jsonResponse
            );
        }

        return {
            data: validatedData,
            usage: {
                prompt_tokens: completion.usage?.prompt_tokens || 0,
                completion_tokens: completion.usage?.completion_tokens || 0
            }
        };
    }
}
