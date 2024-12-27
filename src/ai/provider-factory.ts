import {AIProvider, ModelInfo, ModelLoadError} from "../models/types";
import {OpenAIProvider, OpenAIModel} from "./openai-middleware";
import {ClaudeProvider, ClaudeModel} from "./claude-middleware";
import {MistralProvider, MistralModel} from "./mistral-middleware";
import {LLamaAIProvider, LLamaAIModel} from "./llamaai-middleware";

export type ProviderType = "openai" | "claude" | "mistral" | "llamaai";



export class AIProviderFactory {
    private static providerInstances: Map<ProviderType, AIProvider> = new Map();

    constructor() {
        // No configuration needed - providers get all config from environment
    }


    /**
     * Get all available models dynamically from providers
     */
    public static async getAllModelsAsync(suppressWarnings: boolean = false): Promise<ModelInfo[]> {
        const allModels: ModelInfo[] = [];
        const providers = this.getProviderInstances(suppressWarnings);
        const errors: string[] = [];

        for (const [providerType, provider] of providers) {
            try {
                const models = await provider.getAvailableModels();
                models.forEach(model => {
                    // Ensure provider is set
                    model.provider = providerType;
                    allModels.push(model);
                });
            } catch (error) {
                const errorMessage = `Failed to load models from ${providerType}: ${error instanceof Error ? error.message : 'Unknown error'}`;
                errors.push(errorMessage);
                console.warn(errorMessage);

                // Use static fallback for this provider
                try {
                    const staticModels = this.getStaticModelsForProvider(providerType);
                    allModels.push(...staticModels);
                } catch (staticError) {
                    console.error(`Failed to get static models for ${providerType}:`, staticError);
                }
            }
        }

        // If we had errors but still got some models, that's okay
        if (allModels.length === 0 && errors.length > 0) {
            throw new ModelLoadError(
                `Failed to load models from all providers: ${errors.join('; ')}`,
                'all'
            );
        }

        return allModels;
    }

    /**
     * Get models for a specific provider
     */
    public static async getModelsForProvider(providerType: ProviderType, suppressWarnings: boolean = false): Promise<ModelInfo[]> {
        try {
            const provider = this.getProviderInstance(providerType, suppressWarnings);
            const models = await provider.getAvailableModels();

            // Ensure provider is set on all models
            models.forEach(model => {
                model.provider = providerType;
            });

            return models;

        } catch (error) {
            // Fallback to static models
            console.warn(`Failed to load models from ${providerType}, using static fallback:`, error);
            return this.getStaticModelsForProvider(providerType);
        }
    }

    /**
     * Validate a model name asynchronously
     */
    public static async validateModelAsync(modelName: string, suppressWarnings: boolean = false): Promise<boolean> {
        try {
            await this.getProviderTypeForModelAsync(modelName, suppressWarnings);
            return true;
        } catch (error) {
            // Fallback to static validation
            return this.isValidModel(modelName);
        }
    }

    /**
     * Get detailed information about a specific model
     */
    public static async getModelInfo(modelName: string, suppressWarnings: boolean = false): Promise<ModelInfo | null> {
        try {
            const providerType = await this.getProviderTypeForModelAsync(modelName, suppressWarnings);
            const provider = this.getProviderInstance(providerType, suppressWarnings);
            return await provider.getModelInfo(modelName);
        } catch (error) {
            console.warn(`Failed to get model info for ${modelName}:`, error);
            return null;
        }
    }

    // Private helper methods

    private static getProviderInstances(suppressWarnings: boolean = false): Map<ProviderType, AIProvider> {
        if (this.providerInstances.size === 0) {
            try {
                this.providerInstances.set('openai', new OpenAIProvider());
            } catch (error) {
                if (!suppressWarnings) {
                    console.warn('Failed to initialize OpenAI provider:', error);
                }
            }

            try {
                this.providerInstances.set('claude', new ClaudeProvider());
            } catch (error) {
                if (!suppressWarnings) {
                    console.warn('Failed to initialize Claude provider:', error);
                }
            }

            try {
                this.providerInstances.set('mistral', new MistralProvider());
            } catch (error) {
                if (!suppressWarnings) {
                    console.warn('Failed to initialize Mistral provider:', error);
                }
            }

            try {
                this.providerInstances.set('llamaai', new LLamaAIProvider());
            } catch (error) {
                if (!suppressWarnings) {
                    console.warn('Failed to initialize LlamaAI provider:', error);
                }
            }
        }

        return this.providerInstances;
    }

