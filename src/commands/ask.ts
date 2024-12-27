import { Command } from "commander";
import path from "path";
import chalk from "chalk";
import dotenv from 'dotenv';
import {AIProviderFactory} from "../ai/provider-factory";
import {s} from "ajv-ts";
import {InvalidModelError, JSONParseError, MessageGlobal, NetworkError, SchemaValidationError} from "../models/types";
import {loadJSON, loadPrompt, selectModelInteractively} from "../utils/utils";

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '.env') });

export function setupAskCommand(program: Command) {
    program
        .command('ask')
        .description('Make a single request to the model and get the structured JSON response')
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
        .argument(
            '[text...]',
            'Text to send to the model (multiple words will be joined)',
            ['Please', 'generate', 'JSON', 'based', 'on', 'the', 'schema.']
        )
        .addHelpText('after', `
Environment Variables:
  You can set defaults using environment variables:
    AI_MODEL=gpt-4o-mini
    SCHEMA_PATH=./schema.json  # Optional
    PROMPT_PATH=./prompt.md

File Formats:
  schema.json - Contains JSON schema definition
  prompt files - Support multiple formats:
    .json - Array of messages: [{"role": "system", "content": "..."}]
    .md/.txt - Plain text (automatically converted to system message)
    no extension - Treated as plain text

Examples:
  Basic usage (uses environment defaults):
    $ ai-json ask "What should I eat for lunch?"
  
  Override model:
    $ ai-json ask -m claude-3-opus-latest "Generate a story"
  
  Custom files:
    $ ai-json ask -s ./user-schema.json "Analyze data"
        `)
        .action(async (textArgs, options) => {
            // Join multiple text arguments into a single string
            const text = Array.isArray(textArgs) ? textArgs.join(' ') : textArgs;
            
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
                console.log(chalk.cyan('├─ Model:  '), chalk.yellow(options.model),
                    options.model === process.env.AI_MODEL ? chalk.gray('(from env)') :
                    options.model ? chalk.gray('(interactive/args)') : chalk.gray('(default)'));
                console.log(chalk.cyan('├─ Schema: '), schemaPath ? chalk.green(schemaPath) : chalk.gray('none (unstructured)'),
                    options.schema ? chalk.gray('(from args)') : schemaPath ? chalk.gray('(from env)') : '');
                console.log(chalk.cyan('└─ Prompt: '), chalk.green(options.prompt),
                    options.prompt === (process.env.PROMPT_PATH || path.join(process.cwd(), 'prompt.md')) ? chalk.gray('(from env)') : chalk.gray('(from args)'));

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

                // Get provider info for the selected model
                const provider = await AIProviderFactory.getProviderTypeForModelAsync(options.model);
                console.log(chalk.magenta('\nUsing'), chalk.red(provider), chalk.magenta('provider with model'), chalk.red(options.model));

                // Load and process configuration
                console.log(chalk.blue('Loading configuration...'));
                const factory = new AIProviderFactory();

                // Load schema (optional)
                let schema: s.Object | undefined;
                if (schemaPath) {
                    console.log(chalk.blue('Loading schema...'));
                    const schemaData = await loadJSON<any>(schemaPath);
                    if (!schemaData['type'] || schemaData['type'] !== 'object' || !schemaData['properties']) {
                        throw new Error(`Invalid schema format: ${schemaPath}. Schema must be an object type.`);
                    } else {
                        const propertiesKeys = Object.keys(schemaData['properties']).join(', ');
                        console.log(chalk.magenta(' – Schema loaded successfully properties:'), chalk.green(propertiesKeys));
                    }
                    schema = s.object()
                    schema.schema = schemaData
                } else {
                    console.log(chalk.blue('No schema provided - using unstructured output'));
                }

                // Load prompt
                console.log(chalk.blue('Loading prompt...'));
                const prompt = await loadPrompt(options.prompt);
                const promptKeys = prompt.map(p => p.role).join(', ');
                console.log(chalk.magenta(' – Prompt loaded successfully messages:'), chalk.green(promptKeys));

                // Create provider and run
                console.log(`${chalk.blue('\nRunning "')}${chalk.green(text)}${chalk.blue('" on ')}${chalk.red(options.model)}${chalk.blue('...')}`);
                const providerInstance = factory.createProvider(provider);
                try {
                    const result = await providerInstance.run(options.model, prompt, schema, text);

                    // Print the data result
                    console.log(chalk.green('\n🎯 Response Data:'));
                    if (result.isStructured) {
                        console.log(JSON.stringify(result.data, null, 2));
                    } else {
                        console.log(result.data);
                    }

                    // Token usage breakdown
                    console.log(chalk.yellow('\n📝 Token Usage:'));
                    console.log(chalk.yellow('├─ Prompt:    '), result.metrics.promptTokens.toLocaleString(), 'tokens');
                    console.log(chalk.yellow('├─ Completion:'), result.metrics.completionTokens.toLocaleString(), 'tokens');
                    console.log(chalk.yellow('└─ Total:     '), result.metrics.totalTokens.toLocaleString(), 'tokens');

                    // Print the metrics
                    console.log(chalk.blue('\n📊 Request Metrics:'));
                    console.log(chalk.cyan('Time Elapsed:'), `${(result.metrics.timeElapsed / 1000).toFixed(2)}s`);
                    console.log(chalk.cyan('Cost:'), `$${result.metrics.estimatedCost.toFixed(6)}`, chalk.cyan('total'));

                    console.log(chalk.magenta('\n💰 Cost Analysis:'));
                    const costPer1K = (result.metrics.estimatedCost / result.metrics.totalTokens) * 1000;
                    console.log(chalk.magenta('Rate:'), `$${costPer1K.toFixed(6)}`, chalk.magenta('per 1K tokens'));
                    console.log(chalk.magenta('1000 users x 5 request per day x 30 days:'), `$${(result.metrics.estimatedCost * 150000).toFixed(6)}`);

                } catch (error) {
                    if (error instanceof InvalidModelError) {
                        console.log(chalk.red('\n❌ Invalid model:'));
                        console.log(error.message);
                    } else if (error instanceof NetworkError) {
                        console.log(chalk.red('\n🌐 Network error:'));
                        console.log(error.message);
                    } else if (error instanceof JSONParseError) {
                        console.log(chalk.red('\n🔧 JSON parse error:'));
                        console.log(error.message);
                        console.log(chalk.red('\nRaw response:'));
                        console.log(error.responseBody);
                    } else if (error instanceof SchemaValidationError) {
                        console.log(chalk.red('\n📋 Schema validation error:'));
                        console.log(error.message);
                        console.log(chalk.red('\nInvalid JSON:'));
                        console.log(error.responseBody);
                    } else {
                        console.log(chalk.red('\n⚠️ Unexpected error:'));
                        console.error(error);
                    }
                    process.exit(1);
                }

            } catch (error) {
                console.error(chalk.red('\nError:'), error instanceof Error ? error.message : 'Unknown error');

                // Provide helpful hints for common errors
                if (error instanceof Error) {
                    if (error.message.includes('ENOENT')) {
                        console.log(chalk.yellow('\nFile not found. Make sure these files exist:'));
                        if (schemaPath) console.log(chalk.cyan(`  Schema: ${schemaPath}`));
                        console.log(chalk.cyan(`  Prompt: ${options.prompt}`));
                        console.log(chalk.yellow('\nOr set different paths using environment variables or command options.'));
                    }
                }

                process.exit(1);
            }
        });

}
