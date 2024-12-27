// src/ai/openai-fine-tuning.ts

import OpenAI from "openai";
import fs from 'fs/promises';
import chalk from 'chalk';
import {createReadStream} from "node:fs";

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
        n_epochs: number | "auto";
        batch_size?: number;
        learning_rate_multiplier?: number;
    };
    result_files: string[];
    trained_tokens?: number;
    error?: string;
}

interface JSONLMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

interface JSONLTrainingExample {
    messages: JSONLMessage[];
}

export class OpenAIFineTuningService {
    private client: OpenAI;

    constructor() {
        if (!process.env.OPENAI_API_KEY) {
            throw new Error('OPENAI_API_KEY environment variable is required');
        }

        this.client = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });
    }

    /**
     * Validate and upload training file
     */
    async prepareAndUploadTrainingFile(filePath: string): Promise<string> {
        // Validate file exists
        try {
            await fs.access(filePath);
        } catch (error) {
            throw new Error(`Training file not found: ${filePath}`);
        }

        // Validate JSONL format
        await this.validateJSONLFormat(filePath);

        // Upload file
        return this.uploadFile(filePath);
    }

    /**
     * Upload a file to OpenAI
     */
    async uploadFile(filePath: string): Promise<string> {
        try {
            // Use createReadStream which works reliably with OpenAI SDK
            const file = await this.client.files.create({
                file: createReadStream(filePath),
                purpose: 'fine-tune',
            });

            return file.id;
        } catch (error) {
            throw new Error(`Failed to upload file: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Validate JSONL training file format
     */
    private async validateJSONLFormat(filePath: string): Promise<void> {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const lines = content.split('\n').filter(line => line.trim());

            if (lines.length === 0) {
                throw new Error('Training file is empty');
            }

            if (lines.length < 10) {
                throw new Error(`Training file must have at least 10 examples, found ${lines.length}`);
            }

            const errors: string[] = [];

            for (let i = 0; i < lines.length; i++) {
                const lineNum = i + 1;
                const line = lines[i].trim();

                try {
                    const example: JSONLTrainingExample = JSON.parse(line);

                    // Validate structure
                    if (!example.messages || !Array.isArray(example.messages)) {
                        errors.push(`Line ${lineNum}: Missing or invalid 'messages' array`);
                        continue;
                    }

                    if (example.messages.length < 2) {
                        errors.push(`Line ${lineNum}: Must have at least 2 messages (user and assistant)`);
                        continue;
                    }

                    // Validate messages
                    let hasUser = false;
                    let hasAssistant = false;

                    for (const message of example.messages) {
                        if (!message.role || !message.content) {
                            errors.push(`Line ${lineNum}: Message missing 'role' or 'content'`);
                            break;
                        }

                        if (!['system', 'user', 'assistant'].includes(message.role)) {
                            errors.push(`Line ${lineNum}: Invalid role '${message.role}', must be 'system', 'user', or 'assistant'`);
                            break;
                        }

                        if (message.role === 'user') hasUser = true;
                        if (message.role === 'assistant') hasAssistant = true;
                    }

                    if (!hasUser) {
                        errors.push(`Line ${lineNum}: Must have at least one 'user' message`);
                    }

                    if (!hasAssistant) {
                        errors.push(`Line ${lineNum}: Must have at least one 'assistant' message`);
                    }

                } catch (parseError) {
                    errors.push(`Line ${lineNum}: Invalid JSON - ${parseError}`);
                }
            }

            if (errors.length > 0) {
                console.error(chalk.red('\nTraining data validation errors:'));
                errors.slice(0, 10).forEach(error => {
                    console.error(chalk.red(`  ${error}`));
                });

                if (errors.length > 10) {
                    console.error(chalk.red(`  ... and ${errors.length - 10} more errors`));
                }

                throw new Error(`Training data validation failed with ${errors.length} errors`);
            }

            console.log(chalk.green(` ✓ Validated ${lines.length} training examples`));

        } catch (error) {
            if (error instanceof Error && error.message.includes('Training data validation failed')) {
                throw error;
            }
            throw new Error(`Failed to validate training file: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Create a fine-tuning job
     */
    async createFineTuningJob(options: FineTuningJobOptions): Promise<FineTuningJob> {
        try {
            const job = await this.client.fineTuning.jobs.create({
                training_file: options.trainingFile,
                validation_file: options.validationFile,
                model: options.model,
                suffix: options.suffix,
                hyperparameters: {
                    n_epochs: options.hyperparameters.n_epochs,
                    ...(options.hyperparameters.batch_size && {
                        batch_size: options.hyperparameters.batch_size || "auto"
                    }),
                    ...(options.hyperparameters.learning_rate_multiplier && {
                        learning_rate_multiplier: options.hyperparameters.learning_rate_multiplier || "auto"
                    }),
                },
            });

            return {
                id: job.id,
                model: job.model,
                status: job.status as any,
                created_at: job.created_at,
                finished_at: job.finished_at || undefined,
                fine_tuned_model: job.fine_tuned_model || undefined,
                training_file: job.training_file,
                validation_file: job.validation_file || undefined,
                hyperparameters: {
                    n_epochs: job.hyperparameters.n_epochs,
                },
                result_files: job.result_files,
                trained_tokens: job.trained_tokens || undefined,
                error: job.error?.message || undefined,
            };

        } catch (error) {
            throw new Error(`Failed to create fine-tuning job: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get the status of a fine-tuning job
     */
    async getJobStatus(jobId: string): Promise<FineTuningJob> {
        try {
            const job = await this.client.fineTuning.jobs.retrieve(jobId);

            return {
                id: job.id,
                model: job.model,
                status: job.status as any,
                created_at: job.created_at,
                finished_at: job.finished_at || undefined,
                fine_tuned_model: job.fine_tuned_model || undefined,
                training_file: job.training_file,
                validation_file: job.validation_file || undefined,
                hyperparameters: {
                    n_epochs: job.hyperparameters.n_epochs,
                },
                result_files: job.result_files,
                trained_tokens: job.trained_tokens || undefined,
                error: job.error?.message || undefined,
            };

        } catch (error) {
            throw new Error(`Failed to get job status: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * List fine-tuning jobs
     */
    async listJobs(limit: number = 10): Promise<FineTuningJob[]> {
        try {
            const response = await this.client.fineTuning.jobs.list({ limit });

            return response.data.map(job => ({
                id: job.id,
                model: job.model,
                status: job.status as any,
                created_at: job.created_at,
                finished_at: job.finished_at || undefined,
                fine_tuned_model: job.fine_tuned_model || undefined,
                training_file: job.training_file,
                validation_file: job.validation_file || undefined,
                hyperparameters: {
                    n_epochs: job.hyperparameters.n_epochs,
                },
                result_files: job.result_files,
                trained_tokens: job.trained_tokens || undefined,
                error: job.error?.message || undefined,
            }));

        } catch (error) {
            throw new Error(`Failed to list jobs: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Wait for a fine-tuning job to complete
     */
    async waitForCompletion(jobId: string, pollIntervalMs: number = 30000): Promise<FineTuningJob> {
        const startTime = Date.now();
        let lastStatus = '';

        while (true) {
            const job = await this.getJobStatus(jobId);

            // Show status updates
            if (job.status !== lastStatus) {
                const elapsed = Math.round((Date.now() - startTime) / 1000);
                console.log(chalk.blue(`[${elapsed}s]`), chalk.cyan('Status:'), this.getStatusColor(job.status)(job.status));
                lastStatus = job.status;
            }

            // Check if job is complete
            if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
                return job;
            }

            // Wait before next poll
            await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
        }
    }

    /**
     * Find a model by suffix (for checking if it exists)
     */
    async findModelBySuffix(suffix: string): Promise<string | null> {
        try {
            const models = await this.client.models.list();

            // Look for fine-tuned models with the given suffix
            const matchingModel = models.data.find(model =>
                model.id.startsWith('ft:') && model.id.includes(`:${suffix}:`)
            );

            return matchingModel ? matchingModel.id : null;

        } catch (error) {
            // If we can't list models, assume no existing model
            console.warn(chalk.yellow('Warning: Could not check for existing models'));
            return null;
        }
    }

    /**
     * Cancel a fine-tuning job
     */
    async cancelJob(jobId: string): Promise<void> {
        try {
            await this.client.fineTuning.jobs.cancel(jobId);
        } catch (error) {
            throw new Error(`Failed to cancel job: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get color for job status display
     */
    private getStatusColor(status: string) {
        switch (status) {
            case 'succeeded': return chalk.green;
            case 'failed':
            case 'cancelled': return chalk.red;
            case 'running': return chalk.blue;
            case 'queued':
            case 'validating_files': return chalk.yellow;
            default: return chalk.gray;
        }
    }

    /**
     * List all fine-tuned models
     */
    async listModels(): Promise<Array<{
        id: string;
        created: number;
        object: string;
        owned_by: string;
        parent?: string;
        root?: string;
    }>> {
        try {
            const response = await this.client.models.list();

            // Filter for fine-tuned models only
            const fineTunedModels = response.data.filter(model =>
                model.id.startsWith('ft:')
            );

            return fineTunedModels.map(model => ({
                id: model.id,
                created: model.created,
                object: model.object,
                owned_by: model.owned_by,
                parent: (model as any).parent,
                root: (model as any).root,
            }));

        } catch (error) {
            throw new Error(`Failed to list fine-tuned models: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Delete a fine-tuned model
     */
    async deleteModel(modelId: string): Promise<boolean> {
        try {
            if (!modelId.startsWith('ft:')) {
                throw new Error('Can only delete fine-tuned models (those starting with "ft:")');
            }

            const response = await this.client.models.del(modelId);
            return response.deleted;

        } catch (error) {
            throw new Error(`Failed to delete model: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get estimated training cost
     */
    getEstimatedCost(trainingTokens: number, model: string = 'gpt-4o-mini'): number {
        // OpenAI pricing per 1K tokens (as of 2024)
        const costPer1KTokens = model.includes('gpt-4o-mini') ? 0.008 : 0.008; // $8 per 1M tokens
        return (trainingTokens / 1000) * costPer1KTokens;
    }

    /**
     * Validate that a model supports fine-tuning
     */
    isValidBaseModel(model: string): boolean {
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

        // Also allow existing fine-tuned models
        return supportedModels.includes(model) || model.startsWith('ft:');
    }
}