    private static getProviderInstance(providerType: ProviderType, suppressWarnings: boolean = false): AIProvider {
        const providers = this.getProviderInstances(suppressWarnings);
        const provider = providers.get(providerType);

        if (!provider) {
            throw new Error(`Provider ${providerType} not available or failed to initialize`);
        }

        return provider;
    }

    private static getStaticModelsForProvider(providerType: ProviderType): ModelInfo[] {
        switch (providerType) {
            case 'openai':
                return Object.values(OpenAIModel).map(model => ({
                    id: model,
                    name: model,
                    provider: 'openai' as const
                }));
            case 'claude':
                return Object.values(ClaudeModel).map(model => ({
                    id: model,
                    name: model,
                    provider: 'claude' as const
                }));
            case 'mistral':
                return Object.values(MistralModel).map(model => ({
                    id: model,
                    name: model,
                    provider: 'mistral' as const
                }));
            case 'llamaai':
                return Object.values(LLamaAIModel).map(model => ({
                    id: model,
                    name: model,
                    provider: 'llamaai' as const
                }));
            default:
                return [];
        }
    }

    // Existing methods for backward compatibility

    public createProvider(type: ProviderType): AIProvider {
        switch (type) {
            case "openai":
                return new OpenAIProvider();
            case "claude":
                return new ClaudeProvider();
            case "mistral":
                return new MistralProvider();
            case "llamaai":
                return new LLamaAIProvider();
            default:
                throw new Error(`Unsupported provider type: ${type}`);
        }
    }

    /**
     * Creates a provider instance based on the given model name string
     */
    public createProviderForModel(modelName: string): AIProvider {
        if (Object.values(OpenAIModel).includes(modelName as OpenAIModel)) {
            return this.createProvider("openai");
        }
        if (Object.values(ClaudeModel).includes(modelName as ClaudeModel)) {
            return this.createProvider("claude");
        }
        if (Object.values(MistralModel).includes(modelName as MistralModel)) {
            return this.createProvider("mistral");
        }
        if (Object.values(LLamaAIModel).includes(modelName as LLamaAIModel)) {
            return this.createProvider("llamaai");
        }
        throw new Error(`Unrecognized model: ${modelName}`);
    }

    /**
     * Helper method to get the provider type for a given model name string
     */
    public static getProviderTypeForModel(modelName: string): ProviderType {
        if (Object.values(OpenAIModel).includes(modelName as OpenAIModel)) {
            return "openai";
        }
        if (Object.values(ClaudeModel).includes(modelName as ClaudeModel)) {
            return "claude";
        }
        if (Object.values(MistralModel).includes(modelName as MistralModel)) {
            return "mistral";
        }
        if (Object.values(LLamaAIModel).includes(modelName as LLamaAIModel)) {
            return "llamaai";
        }
        throw new Error(`Unrecognized model: ${modelName}`);
    }

    /**
     * Get provider type for a model using dynamic model lists (async)
     */
    public static async getProviderTypeForModelAsync(modelName: string, suppressWarnings: boolean = false): Promise<ProviderType> {
        try {
            // First try static method
            return this.getProviderTypeForModel(modelName);
        } catch (error) {
            // Check for fine-tuned OpenAI models
            if (modelName.startsWith('ft:')) {
                return 'openai';
            }

            // If static fails, search in dynamic model lists
            try {
                const allModels = await this.getAllModelsAsync(suppressWarnings);
                const foundModel = allModels.find(m => m.id === modelName);

                if (foundModel && foundModel.provider) {
                    return foundModel.provider as ProviderType;
                }
            } catch (dynamicError) {
                // If dynamic lookup also fails, fall back to original error
            }

            throw error; // Re-throw original error
        }
    }

