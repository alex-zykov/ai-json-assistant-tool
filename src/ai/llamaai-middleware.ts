import { OpenAIProvider, OpenAIProviderConfig } from "./openai-middleware";
import { s } from "ajv-ts";
import {InvalidModelError, MessageGlobal, ProviderResponse, ModelInfo, ModelPricing} from "../models/types";
import { BaseProvider } from "./base-provider";

// Cost per 1000 tokens in USD
export enum LLamaAIModel {
    // Llama 3.2
    LLAMA_3_2_90B_VISION = "llama3.2-90b-vision",
    LLAMA_3_2_11B_VISION = "llama3.2-11b-vision",
    LLAMA_3_2_3B = "llama3.2-3b",
    LLAMA_3_2_1B = "llama3.2-1b",

    // Llama 3.1 Models
    LLAMA_3_1_405B = "llama3.1-405b",
    LLAMA_3_1_70B = "llama3.1-70b",
    LLAMA_3_1_8B = "llama3.1-8b",

    // Gemma 2 Models
    GEMMA_2_27B = "gemma2-27b",
    GEMMA_2_9B = "gemma2-9b",

}

interface ModelPricingData {
    input: number;
    output: number;
}

type LlamaPricingConfig = {
    [key in LLamaAIModel]: ModelPricingData;
};

export const LLAMA_PRICING: { [key in LLamaAIModel]: ModelPricingData } = {
    // Llama 3.2 Models
    [LLamaAIModel.LLAMA_3_2_90B_VISION]: {
        input: 0.0028,
        output: 0.0028
    },
    [LLamaAIModel.LLAMA_3_2_11B_VISION]: {
        input: 0.0004,
        output: 0.0004
    },
    [LLamaAIModel.LLAMA_3_2_3B]: {
        input: 0.0004,
        output: 0.0004
    },
    [LLamaAIModel.LLAMA_3_2_1B]: {
        input: 0.0004,
        output: 0.0004
    },

    // Llama 3.1 Models
    [LLamaAIModel.LLAMA_3_1_405B]: {
        input: 0.0036,
        output: 0.0036
    },
    [LLamaAIModel.LLAMA_3_1_70B]: {
        input: 0.0028,
        output: 0.0028
    },
    [LLamaAIModel.LLAMA_3_1_8B]: {
        input: 0.0004,
        output: 0.0004
    },

    // Gemma 2 Models
    [LLamaAIModel.GEMMA_2_27B]: {
        input: 0.0016,
        output: 0.0016
    },
    [LLamaAIModel.GEMMA_2_9B]: {
        input: 0.0004,
        output: 0.0004
    },

};

export class LLamaAIProvider extends BaseProvider {
    protected client: any; // OpenAI-compatible client
    protected config: OpenAIProviderConfig;

    constructor(config: Partial<OpenAIProviderConfig> = {}) {
        super('llamaai'); // Initialize base provider with name

        // Load LlamaAI-specific environment variables
        const envConfig = {
            apiKey: process.env.LLAMAAI_API_KEY,
            baseUrl: process.env.LLAMAAI_BASE_URL || "https://api.llama-api.com",
            temperature: process.env.LLAMAAI_TEMPERATURE ? parseFloat(process.env.LLAMAAI_TEMPERATURE) : undefined,
            maxTokens: process.env.LLAMAAI_MAX_TOKENS ? parseInt(process.env.LLAMAAI_MAX_TOKENS) : undefined,
            topP: process.env.LLAMAAI_TOP_P ? parseFloat(process.env.LLAMAAI_TOP_P) : undefined,
            presencePenalty: process.env.LLAMAAI_PRESENCE_PENALTY ? parseFloat(process.env.LLAMAAI_PRESENCE_PENALTY) : undefined,
            frequencyPenalty: process.env.LLAMAAI_FREQUENCY_PENALTY ? parseFloat(process.env.LLAMAAI_FREQUENCY_PENALTY) : undefined,
            seed: process.env.LLAMAAI_SEED ? parseInt(process.env.LLAMAAI_SEED) : undefined,
            organizationId: process.env.LLAMAAI_ORGANIZATION_ID,
            projectId: process.env.LLAMAAI_PROJECT_ID,
        };

        const cleanEnvConfig = Object.fromEntries(
            Object.entries(envConfig).filter(([_, value]) => value !== undefined && value !== '')
        );

        if (!envConfig.apiKey) {
            throw new Error('LLAMAAI_API_KEY environment variable is required');
        }

        this.config = {
            ...cleanEnvConfig,
            ...config
        } as OpenAIProviderConfig;

        // Create OpenAI-compatible client for LlamaAI
        const OpenAI = require('openai');
        this.client = new OpenAI.OpenAI({
            apiKey: this.config.apiKey,
            baseURL: this.config.baseUrl,
        });
    }

