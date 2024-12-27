import Anthropic from "@anthropic-ai/sdk";
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
import {TextBlock} from "@anthropic-ai/sdk/resources/messages";
import {s} from "ajv-ts";
import {MessageParam} from "@anthropic-ai/sdk/src/resources/messages";
import { BaseProvider } from "./base-provider";

export enum ClaudeModel {
    // Claude 4 Models
    OPUS_4 = "claude-opus-4",
    SONNET_4 = "claude-sonnet-4",
    
    // Claude 3.7 Models
    SONNET_3_7 = "claude-sonnet-3.7",
    
    // Claude 3.5 Models (Latest)
    SONNET_3_5 = "claude-3-5-sonnet-latest",
    HAIKU_3_5 = "claude-3-5-haiku-latest",
}

// Cost per 1000 tokens in USD
export const CLAUDE_PRICING = {
    // Claude 4 Models
    [ClaudeModel.OPUS_4]: {
        input: 0.05,   // $50 per 1M tokens
        output: 0.2    // $200 per 1M tokens = $20 per 100K tokens
    },
    [ClaudeModel.SONNET_4]: {
        input: 0.05,   // $50 per 1M tokens
        output: 0.08   // $80 per 1M tokens = $8 per 100K tokens
    },
    
    // Claude 3.7 Models
    [ClaudeModel.SONNET_3_7]: {
        input: 0.05,   // $50 per 1M tokens
        output: 0.08   // $80 per 1M tokens = $8 per 100K tokens
    },
    
    // Claude 3.5 Models (Latest)
    [ClaudeModel.SONNET_3_5]: {
        input: 0.003,
        output: 0.015
    },
    [ClaudeModel.HAIKU_3_5]: {
        input: 0.00025,
        output: 0.00125
    }
};

export const ClaudeProviderConfig = s.object({
    apiKey: s.string(),
    maxTokens: s.number().optional().default(2048),
});

export type ClaudeProviderConfig = s.infer<typeof ClaudeProviderConfig>;

export class ClaudeProvider extends BaseProvider {
    private client: Anthropic;
    private config: ClaudeProviderConfig;

    constructor(config: Partial<ClaudeProviderConfig> = {}) {
        super('claude'); // Initialize base provider with name

        const envConfig = {
            apiKey: process.env.ANTHROPIC_API_KEY,
            maxTokens: process.env.CLAUDE_MAX_TOKENS ? parseInt(process.env.CLAUDE_MAX_TOKENS) : undefined,
        };

        const cleanEnvConfig = Object.fromEntries(
            Object.entries(envConfig).filter(([_, value]) => value !== undefined && value !== '')
        );

        this.config = ClaudeProviderConfig.parse({
            ...cleanEnvConfig,
            ...config
        });

        if (!this.config.apiKey) {
            throw new Error('ANTHROPIC_API_KEY environment variable is required');
        }

        this.client = new Anthropic({
            apiKey: this.config.apiKey,
        });
    }

