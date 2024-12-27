import { s } from "ajv-ts";
import {
    AIProvider,
    MessageGlobal,
    ProviderResponse,
    ModelInfo,
    ModelPricing,
    ModelLoadError
} from "../models/types";

export abstract class BaseProvider implements AIProvider {
    protected providerName: string;

    constructor(providerName: string) {
        this.providerName = providerName;
    }

    // Abstract method that must be implemented by each provider
    abstract run(model: string, prompt: MessageGlobal[], schema: s.Object | undefined, text: string): Promise<ProviderResponse>;

    /**
     * Get all available models from the provider
     * Fetches fresh data from API with fallback to static models
     */
    async getAvailableModels(): Promise<ModelInfo[]> {
        try {
            return await this.fetchModelsFromAPI();
        } catch (error) {
            // If API fetch fails, fall back to static models
            console.warn(`${this.providerName}: API fetch failed, using static fallback`);
            return this.getStaticModelList();
        }
    }

    /**
     * Validate if a model name exists and is available
     */
    async validateModel(modelName: string): Promise<boolean> {
        try {
            const models = await this.getAvailableModels();
            return models.some(model =>
                model.id === modelName &&
                model.availability !== 'unavailable'
            );
        } catch (error) {
            throw new ModelLoadError(
                `Failed to validate model ${modelName}`,
                this.providerName,
                error instanceof Error ? error : new Error('Unknown error')
            );
        }
    }

    /**
     * Get pricing information for a specific model
     */
    async getModelPricing(modelName: string): Promise<ModelPricing | null> {
        try {
            const models = await this.getAvailableModels();
            const model = models.find(m => m.id === modelName);
            return model?.pricing || null;
        } catch (error) {
            throw new ModelLoadError(
                `Failed to get pricing for model ${modelName}`,
                this.providerName,
                error instanceof Error ? error : new Error('Unknown error')
            );
        }
    }

    /**
     * Get detailed information for a specific model
     */
    async getModelInfo(modelName: string): Promise<ModelInfo | null> {
        try {
            const models = await this.getAvailableModels();
            return models.find(m => m.id === modelName) || null;
        } catch (error) {
            throw new ModelLoadError(
                `Failed to get info for model ${modelName}`,
                this.providerName,
                error instanceof Error ? error : new Error('Unknown error')
            );
        }
    }


    // Abstract methods that must be implemented by each provider

    /**
     * Fetch models from the provider's API
     * Each provider implements this differently
     */
    protected abstract fetchModelsFromAPI(): Promise<ModelInfo[]>;

    /**
     * Get static/fallback model list when API is unavailable
     * Each provider should implement this with their known models
     */
    protected abstract getStaticModelList(): ModelInfo[];

    /**
     * Helper method to filter models that are compatible with the provider
     * Each provider can override this to implement custom filtering logic
     */
    protected filterCompatibleModels(models: any[]): any[] {
        // Default implementation - no filtering
        // Providers can override this method to filter out incompatible models
        return models;
    }

    /**
     * Helper method to transform API model data to ModelInfo format
     * Each provider can override this to handle their specific API response format
     */
    protected transformAPIModelToModelInfo(apiModel: any): ModelInfo {
        // Default implementation - providers should override this
        return {
            id: apiModel.id || apiModel.name || 'unknown',
            name: apiModel.name || apiModel.id || 'Unknown Model',
            provider: this.providerName,
            description: apiModel.description,
            contextWindow: apiModel.context_window || apiModel.contextWindow,
            maxOutput: apiModel.max_output || apiModel.maxOutput,
            availability: 'available'
        };
    }
}
