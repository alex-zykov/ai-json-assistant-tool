import {Mistral} from "@mistralai/mistralai";
import {
    MessageGlobal,
    NetworkError,
    JSONParseError,
    SchemaValidationError,
    InvalidModelError,
    ProviderResponse,
    ModelInfo,
    ModelPricing
} from "../models/types";
import {s} from "ajv-ts";
import { BaseProvider } from "./base-provider";

export enum MistralModel {
    // Premier models
    MISTRAL_3B_LATEST = "mistral-3b-latest",
    MISTRAL_8B_LATEST = "mistral-8b-latest",
    MISTRAL_LARGE = "mistral-large-latest",
    MISTRAL_SMALL_LATEST = "mistral-small-latest",

    // Free models
    PIXTRAL_12B = "pixtral-12b",
    OPEN_MISTRAL_7B = "open-mistral-7b",
    OPEN_MIXTRAL_8_7B = "open-mixtral-8x7b",
    OPEN_MIXTRAL_8_22B = "open-mixtral-8x22b",
}

// Cost per 1000 tokens in USD
export const MISTRAL_PRICING = {
    [MistralModel.MISTRAL_LARGE]: {
        input: 0.002,
        output: 0.006
    },
    [MistralModel.MISTRAL_SMALL_LATEST]: {
        input: 0.0002,
        output: 0.0006
    },
    [MistralModel.MISTRAL_3B_LATEST]: {
        input: 0.00004,
        output: 0.00004
    },
    [MistralModel.MISTRAL_8B_LATEST]: {
        input: 0.0001,
        output: 0.0001
    },

    [MistralModel.PIXTRAL_12B]: {
        input: 0.00015,
        output: 0.00015
    },
    [MistralModel.OPEN_MISTRAL_7B]: {
        input: 0.00025,
        output: 0.00025
    },
    [MistralModel.OPEN_MIXTRAL_8_7B]: {
        input: 0.0007,
        output: 0.0007
    },
    [MistralModel.OPEN_MIXTRAL_8_22B]: {
        input: 0.002,
        output: 0.006
    }
};

export const MistralProviderConfig = s.object({
    apiKey: s.string(),
    temperature: s.number().min(0).max(2).optional().default(0.7),
    maxTokens: s.number().positive().optional().default(2048),
    topP: s.number().min(0).max(1).optional().default(0.9),
    randomSeed: s.number().int().optional()
});

export type MistralProviderConfig = s.infer<typeof MistralProviderConfig>;

export class MistralProvider extends BaseProvider {
    private client: Mistral;
    private config: MistralProviderConfig;

    constructor(config: Partial<MistralProviderConfig> = {}) {
        super('mistral'); // Initialize base provider with name

        const envConfig = {
            apiKey: process.env.MISTRAL_API_KEY,
            temperature: process.env.MISTRAL_TEMPERATURE ? parseFloat(process.env.MISTRAL_TEMPERATURE) : undefined,
            maxTokens: process.env.MISTRAL_MAX_TOKENS ? parseInt(process.env.MISTRAL_MAX_TOKENS) : undefined,
            topP: process.env.MISTRAL_TOP_P ? parseFloat(process.env.MISTRAL_TOP_P) : undefined,
            randomSeed: process.env.MISTRAL_RANDOM_SEED ? parseInt(process.env.MISTRAL_RANDOM_SEED) : undefined,
        };

        const cleanEnvConfig = Object.fromEntries(
            Object.entries(envConfig).filter(([_, value]) => value !== undefined && value !== '')
        );

        this.config = MistralProviderConfig.parse({
            ...cleanEnvConfig,
            ...config
        });

        if (!this.config.apiKey) {
            throw new Error('MISTRAL_API_KEY environment variable is required');
        }

        this.client = new Mistral({
            apiKey: this.config.apiKey
        });
    }