    /**
     * Fetch available models from Anthropic API
     * Note: Anthropic doesn't have a public models endpoint yet,
     * so we use static models with enhanced metadata
     */
    protected async fetchModelsFromAPI(): Promise<ModelInfo[]> {
        try {
            // Try to make a test request to validate API key and get any dynamic info
            // Since Anthropic doesn't have a /models endpoint, we'll return our enhanced static list
            await this.validateAPIConnection();
            return this.getEnhancedStaticModelList();
        } catch (error) {
            throw new Error(`Failed to validate Anthropic API connection: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Validate API connection by making a minimal request
     */
    private async validateAPIConnection(): Promise<void> {
        try {
            // Make a minimal request to validate the API key
            await this.client.messages.create({
                model: ClaudeModel.HAIKU_3_5, // Use cheapest model for validation
                max_tokens: 1,
                messages: [{ role: "user", content: "test" }]
            });
        } catch (error) {
            // If it's an API key error, throw it. Otherwise, assume the API is working
            if (error instanceof Error && error.message.includes('authentication')) {
                throw error;
            }
            // Other errors (like rate limits) don't necessarily mean the API key is invalid
        }
    }

    /**
     * Get enhanced static model list with rich metadata
     */
    private getEnhancedStaticModelList(): ModelInfo[] {
        return Object.values(ClaudeModel).map(model => ({
            id: model,
            name: this.getModelDisplayName(model),
            provider: 'claude',
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
     * Get static/fallback model list
     */
    protected getStaticModelList(): ModelInfo[] {
        return Object.values(ClaudeModel).map(model => ({
            id: model,
            name: this.getModelDisplayName(model),
            provider: 'claude',
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
     * Get display name for models
     */
    private getModelDisplayName(modelId: string): string {
        const displayNames: Record<string, string> = {
            'claude-3-5-sonnet-latest': 'Claude 3.5 Sonnet (Latest)',
            'claude-3-5-haiku-latest': 'Claude 3.5 Haiku (Latest)'
        };
        return displayNames[modelId] || modelId;
    }

    /**
     * Get description for models
     */
    private getModelDescription(modelId: string): string {
        const descriptions: Record<string, string> = {
            'claude-3-5-sonnet-latest': 'Most capable Claude model for complex tasks, analysis, and creative work',
            'claude-3-5-haiku-latest': 'Fastest Claude model for simple tasks and quick responses'
        };
        return descriptions[modelId] || `Anthropic ${modelId}`;
    }

    /**
     * Get context window size for models
     */
    private getContextWindow(modelId: string): number {
        // All Claude 3.5 models have 200K context window
        const contextWindows: Record<string, number> = {
            'claude-3-5-sonnet-latest': 200000,
            'claude-3-5-haiku-latest': 200000
        };
        return contextWindows[modelId] || 200000;
    }

    /**
     * Get max output tokens for models
     */
    private getMaxOutput(modelId: string): number {
        // All Claude models can output up to 8192 tokens
        const maxOutputs: Record<string, number> = {
            'claude-3-5-sonnet-latest': 8192,
            'claude-3-5-haiku-latest': 8192
        };
        return maxOutputs[modelId] || 8192;
    }

    /**
     * Get supported features for models
     */
    private getModelFeatures(modelId: string): string[] {
        const baseFeatures = ['chat', 'json_mode', 'system_prompts', 'long_context'];

        if (modelId.includes('sonnet')) {
            return [...baseFeatures, 'advanced_reasoning', 'code_analysis', 'creative_writing'];
        }

        if (modelId.includes('haiku')) {
            return [...baseFeatures, 'fast_response', 'simple_tasks'];
        }

        return baseFeatures;
    }

    /**
     * Check if model is deprecated
     */
    private isDeprecated(modelId: string): boolean {
        // None of the current models are deprecated
        // This would be updated as Anthropic releases new versions
        return false;
    }

    /**
     * Get static pricing for known models
     */
    private getStaticPricing(modelId: string): ModelPricing | undefined {
        const pricing = CLAUDE_PRICING[modelId as ClaudeModel];
        return pricing ? {
            input: pricing.input,
            output: pricing.output,
            currency: 'USD'
        } : undefined;
    }

    private calculateCost(model: ClaudeModel, promptTokens: number, completionTokens: number): number {
        const pricing = CLAUDE_PRICING[model];
        if (!pricing) {
            throw new Error(`No pricing configuration found for model: ${model}`);
        }

        const inputCost = (promptTokens / 1000) * pricing.input;
        const outputCost = (completionTokens / 1000) * pricing.output;

        return Number((inputCost + outputCost).toFixed(6));
    }

    async run(
        model: ClaudeModel | string,
        prompt: MessageGlobal[],
        schema: s.Object | undefined,
        text: string
    ): Promise<ProviderResponse> {
        // Model validation
        const validModels = Object.values(ClaudeModel);
        if (!validModels.includes(model as ClaudeModel)) {
            throw new InvalidModelError(`Invalid Claude model: "${model}". Please use a valid model.`);
        }

        const startTime = performance.now();

        try {
            const systemPrompt = prompt.find((message) => message.role === "system")?.content ??
                "Always respond with valid JSON matching the specified schema.";

            const otherPrompt: MessageParam[] = prompt
                .filter((message) => message.role !== "system")
                .map((message) => {
                    if (message.role === "assistant") {
                        return { role: "assistant", content: message.content };
                    } else {
                        return { role: "user", content: message.content };
                    }
                });

            const response = await this.client.messages.create({
                model: model,
                max_tokens: this.config.maxTokens || 2024,
                system: systemPrompt,

                messages: [
                    ...otherPrompt,
                    { role: "user", content: text }
                ]
            }).catch(error => {
                throw new NetworkError(
                    `Failed to make Claude API request: ${error.message}`,
                    error
                );
            });

            const endTime = performance.now();
            const timeElapsed = endTime - startTime;

            const block = response.content[0] as TextBlock;
            const responseBody = block.text;

            let validatedData: any;
            let isStructured = false;
            
            if (schema) {
                // Parse JSON and validate against schema
                let parsedResponse;
                try {
                    parsedResponse = JSON.parse(responseBody);
                } catch (error) {
                    throw new JSONParseError(
                        `Failed to parse Claude JSON response: ${error instanceof Error ? error.message : 'Unknown error'}`,
                        error instanceof Error ? error : new Error('Unknown error'),
                        responseBody
                    );
                }
                
                try {
                    validatedData = schema.parse(parsedResponse);
                    isStructured = true;
                } catch (error) {
                    throw new SchemaValidationError(
                        `Failed to validate Claude response schema: ${error instanceof Error ? error.message : 'Unknown error'}`,
                        error instanceof Error ? error : new Error('Unknown error'),
                        parsedResponse
                    );
                }
            } else {
                // Return raw string response without JSON parsing
                validatedData = responseBody;
                isStructured = false;
            }

            const estimatedCost = this.calculateCost(
                model as ClaudeModel,
                response.usage.input_tokens,
                response.usage.output_tokens
            );

            return {
                data: validatedData,
                metrics: {
                    timeElapsed,
                    estimatedCost,
                    totalTokens: response.usage.input_tokens + response.usage.output_tokens,
                    promptTokens: response.usage.input_tokens,
                    completionTokens: response.usage.output_tokens,
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
            throw new Error(`Unexpected error in Claude run: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}
