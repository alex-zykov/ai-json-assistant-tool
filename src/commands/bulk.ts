// src/commands/bulk.ts

import chalk from 'chalk';
import path from 'path';
import fs from 'fs/promises';
import dotenv from 'dotenv';
import { AIProviderFactory } from '../ai/provider-factory';
import { MessageGlobal } from '../models/types';
import { s } from 'ajv-ts';
import { loadJSON, loadPrompt, selectModelInteractively } from "../utils/utils";

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '.env') });

interface BulkOptions {
    model: string;
    config: string;
    schema: string;
    prompt: string;
    rows: number;
    skip: number;
}

export async function setupBulkCommand(program: any) {
    program
        .command('bulk')
        .description('Process multiple inputs from a file, one per line')
        .option(
            '-m, --model <model>',
            'Model to use (run "ai-json models" to see available models)'
        )
        .option(
            '-s, --schema <path>',
            'Path to schema.json containing schema definition (optional for unstructured output)'
        )
        .option(
            '-p, --prompt <path>',
            'Path to prompt file (.json, .md, .txt, or no extension)',
            process.env.PROMPT_PATH || path.join(process.cwd(), 'prompt.md')
        )
        .option(
            '-k, --skip <skip>',
            'Number of rows to skip, default 0',
            (value: any) => parseInt(value),
            0
        )
        .option(
            '-r, --rows <rows>',
            'Number of rows to process, 0 for all',
            (value: any) => parseInt(value),
            0
        )
        .argument(
            '[inputPath]',
            'Path to input file with one query per line',
            'input.txt'
        )
        .addHelpText('after', `
Environment Variables:
  You can set defaults using environment variables:
    AI_MODEL=gpt-4o-mini
    SCHEMA_PATH=./schema.json
    PROMPT_PATH=./prompt.md

Examples:
  Process all lines with environment defaults:
    $ ai-json bulk input.txt
  
  Process first 10 lines with custom model:
    $ ai-json bulk -m claude-3-opus-latest --rows 10 input.txt
  
  Skip first 5 lines, process next 20:
    $ ai-json bulk --skip 5 --rows 20 input.txt
  
  Use custom configuration files:
    $ ai-json bulk -s ./custom-schema.json input.txt

Input File Format:
  Create a text file with one query per line:
    What should I eat for lunch?
    How is the weather today?
    Generate a creative story about cats
        `)
        .action(async (inputPath: string, options: BulkOptions) => {
            // Determine schema path
            const schemaPath = options.schema || process.env.SCHEMA_PATH;
            
            try {
                // Check if model was provided, if not, use interactive selection
                if (!options.model && !process.env.AI_MODEL) {
                    options.model = await selectModelInteractively();
                } else if (!options.model) {
                    options.model = process.env.AI_MODEL || 'gpt-4o-mini';
                }

                // Show configuration source
                console.log(chalk.blue('\nConfiguration:'));
                console.log(chalk.cyan('├─ Model:     '), chalk.yellow(options.model),
                    options.model === process.env.AI_MODEL ? chalk.gray('(from env)') :
                    options.model ? chalk.gray('(interactive/args)') : chalk.gray('(default)'));
                console.log(chalk.cyan('├─ Schema:    '), schemaPath ? chalk.green(schemaPath) : chalk.gray('none (unstructured)'),
                    options.schema ? chalk.gray('(from args)') : schemaPath ? chalk.gray('(from env)') : '');
                console.log(chalk.cyan('├─ Prompt:    '), chalk.green(options.prompt),
                    options.prompt === (process.env.PROMPT_PATH || path.join(process.cwd(), 'prompt.md')) ? chalk.gray('(from env)') : chalk.gray('(from args)'));
                console.log(chalk.cyan('├─ Input:     '), chalk.green(inputPath));
                console.log(chalk.cyan('├─ Skip:      '), chalk.yellow(options.skip), 'rows');
                console.log(chalk.cyan('└─ Process:   '), chalk.yellow(options.rows || 'all'), 'rows');

                console.log(chalk.blue('\nInitializing bulk processing...'));

                // Validate model name first (try async, fallback to static)
                try {
                    const isValid = await AIProviderFactory.validateModelAsync(options.model);
                    if (!isValid) {
                        throw new Error(`Invalid model name: ${options.model}`);
                    }
                } catch (error) {
                    // Fallback to static validation
                    if (!AIProviderFactory.isValidModel(options.model)) {
                        console.error(chalk.red(`Invalid model name: ${options.model}`));
                        console.log(chalk.yellow('Available models:'));

                        try {
                            const models = await AIProviderFactory.getAllModelsAsync();
                            models.slice(0, 10).forEach(model => {
                                console.log(chalk.cyan(`  ${model.id} (${model.provider})`));
                            });
                            if (models.length > 10) {
                                console.log(chalk.gray(`  ... and ${models.length - 10} more (run "ai-json models" for full list)`));
                            }
                        } catch {
                            // Final fallback to static list
                            console.log(chalk.cyan('  Unable to load models. Please check your configuration.'));
                        }

                        process.exit(1);
                    }
                }

                // Setup provider
                const provider = await AIProviderFactory.getProviderTypeForModelAsync(options.model);
                console.log(chalk.magenta(' – Using'), chalk.red(provider), chalk.magenta('provider with model'), chalk.red(options.model));

                // Load configuration
                const factory = new AIProviderFactory();

                // Load schema (optional)
                let schema: s.Object | undefined;
                if (schemaPath) {
                    const schemaData = await loadJSON<any>(schemaPath);
                    if (!schemaData['type'] || schemaData['type'] !== 'object' || !schemaData['properties']) {
                        throw new Error(`Invalid schema format: ${schemaPath}`);
                    }
                    schema = s.object();
                    schema.schema = schemaData;
                }

                // Load prompt
                const prompt = await loadPrompt(options.prompt);

                // Read input file
                console.log(chalk.blue('Reading input file...'));
                const fileContent = await fs.readFile(inputPath, 'utf-8');
                let inputs = fileContent.split('\n').filter(line => line.trim());

                // Apply skip and rows limits
                if (options.rows > 0 || options.skip > 0) {
                    const skip = Number(options.skip);
                    const rows = Number(options.rows);
                    const end = rows > 0 ? skip + rows : undefined;
                    inputs = inputs.slice(skip, end);
                }

                console.log(chalk.magenta(` – Loaded ${inputs.length} queries from`), chalk.green(inputPath));

                if (options.skip > 0) {
                    console.log(chalk.yellow(` – Skipped first ${options.skip} rows`));
                }

                // Process inputs
                console.log(chalk.blue('\nProcessing queries...\n'));
                const providerInstance = factory.createProvider(provider);

                let totalTime = 0;
                let totalCost = 0;
                let successCount = 0;
                let failCount = 0;

                for (const [index, input] of inputs.entries()) {
                    try {
                        console.log(chalk.yellow(`Query ${index + 1}/${inputs.length}:`));
                        console.log(chalk.cyan('Input:'), input);

                        // Add 3 second delay between requests to avoid rate limits
                        if (index > 0) {
                            await new Promise(resolve => setTimeout(resolve, 3000));
                        }

                        const startTime = Date.now();
                        const result = await providerInstance.run(options.model, prompt, schema, input);
                        const timeElapsed = Date.now() - startTime;

                        console.log(chalk.cyan('Output:'), result.isStructured ? JSON.stringify(result.data, null, 2) : result.data);
                        console.log(chalk.gray('Time:'), `${(timeElapsed / 1000).toFixed(2)}s`);
                        console.log(chalk.gray('Cost:'), `$${result.metrics.estimatedCost.toFixed(6)}`);
                        console.log(chalk.green('Status:'), '✅ Success');
                        console.log(chalk.gray('─'.repeat(80)), '\n');

                        totalTime += timeElapsed;
                        totalCost += result.metrics.estimatedCost;
                        successCount++;

                    } catch (error) {
                        console.error(chalk.red(`Error processing query ${index + 1}:`), error);
                        console.log(chalk.red('Status:'), '❌ Failed');
                        console.log(chalk.gray('─'.repeat(80)), '\n');
                        failCount++;
                    }
                }

                // Display summary
                const averageTime = totalTime / inputs.length;
                const averageCost = totalCost / inputs.length;

                console.log(chalk.green('\n📊 Processing Summary:'));
                console.log(chalk.cyan('├─ Total Queries:     '), inputs.length);
                console.log(chalk.cyan('├─ Successful:        '), chalk.green(successCount));
                console.log(chalk.cyan('├─ Failed:            '), chalk.red(failCount));
                console.log(chalk.cyan('├─ Success Rate:      '), `${((successCount / inputs.length) * 100).toFixed(1)}%`);
                console.log(chalk.cyan('├─ Average Time:      '), `${(averageTime / 1000).toFixed(2)}s`);
                console.log(chalk.cyan('├─ Total Cost:        '), `$${totalCost.toFixed(6)}`);
                console.log(chalk.cyan('└─ Average Cost:      '), `$${averageCost.toFixed(6)}`);

                // Monthly projection
                const monthlyProjection = averageCost * 150000; // 1000 users * 5 requests * 30 days
                console.log(chalk.magenta('\n💰 Monthly Cost Projection:'));
                console.log(chalk.magenta('1000 users x 5 requests per day x 30 days:'), `$${monthlyProjection.toFixed(6)}`);

            } catch (error) {
                console.error(chalk.red('\nError:'), error instanceof Error ? error.message : 'Unknown error');

                // Provide helpful hints for common errors
                if (error instanceof Error) {
                    if (error.message.includes('ENOENT')) {
                        if (schemaPath && error.message.includes(schemaPath)) {
                            console.log(chalk.yellow(`\nSchema file not found: ${schemaPath}`));
                            console.log(chalk.cyan('Set SCHEMA_PATH environment variable or use -s option'));
                        } else if (error.message.includes(options.prompt)) {
                            console.log(chalk.yellow(`\nPrompt file not found: ${options.prompt}`));
                            console.log(chalk.cyan('Set PROMPT_PATH environment variable or use -p option'));
                        } else {
                            console.log(chalk.yellow(`\nInput file not found: ${inputPath}`));
                            console.log(chalk.cyan('Make sure the input file exists and contains one query per line'));
                        }
                    }
                }

                process.exit(1);
            }
        });
}
