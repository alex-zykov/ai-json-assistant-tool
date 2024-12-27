// src/commands/fine-tune.ts

import { Command } from "commander";
import chalk from "chalk";
import { OpenAIFineTuningService } from "../ai/openai-fine-tuning";

export function setupFineTuneCommand(program: Command) {
    const fineTuneCmd = program
        .command('fine-tune')
        .description('Manage OpenAI fine-tuned models')
        .addHelpText('after', `
Examples:
  Create a fine-tuned model:
    $ ai-json fine-tune create

  Override specific options:
    $ ai-json fine-tune create --model gpt-4o-mini --suffix "production" --epochs 5

  Use different training file:
    $ ai-json fine-tune create --file ./my-training.jsonl --suffix "v2"

  List fine-tuned models:
    $ ai-json fine-tune list

  List fine-tuning jobs:
    $ ai-json fine-tune list --jobs

  Delete a fine-tuned model:
    $ ai-json fine-tune delete ft:gpt-4o-mini:org:model:id

Environment Variables (for create command):
  FINE_TUNE_BASE_MODEL     - Base model (default: gpt-4o-mini)
  FINE_TUNE_SUFFIX         - Model suffix (default: custom)
  FINE_TUNE_TRAINING_FILE  - Training file (default: training.jsonl)
  FINE_TUNE_EPOCHS         - Training epochs (default: 3)
  FINE_TUNE_BATCH_SIZE     - Batch size (optional)
  FINE_TUNE_LEARNING_RATE  - Learning rate (optional)
  FINE_TUNE_VALIDATION_FILE - Validation file (optional)
        `);

    // Create subcommand
    fineTuneCmd
        .command('create')
        .description('Create a new fine-tuned model')
        .option(
            '-m, --model <model>',
            'Base model to fine-tune',
            process.env.FINE_TUNE_BASE_MODEL || 'gpt-4o-mini'
        )
        .option(
            '-s, --suffix <suffix>',
            'Model suffix',
            process.env.FINE_TUNE_SUFFIX || 'custom'
        )
        .option(
            '-f, --file <file>',
            'Training JSONL file path',
            process.env.FINE_TUNE_TRAINING_FILE || 'training.jsonl'
        )
        .option(
            '-e, --epochs <epochs>',
            'Number of training epochs',
            (value) => parseInt(value),
            parseInt(process.env.FINE_TUNE_EPOCHS || '3')
        )
        .option(
            '--batch-size <size>',
            'Training batch size',
            (value) => parseInt(value),
            process.env.FINE_TUNE_BATCH_SIZE ? parseInt(process.env.FINE_TUNE_BATCH_SIZE) : undefined
        )
        .option(
            '--learning-rate <rate>',
            'Learning rate multiplier',
            (value) => parseFloat(value),
            process.env.FINE_TUNE_LEARNING_RATE ? parseFloat(process.env.FINE_TUNE_LEARNING_RATE) : undefined
        )
        .option(
            '--validation-file <file>',
            'Validation JSONL file path',
            process.env.FINE_TUNE_VALIDATION_FILE
        )
        .action(async (options) => {
            try {
                console.log(chalk.blue('\n🔥 OpenAI Fine-Tuning'));
                console.log(chalk.cyan('├─ Base Model:     '), chalk.yellow(options.model));
                console.log(chalk.cyan('├─ Training File:  '), chalk.green(options.file));
                console.log(chalk.cyan('├─ Suffix:         '), chalk.yellow(options.suffix));
                console.log(chalk.cyan('├─ Epochs:         '), chalk.yellow(options.epochs));

                if (options.batchSize) {
                    console.log(chalk.cyan('├─ Batch Size:     '), chalk.yellow(options.batchSize));
                }

                if (options.learningRate) {
                    console.log(chalk.cyan('├─ Learning Rate:  '), chalk.yellow(options.learningRate));
                }

                if (options.validationFile) {
                    console.log(chalk.cyan('├─ Validation:     '), chalk.green(options.validationFile));
                }

                console.log(chalk.cyan('└─ Mode:           '), chalk.yellow('Wait for completion'));

                // Initialize fine-tuning service
                const fineTuningService = new OpenAIFineTuningService();

                // Check if a model with this suffix already exists
                console.log(chalk.blue('\nChecking for existing model...'));
                try {
                    const existingModelId = await fineTuningService.findModelBySuffix(options.suffix);
                    if (existingModelId) {
                        console.log(chalk.yellow(' ⚠ Found existing model:'), chalk.gray(existingModelId));
                        console.log(chalk.yellow(' ⚠ This will be replaced by the new model'));
                    }
                } catch (error) {
                    console.log(chalk.gray(' – No existing model found with suffix'), chalk.gray(options.suffix));
                }

                // Validate and upload training file
                console.log(chalk.blue('\nValidating training data...'));
                const trainingFileId = await fineTuningService.prepareAndUploadTrainingFile(options.file);
                console.log(chalk.green(' ✓ Training file uploaded:'), chalk.gray(trainingFileId));

                // Upload validation file if provided
                let validationFileId: string | undefined;
                if (options.validationFile) {
                    console.log(chalk.blue('Uploading validation file...'));
                    validationFileId = await fineTuningService.uploadFile(options.validationFile);
                    console.log(chalk.green(' ✓ Validation file uploaded:'), chalk.gray(validationFileId));
                }

                // Create fine-tuning job
                console.log(chalk.blue('\nCreating fine-tuning job...'));
                const job = await fineTuningService.createFineTuningJob({
                    model: options.model,
                    trainingFile: trainingFileId,
                    validationFile: validationFileId,
                    suffix: options.suffix,
                    hyperparameters: {
                        n_epochs: options.epochs,
                        batch_size: options.batchSize,
                        learning_rate_multiplier: options.learningRate
                    }
                });

                console.log(chalk.green(' ✓ Fine-tuning job created!'));
                console.log(chalk.cyan('Job ID:'), chalk.yellow(job.id));
                console.log(chalk.cyan('Status:'), chalk.yellow(job.status));

                // Always wait for completion
                console.log(chalk.blue('\nWaiting for fine-tuning to complete...'));
                console.log(chalk.gray('This may take 10-30 minutes depending on data size.'));

                const completedJob = await fineTuningService.waitForCompletion(job.id);

                if (completedJob.status === 'succeeded') {
                    console.log(chalk.green('\n🎉 Fine-tuning completed successfully!'));
                    console.log(chalk.cyan('New Model ID:'), chalk.yellow(completedJob.fine_tuned_model));

                    if (completedJob.trained_tokens) {
                        const estimatedCost = (completedJob.trained_tokens / 1000) * 0.008; // $8 per 1M tokens for gpt-4o-mini
                        console.log(chalk.cyan('Training Cost:'), chalk.yellow(`~$${estimatedCost.toFixed(4)}`));
                    }

                    // Automatically update environment suggestion
                    console.log(chalk.blue('\n🔄 Model Ready!'));
                    console.log(chalk.cyan('To use the new model, update your environment:'));
                    console.log(chalk.yellow(`export AI_MODEL=${completedJob.fine_tuned_model}`));

                    console.log(chalk.cyan('\nQuick test:'));
                    console.log(chalk.gray(`ai-json ask "Test question" --model ${completedJob.fine_tuned_model}`));

                    console.log(chalk.cyan('Run evaluation:'));
                    console.log(chalk.gray(`ai-json test test.jsonl --model ${completedJob.fine_tuned_model}`));

                } else {
                    console.log(chalk.red('\n❌ Fine-tuning failed!'));
                    console.log(chalk.cyan('Status:'), chalk.red(completedJob.status));

                    // Show error details if available
                    if (completedJob.error) {
                        console.log(chalk.cyan('Error:'), chalk.red(completedJob.error));
                    }

                    // Show common troubleshooting tips
                    console.log(chalk.yellow('\nCommon issues:'));
                    console.log(chalk.cyan('├─ Training data format (must be valid JSONL)'));
                    console.log(chalk.cyan('├─ Minimum 10 examples required'));
                    console.log(chalk.cyan('├─ Each line must have valid "messages" array'));
                    console.log(chalk.cyan('└─ JSON syntax errors in training data'));

                    process.exit(1);
                }

            } catch (error) {
                console.error(chalk.red('\nFine-tuning Error:'), error instanceof Error ? error.message : 'Unknown error');

                if (error instanceof Error) {
                    if (error.message.includes('ENOENT')) {
                        console.log(chalk.yellow('\nFile not found. Check your file paths:'));
                        console.log(chalk.cyan('Training file:'), chalk.gray(options.file));
                        if (options.validationFile) {
                            console.log(chalk.cyan('Validation file:'), chalk.gray(options.validationFile));
                        }
                    } else if (error.message.includes('training data')) {
                        console.log(chalk.yellow('\nTraining data validation failed. Check:'));
                        console.log(chalk.cyan('├─ File format (JSONL with messages array)'));
                        console.log(chalk.cyan('├─ Minimum 10 examples required'));
                        console.log(chalk.cyan('├─ Valid JSON structure on each line'));
                        console.log(chalk.cyan('└─ Proper message roles (system/user/assistant)'));
                    } else if (error.message.includes('API key')) {
                        console.log(chalk.yellow('\nOpenAI API authentication failed.'));
                        console.log(chalk.cyan('Make sure OPENAI_API_KEY environment variable is set.'));
                    } else if (error.message.includes('model')) {
                        console.log(chalk.yellow('\nInvalid base model. Supported models:'));
                        console.log(chalk.cyan('GPT-4.1:'));
                        console.log(chalk.cyan('├─ gpt-4.1-nano-2025-04-14'));
                        console.log(chalk.cyan('├─ gpt-4.1-mini-2025-04-14'));
                        console.log(chalk.cyan('├─ gpt-4.1-2025-04-14'));
                        console.log(chalk.cyan('GPT-4o:'));
                        console.log(chalk.cyan('├─ gpt-4o-mini-2024-07-18'));
                        console.log(chalk.cyan('├─ gpt-4o-2024-08-06'));
                        console.log(chalk.cyan('GPT-3.5:'));
                        console.log(chalk.cyan('├─ gpt-3.5-turbo-1106'));
                        console.log(chalk.cyan('└─ gpt-3.5-turbo-0125'));
                        console.log(chalk.gray('\nOr use existing fine-tuned model: ft:gpt-*:org:suffix:id'));
                    }
                }

                process.exit(1);
            }
        });

    // List subcommand
    fineTuneCmd
        .command('list')
        .description('List fine-tuned models')
        .option('--jobs', 'List fine-tuning jobs instead of models')
        .option('--limit <limit>', 'Limit number of results', (value) => parseInt(value), 10)
        .action(async (options) => {
            try {
                const fineTuningService = new OpenAIFineTuningService();

                if (options.jobs) {
                    console.log(chalk.blue('\n📋 Fine-tuning Jobs'));
                    const jobs = await fineTuningService.listJobs(options.limit);

                    if (jobs.length === 0) {
                        console.log(chalk.gray('No fine-tuning jobs found.'));
                        return;
                    }

                    for (const job of jobs) {
                        const statusColor = job.status === 'succeeded' ? chalk.green : 
                                          job.status === 'failed' ? chalk.red : 
                                          job.status === 'running' ? chalk.blue : chalk.yellow;
                        
                        console.log(`\n${chalk.cyan('Job ID:')} ${chalk.yellow(job.id)}`);
                        console.log(`${chalk.cyan('Status:')} ${statusColor(job.status)}`);
                        console.log(`${chalk.cyan('Model:')} ${chalk.gray(job.model)}`);
                        console.log(`${chalk.cyan('Created:')} ${chalk.gray(new Date(job.created_at * 1000).toISOString())}`);
                        
                        if (job.fine_tuned_model) {
                            console.log(`${chalk.cyan('Fine-tuned Model:')} ${chalk.green(job.fine_tuned_model)}`);
                        }
                        
                        if (job.trained_tokens) {
                            console.log(`${chalk.cyan('Trained Tokens:')} ${chalk.gray(job.trained_tokens.toLocaleString())}`);
                        }
                        
                        if (job.error) {
                            console.log(`${chalk.cyan('Error:')} ${chalk.red(job.error)}`);
                        }
                    }
                } else {
                    console.log(chalk.blue('\n📋 Fine-tuned Models'));
                    const models = await fineTuningService.listModels();

                    if (models.length === 0) {
                        console.log(chalk.gray('No fine-tuned models found.'));
                        return;
                    }

                    for (const model of models) {
                        console.log(`\n${chalk.cyan('Model ID:')} ${chalk.green(model.id)}`);
                        console.log(`${chalk.cyan('Created:')} ${chalk.gray(new Date(model.created * 1000).toISOString())}`);
                        console.log(`${chalk.cyan('Owned by:')} ${chalk.gray(model.owned_by)}`);
                        
                        if (model.parent) {
                            console.log(`${chalk.cyan('Base Model:')} ${chalk.gray(model.parent)}`);
                        }
                    }
                }

            } catch (error) {
                console.error(chalk.red('\nError listing:'), error instanceof Error ? error.message : 'Unknown error');
                process.exit(1);
            }
        });

    // Delete subcommand
    fineTuneCmd
        .command('delete <modelId>')
        .description('Delete a fine-tuned model')
        .action(async (modelId) => {
            try {
                if (!modelId.startsWith('ft:')) {
                    console.error(chalk.red('Error: Can only delete fine-tuned models (those starting with "ft:")'));
                    process.exit(1);
                }

                const fineTuningService = new OpenAIFineTuningService();

                console.log(chalk.blue('\nDeleting model...'));
                const deleted = await fineTuningService.deleteModel(modelId);

                if (deleted) {
                    console.log(chalk.green(`✓ Model ${modelId} deleted successfully.`));
                } else {
                    console.log(chalk.red(`✗ Failed to delete model ${modelId}.`));
                    process.exit(1);
                }

            } catch (error) {
                console.error(chalk.red('\nError deleting model:'), error instanceof Error ? error.message : 'Unknown error');
                process.exit(1);
            }
        });
}