    /**
     * Fetch available models from Mistral API
     */
    protected async fetchModelsFromAPI(): Promise<ModelInfo[]> {
        try {
            const response = await this.client.models.list();

            if (!response.data) {
                throw new Error('No models data received from Mistral API');
            }

            // Filter for compatible models and transform to ModelInfo
            const compatibleModels = this.filterCompatibleModels(response.data);

            return compatibleModels.map(model => ({
                id: model.id,
                name: this.getModelDisplayName(model.id),
                provider: 'mistral',
                description: this.getModelDescription(model.id),
                contextWindow: this.getContextWindow(model.id),
                maxOutput: this.getMaxOutput(model.id),
                pricing: this.getStaticPricing(model.id),
                supportedFeatures: this.getModelFeatures(model.id),
                availability: this.getModelAvailability(model),
                deprecated: this.isDeprecated(model.id)
            }));

        } catch (error) {
            throw new Error(`Failed to fetch Mistral models: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get static/fallback model list
     */
    protected getStaticModelList(): ModelInfo[] {
        return Object.values(MistralModel).map(model => ({
            id: model,
            name: this.getModelDisplayName(model),
            provider: 'mistral',
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

            // Include known Mistral models that support chat completions
            return Object.values(MistralModel).includes(modelId) ||
                modelId.includes('mistral') ||
                modelId.includes('mixtral') ||
                modelId.includes('pixtral');
        });
    }

    /**
     * Get display name for models
     */
    private getModelDisplayName(modelId: string): string {
        const displayNames: Record<string, string> = {
            'mistral-large-latest': 'Mistral Large (Latest)',
            'mistral-small-latest': 'Mistral Small (Latest)',
            'mistral-3b-latest': 'Mistral 3B (Latest)',
            'mistral-8b-latest': 'Mistral 8B (Latest)',
            'pixtral-12b': 'Pixtral 12B',
            'open-mistral-7b': 'Open Mistral 7B',
            'open-mixtral-8x7b': 'Open Mixtral 8x7B',
            'open-mixtral-8x22b': 'Open Mixtral 8x22B'
        };
        return displayNames[modelId] || modelId.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }

    /**
     * Get description for models
     */
    private getModelDescription(modelId: string): string {
        const descriptions: Record<string, string> = {
            'mistral-large-latest': 'Most capable Mistral model for complex reasoning and analysis',
            'mistral-small-latest': 'Balanced model for general use cases with good performance',
            'mistral-3b-latest': 'Compact model optimized for speed and efficiency',
            'mistral-8b-latest': 'Mid-size model balancing capability and cost',
            'pixtral-12b': 'Multimodal model capable of processing images and text',
            'open-mistral-7b': 'Open-source model for general text generation',
            'open-mixtral-8x7b': 'Expert mixture model with excellent performance',
            'open-mixtral-8x22b': 'Large expert mixture model for complex tasks'
        };
        return descriptions[modelId] || `Mistral ${modelId}`;
    }

    /**
     * Get context window size for models
     */
    private getContextWindow(modelId: string): number {
        const contextWindows: Record<string, number> = {
            'mistral-large-latest': 128000,
            'mistral-small-latest': 128000,
            'mistral-3b-latest': 128000,
            'mistral-8b-latest': 128000,
            'pixtral-12b': 128000,
            'open-mistral-7b': 32768,
            'open-mixtral-8x7b': 32768,
            'open-mixtral-8x22b': 65536
        };
        return contextWindows[modelId] || 32768;
    }

    /**
     * Get max output tokens for models
     */
    private getMaxOutput(modelId: string): number {
        const maxOutputs: Record<string, number> = {
            'mistral-large-latest': 8192,
            'mistral-small-latest': 8192,
            'mistral-3b-latest': 8192,
            'mistral-8b-latest': 8192,
            'pixtral-12b': 8192,
            'open-mistral-7b': 8192,
            'open-mixtral-8x7b': 8192,
            'open-mixtral-8x22b': 8192
        };
        return maxOutputs[modelId] || 8192;
    }

    /**
     * Get supported features for models
     */
    private getModelFeatures(modelId: string): string[] {
        const baseFeatures = ['chat', 'json_mode', 'function_calling'];

        if (modelId.includes('pixtral')) {
            return [...baseFeatures, 'vision', 'multimodal'];
        }

        if (modelId.includes('large')) {
            return [...baseFeatures, 'advanced_reasoning', 'complex_tasks'];
        }

        if (modelId.includes('mixtral')) {
            return [...baseFeatures, 'expert_mixture', 'high_performance'];
        }

        if (modelId.includes('3b') || modelId.includes('7b')) {
            return [...baseFeatures, 'fast_response', 'efficient'];
        }

        return baseFeatures;
    }

    /**
     * Get model availability status
     */
    private getModelAvailability(model: any): 'available' | 'limited' | 'unavailable' {
        // Check if model has any availability info from API
        if (model.owned_by === 'mistralai') {
            return 'available';
        }

        // Default to available for known models
        return 'available';
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
        const pricing = MISTRAL_PRICING[modelId as MistralModel];
        return pricing ? {
            input: pricing.input,
            output: pricing.output,
            currency: 'USD'
        } : undefined;
    }

    private calculateCost(model: MistralModel, promptTokens: number, completionTokens: number): number {
        const pricing = MISTRAL_PRICING[model];
        if (!pricing) {
            throw new Error(`No pricing configuration found for model: ${model}`);
        }

        const inputCost = (promptTokens / 1000) * pricing.input;
        const outputCost = (completionTokens / 1000) * pricing.output;

        return Number((inputCost + outputCost).toFixed(6));
    }

    async run<T>(
        model: MistralModel | string,
        prompt: MessageGlobal[],
        schema: s.Object | undefined,
        text: string
    ): Promise<ProviderResponse> {
        // Model validation
        const validModels = Object.values(MistralModel);
        if (!validModels.includes(model as MistralModel)) {
            throw new InvalidModelError(`Invalid Mistral model: "${model}". Please use a valid model.`);
        }

        const startTime = performance.now();

        try {
            const response = await this.client.chat.complete({
                model: model,
                messages: [
                    // @ts-ignore
                    ...prompt,
                    // @ts-ignore
                    { "role": "user", "content": text }
                ],
                ...(schema && {
                    responseFormat: {
                        type: "json_object",
                    }
                }),
                temperature: this.config.temperature,
                maxTokens: this.config.maxTokens,
                topP: this.config.topP,
                randomSeed: this.config.randomSeed,
            }).catch(error => {
                throw new NetworkError(
                    `Failed to make Mistral API request: ${error.message}`,
                    error
                );
            });

            const endTime = performance.now();
            const timeElapsed = endTime - startTime;

            const responseBody = response.choices![0].message.content as string;

            let validatedData: any;
            let isStructured = false;
            
            if (schema) {
                let parsedResponse;
                try {
                    parsedResponse = JSON.parse(responseBody);
                } catch (error) {
                    throw new JSONParseError(
                        `Failed to parse Mistral JSON response: ${error instanceof Error ? error.message : 'Unknown error'}`,
                        error instanceof Error ? error : new Error('Unknown error'),
                        responseBody
                    );
                }

                try {
                    validatedData = schema.parse(parsedResponse);
                    isStructured = true;
                } catch (error) {
                    throw new SchemaValidationError(
                        `Failed to validate Mistral response schema: ${error instanceof Error ? error.message : 'Unknown error'}`,
                        error instanceof Error ? error : new Error('Unknown error'),
                        parsedResponse
                    );
                }
            } else {
                validatedData = responseBody;
                isStructured = false;
            }

            // Calculate token usage from response
            const promptTokens = response.usage?.promptTokens ?? 0;
            const completionTokens = response.usage?.completionTokens ?? 0;

            const estimatedCost = this.calculateCost(
                model as MistralModel,
                promptTokens,
                completionTokens
            );

            return {
                data: validatedData,
                metrics: {
                    timeElapsed,
                    estimatedCost,
                    totalTokens: promptTokens + completionTokens,
                    promptTokens,
                    completionTokens,
                },
                isStructured
            };

        } catch (error) {
            // Re-throw custom errors
            if (error instanceof NetworkError ||
                error instanceof JSONParseError ||
                error instanceof SchemaValidationError ||
                error instanceof InvalidModelError) {
                throw error;
            }
            // Handle any other unexpected errors
            throw new Error(`Unexpected error in Mistral run: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}
