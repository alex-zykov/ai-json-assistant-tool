import { s } from "ajv-ts"

export class NetworkError extends Error {
    constructor(message: string, public originalError: Error) {
        super(message);
        this.name = 'NetworkError';
    }
}

export class JSONParseError extends Error {
    constructor(
        message: string,
        public originalError: Error,
        public responseBody: string
    ) {
        super(message);
        this.name = 'JSONParseError';
    }
}

export class SchemaValidationError extends Error {
    constructor(
        message: string,
        public originalError: Error,
        public responseBody: any  // Can be either string or parsed JSON
    ) {
        super(message);
        this.name = 'SchemaValidationError';
    }
}

export class InvalidModelError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'InvalidModelError';
    }
}

export class ModelLoadError extends Error {
    constructor(message: string, public provider: string, public originalError?: Error) {
        super(message);
        this.name = 'ModelLoadError';
    }
}

export interface MessageGlobal {
    role: string;
    content: string;
}

export interface ProviderResponse {
    data: any;
    metrics: {
        timeElapsed: number;  // in milliseconds
        estimatedCost: number;  // in USD
        totalTokens: number;
        promptTokens: number;
        completionTokens: number;
    };
    isStructured?: boolean;  // Indicates if response was validated against schema
}

export interface ModelPricing {
    input: number;  // per 1K tokens in USD
    output: number; // per 1K tokens in USD
    currency?: string; // default "USD"
}

export interface ModelInfo {
    id: string;
    name: string;
    provider?: string;
    description?: string;
    contextWindow?: number;
    maxOutput?: number;
    supportedFeatures?: string[];
    pricing?: ModelPricing;
    deprecated?: boolean;
    availability?: 'available' | 'limited' | 'unavailable';
}

export interface ModelListResponse {
    models: ModelInfo[];
    total: number;
    timestamp: string;
    cached?: boolean;
    fallback?: boolean;
    error?: string;
}

export interface FineTuningJobOptions {
    model: string;
    trainingFile: string;
    validationFile?: string;
    suffix: string;
    hyperparameters: {
        n_epochs: number;
        batch_size?: number;
        learning_rate_multiplier?: number;
    };
}

export interface FineTuningJob {
    id: string;
    model: string;
    status: 'validating_files' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
    created_at: number;
    finished_at?: number;
    fine_tuned_model?: string;
    training_file: string;
    validation_file?: string;
    hyperparameters: {
        n_epochs: number;
        batch_size?: number;
        learning_rate_multiplier?: number;
    };
    result_files: string[];
    trained_tokens?: number;
    error?: string;
}

export interface JSONLMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface JSONLTrainingExample {
    messages: JSONLMessage[];
}

export interface ValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
    totalExamples: number;
    estimatedTokens?: number;
}

export interface FineTuningProgress {
    jobId: string;
    status: FineTuningJob['status'];
    progress?: number;
    elapsedTime: number;
    estimatedTimeRemaining?: number;
}

export interface FineTuningMetrics {
    trainLoss?: number;
    validLoss?: number;
    trainTokenAccuracy?: number;
    validTokenAccuracy?: number;
    fullValidLoss?: number;
    fullValidMeanTokenAccuracy?: number;
}

export interface AIProvider {
    run(model: string, prompt: MessageGlobal[], schema: s.Object | undefined, text: string): Promise<ProviderResponse>;

    // New methods for dynamic model loading
    getAvailableModels(): Promise<ModelInfo[]>;
    validateModel(modelName: string): Promise<boolean>;
    getModelPricing(modelName: string): Promise<ModelPricing | null>;

    // Optional: Get specific model information
    getModelInfo(modelName: string): Promise<ModelInfo | null>;
}