    /**
     * Checks if a given model name string is valid (static version)
     */
    public static isValidModel(modelName: string): boolean {
        try {
            this.getProviderTypeForModel(modelName);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Validate that all required environment variables are set
     */
    public static validateEnvironment(): { valid: boolean; missing: string[] } {
        const requiredVars = [
            'OPENAI_API_KEY',
            'ANTHROPIC_API_KEY',
            'MISTRAL_API_KEY',
            'LLAMAAI_API_KEY'
        ];

        const missing = requiredVars.filter(varName => !process.env[varName]);

        return {
            valid: missing.length === 0,
            missing
        };
    }

    /**
     * Get current configuration from environment variables
     */
    public static getCurrentConfig() {
        return {
            openai: {
                apiKey: process.env.OPENAI_API_KEY ? '***' : undefined,
                baseUrl: process.env.OPENAI_BASE_URL,
                temperature: process.env.OPENAI_TEMPERATURE ? parseFloat(process.env.OPENAI_TEMPERATURE) : 0.7,
                maxTokens: process.env.OPENAI_MAX_TOKENS ? parseInt(process.env.OPENAI_MAX_TOKENS) : 2048,
                topP: process.env.OPENAI_TOP_P ? parseFloat(process.env.OPENAI_TOP_P) : 0.9,
                presencePenalty: process.env.OPENAI_PRESENCE_PENALTY ? parseFloat(process.env.OPENAI_PRESENCE_PENALTY) : 0,
                frequencyPenalty: process.env.OPENAI_FREQUENCY_PENALTY ? parseFloat(process.env.OPENAI_FREQUENCY_PENALTY) : 0,
                seed: process.env.OPENAI_SEED ? parseInt(process.env.OPENAI_SEED) : undefined,
                organizationId: process.env.OPENAI_ORGANIZATION_ID,
                projectId: process.env.OPENAI_PROJECT_ID,
            },
            claude: {
                apiKey: process.env.ANTHROPIC_API_KEY ? '***' : undefined,
                maxTokens: process.env.CLAUDE_MAX_TOKENS ? parseInt(process.env.CLAUDE_MAX_TOKENS) : 2048,
            },
            mistral: {
                apiKey: process.env.MISTRAL_API_KEY ? '***' : undefined,
                temperature: process.env.MISTRAL_TEMPERATURE ? parseFloat(process.env.MISTRAL_TEMPERATURE) : 0.7,
                maxTokens: process.env.MISTRAL_MAX_TOKENS ? parseInt(process.env.MISTRAL_MAX_TOKENS) : 2048,
                topP: process.env.MISTRAL_TOP_P ? parseFloat(process.env.MISTRAL_TOP_P) : 0.9,
                randomSeed: process.env.MISTRAL_RANDOM_SEED ? parseInt(process.env.MISTRAL_RANDOM_SEED) : undefined,
            },
            llamaai: {
                apiKey: process.env.LLAMAAI_API_KEY ? '***' : undefined,
                baseUrl: process.env.LLAMAAI_BASE_URL || "https://api.llama-api.com",
                temperature: process.env.LLAMAAI_TEMPERATURE ? parseFloat(process.env.LLAMAAI_TEMPERATURE) : 0.7,
                maxTokens: process.env.LLAMAAI_MAX_TOKENS ? parseInt(process.env.LLAMAAI_MAX_TOKENS) : 2048,
                topP: process.env.LLAMAAI_TOP_P ? parseFloat(process.env.LLAMAAI_TOP_P) : 0.9,
                presencePenalty: process.env.LLAMAAI_PRESENCE_PENALTY ? parseFloat(process.env.LLAMAAI_PRESENCE_PENALTY) : 0,
                frequencyPenalty: process.env.LLAMAAI_FREQUENCY_PENALTY ? parseFloat(process.env.LLAMAAI_FREQUENCY_PENALTY) : 0,
                seed: process.env.LLAMAAI_SEED ? parseInt(process.env.LLAMAAI_SEED) : undefined,
                organizationId: process.env.LLAMAAI_ORGANIZATION_ID,
                projectId: process.env.LLAMAAI_PROJECT_ID,
            }
        };
    }
}