    /**
     * Fetch available models from LlamaAI API
     * Note: LlamaAI doesn't have a reliable models endpoint,
     * so we use static models with enhanced metadata
     */
    protected async fetchModelsFromAPI(): Promise<ModelInfo[]> {
        try {
            // Try to make a test request to validate API key and get any dynamic info
            // Since LlamaAI doesn't have a reliable /models endpoint, we'll return our enhanced static list
            await this.validateAPIConnection();
            return this.getEnhancedStaticModelList();
        } catch (error) {
            throw new Error(`Failed to validate LlamaAI API connection: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get static/fallback model list
     */
    protected getStaticModelList(): ModelInfo[] {
        return Object.values(LLamaAIModel).map(model => ({
            id: model,
            name: this.getModelDisplayName(model),
            provider: 'llamaai',
            description: this.getModelDescription(model),
            contextWindow: this.getContextWindow(model),
            maxOutput: this.getMaxOutput(model),
            pricing: this.getStaticPricing(model),
            supportedFeatures: this.getModelFeatures(model),
            availability: 'available',
            deprecated: this.isDeprecated(model)
        }));
    }

    /**
     * Validate API connection by making a minimal request
     */
    private async validateAPIConnection(): Promise<void> {
        try {
            // Make a minimal request to validate the API key
            await this.client.chat.completions.create({
                model: LLamaAIModel.LLAMA_3_2_1B, // Use smallest/cheapest model for validation
                messages: [{ role: "user", content: "test" }],
                max_tokens: 1,
                temperature: 0
            });
        } catch (error) {
            // If it's an API key error, throw it. Otherwise, assume the API is working
            if (error instanceof Error && (error.message.includes('authentication') || error.message.includes('unauthorized'))) {
                throw error;
            }
            // Other errors (like rate limits) don't necessarily mean the API key is invalid
        }
    }

    /**
     * Get enhanced static model list with rich metadata
     */
    private getEnhancedStaticModelList(): ModelInfo[] {
        return Object.values(LLamaAIModel).map(model => ({
            id: model,
            name: this.getModelDisplayName(model),
            provider: 'llamaai',
            description: this.getModelDescription(model),
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

            // Include known Llama and Gemma models
            return Object.values(LLamaAIModel).includes(modelId) ||
                modelId.includes('llama') ||
                modelId.includes('gemma');
        });
    }

    /**
     * Get display name for models
     */
    private getModelDisplayName(modelId: string): string {
        const displayNames: Record<string, string> = {
            'llama3.2-90b-vision': 'Llama 3.2 90B Vision',
            'llama3.2-11b-vision': 'Llama 3.2 11B Vision',
            'llama3.2-3b': 'Llama 3.2 3B',
            'llama3.2-1b': 'Llama 3.2 1B',
            'llama3.1-405b': 'Llama 3.1 405B',
            'llama3.1-70b': 'Llama 3.1 70B',
            'llama3.1-8b': 'Llama 3.1 8B',
            'gemma2-27b': 'Gemma 2 27B',
            'gemma2-9b': 'Gemma 2 9B'
        };
        return displayNames[modelId] || modelId.replace(/[.-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }

    /**
     * Get description for models
     */
    private getModelDescription(modelId: string): string {
        const descriptions: Record<string, string> = {
            'llama3.2-90b-vision': 'Large multimodal model with vision capabilities and strong reasoning',
            'llama3.2-11b-vision': 'Efficient multimodal model with vision and text understanding',
            'llama3.2-3b': 'Compact model optimized for speed and efficiency',
            'llama3.2-1b': 'Ultra-lightweight model for basic text generation',
            'llama3.1-405b': 'Largest Llama model with exceptional reasoning capabilities',
            'llama3.1-70b': 'High-performance model balancing capability and efficiency',
            'llama3.1-8b': 'Efficient model suitable for most general tasks',
            'gemma2-27b': 'Google Gemma large model with strong performance',
            'gemma2-9b': 'Google Gemma efficient model for general use'
        };
        return descriptions[modelId] || `LlamaAI ${modelId}`;
    }

    /**
     * Get context window size for models
     */
    private getContextWindow(modelId: string): number {
        const contextWindows: Record<string, number> = {
            'llama3.2-90b-vision': 128000,
            'llama3.2-11b-vision': 128000,
            'llama3.2-3b': 128000,
            'llama3.2-1b': 128000,
            'llama3.1-405b': 128000,
            'llama3.1-70b': 128000,
            'llama3.1-8b': 128000,
            'gemma2-27b': 8192,
            'gemma2-9b': 8192
        };
        return contextWindows[modelId] || 8192;
    }

    /**
     * Get max output tokens for models
     */
    private getMaxOutput(modelId: string): number {
        const maxOutputs: Record<string, number> = {
            'llama3.2-90b-vision': 8192,
            'llama3.2-11b-vision': 8192,
            'llama3.2-3b': 8192,
            'llama3.2-1b': 8192,
            'llama3.1-405b': 8192,
            'llama3.1-70b': 8192,
            'llama3.1-8b': 8192,
            'gemma2-27b': 8192,
            'gemma2-9b': 8192
        };
        return maxOutputs[modelId] || 8192;
    }

    /**
     * Get supported features for models
     */
    private getModelFeatures(modelId: string): string[] {
        const baseFeatures = ['chat', 'json_mode'];

        if (modelId.includes('vision')) {
            return [...baseFeatures, 'vision', 'multimodal', 'image_understanding'];
        }

        if (modelId.includes('405b')) {
            return [...baseFeatures, 'advanced_reasoning', 'complex_tasks', 'large_context'];
        }

        if (modelId.includes('70b') || modelId.includes('90b')) {
            return [...baseFeatures, 'high_performance', 'reasoning'];
        }

        if (modelId.includes('gemma')) {
            return [...baseFeatures, 'efficient', 'google_trained'];
        }

        if (modelId.includes('1b') || modelId.includes('3b')) {
            return [...baseFeatures, 'fast_response', 'lightweight', 'efficient'];
        }

        return baseFeatures;
    }

    /**
     * Check if model is deprecated
     */
    private isDeprecated(modelId: string): boolean {
        // Mark older model versions as deprecated if they exist
        const deprecatedModels: string[] = [];
        return deprecatedModels.includes(modelId);
    }

    /**
     * Get static pricing for known models
     */
    private getStaticPricing(modelId: string): ModelPricing | undefined {
        const pricing = LLAMA_PRICING[modelId as LLamaAIModel];
        return pricing ? {
            input: pricing.input,
            output: pricing.output,
            currency: 'USD'
        } : undefined;
    }

    protected calculateCost(model: string, promptTokens: number, completionTokens: number): number {
        const m = model as LLamaAIModel;
        const pricing = LLAMA_PRICING[m];

        if (!pricing) {
            throw new Error(`No pricing configuration found for Llama model: ${model}`);
        }

        const inputCost = (promptTokens / 1000) * pricing.input;
        const outputCost = (completionTokens / 1000) * pricing.output;

        return Number((inputCost + outputCost).toFixed(6));
    }

    async run(
        model: string,
        prompt: MessageGlobal[],
        schema: s.Object | undefined,
        text: string
    ): Promise<ProviderResponse> {
        // Validate that the model is a Llama model
        if (!Object.values(LLamaAIModel).includes(model as LLamaAIModel)) {
            throw new InvalidModelError(`Invalid Llama model: "${model}". Please use a valid Llama model.`);
        }

        const startTime = performance.now();

        try {
            const initialMessages = prompt.map((message) => {
                return message;
            });

            const completion = await this.client.chat.completions.create({
                model: model,
                messages: [
                    ...initialMessages,
                    { role: "user", content: text },
                ],
                ...(schema && { response_format: { type: "json_object" } }),
                temperature: this.config.temperature,
                max_tokens: this.config.maxTokens,
                top_p: this.config.topP,
                presence_penalty: this.config.presencePenalty,
                frequency_penalty: this.config.frequencyPenalty,
                seed: this.config.seed,
            });

            const endTime = performance.now();
            const timeElapsed = endTime - startTime;

            const responseBody = completion.choices[0].message.content || "{}";
            let validatedData: any;
            let isStructured = false;
            
            if (schema) {
                let jsonResponse;
                try {
                    jsonResponse = JSON.parse(responseBody);
                } catch (error) {
                    throw new Error(`Failed to parse JSON response: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }

                try {
                    validatedData = schema.parse(jsonResponse);
                    isStructured = true;
                } catch (error) {
                    throw new Error(`Failed to validate schema: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            } else {
                validatedData = responseBody;
                isStructured = false;
            }

            const estimatedCost = this.calculateCost(
                model,
                completion.usage?.prompt_tokens || 0,
                completion.usage?.completion_tokens || 0
            );

            return {
                data: validatedData,
                metrics: {
                    timeElapsed,
                    estimatedCost,
                    totalTokens: (completion.usage?.prompt_tokens || 0) + (completion.usage?.completion_tokens || 0),
                    promptTokens: completion.usage?.prompt_tokens || 0,
                    completionTokens: completion.usage?.completion_tokens || 0,
                },
                isStructured
            };

        } catch (error) {
            if (error instanceof InvalidModelError) {
                throw error;
            }
            throw new Error(`Unexpected error in LlamaAI run: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}
