import { Command } from "commander";
import {AIProviderFactory} from "../ai/provider-factory";
import chalk from "chalk";
import { table } from "table";
import { ModelInfo } from "../models/types";

// Helper function to format models by provider (static - for fallback)
async function formatModelsList(): Promise<string> {
    try {
        const models = await AIProviderFactory.getAllModelsAsync(true);
        const modelsByProvider = models.reduce((acc, model) => {
            const provider = model.provider || 'unknown';
            if (!acc[provider]) acc[provider] = [];
            acc[provider].push(model.id);
            return acc;
        }, {} as Record<string, string[]>);

        const formatModels = (title: string, models: string[]): string => {
            return `${chalk.bold(title)}:\n${models.map(m => `  - ${m}`).join('\n')}`;
        };

        return Object.entries(modelsByProvider)
            .map(([provider, models]) => formatModels(
                `${provider.charAt(0).toUpperCase() + provider.slice(1)} Models`,
                models
            ))
            .join('\n\n');
    } catch (error) {
        return chalk.red('Unable to load models. Please check your configuration.');
    }
}

// Helper function to display models in a table format
function displayModelsTable(models: ModelInfo[], options: { showPricing?: boolean; showFeatures?: boolean } = {}): void {
    if (models.length === 0) {
        console.log(chalk.yellow('No models found.'));
        return;
    }

    // Prepare table headers
    const headers = ['Provider', 'Model ID', 'Display Name'];

    if (options.showPricing) {
        headers.push('Input ($/1K)', 'Output ($/1K)');
    }

    headers.push('Context', 'Features');

    // Prepare table data
    const tableData = models.map(model => {
        const row = [
            chalk.cyan(model.provider || 'unknown'),
            chalk.yellow(model.id),
            chalk.green(model.name || model.id)
        ];

        if (options.showPricing) {
            if (model.pricing) {
                row.push(
                    chalk.magenta(`$${model.pricing.input.toFixed(4)}`),
                    chalk.magenta(`$${model.pricing.output.toFixed(4)}`)
                );
            } else {
                row.push(chalk.gray('N/A'), chalk.gray('N/A'));
            }
        }

        // Context window
        if (model.contextWindow) {
            const contextStr = model.contextWindow >= 1000
                ? `${(model.contextWindow / 1000).toFixed(0)}K`
                : model.contextWindow.toString();
            row.push(chalk.blue(contextStr));
        } else {
            row.push(chalk.gray('N/A'));
        }

        // Features (first 3, truncated)
        if (model.supportedFeatures && model.supportedFeatures.length > 0) {
            const features = model.supportedFeatures.slice(0, 3);
            const featureStr = features.join(', ') + (model.supportedFeatures.length > 3 ? '...' : '');
            row.push(chalk.gray(featureStr));
        } else {
            row.push(chalk.gray('N/A'));
        }

        return row;
    });

    // Display table
    console.log(table([headers, ...tableData], {
        border: {
            topBody: '─',
            topJoin: '┬',
            topLeft: '┌',
            topRight: '┐',
            bottomBody: '─',
            bottomJoin: '┴',
            bottomLeft: '└',
            bottomRight: '┘',
            bodyLeft: '│',
            bodyRight: '│',
            bodyJoin: '│',
            joinBody: '─',
            joinLeft: '├',
            joinRight: '┤',
            joinJoin: '┼'
        }
    }));
}

// Helper function to display detailed model information
function displayDetailedModel(model: ModelInfo): void {
    console.log(chalk.blue('\n📋 Model Details:'));
    console.log(chalk.cyan('├─ ID:          '), chalk.yellow(model.id));
    console.log(chalk.cyan('├─ Name:        '), chalk.green(model.name || model.id));
    console.log(chalk.cyan('├─ Provider:    '), chalk.magenta(model.provider || 'unknown'));

    if (model.description) {
        console.log(chalk.cyan('├─ Description: '), chalk.white(model.description));
    }

    if (model.contextWindow) {
        const contextStr = model.contextWindow >= 1000
            ? `${(model.contextWindow / 1000).toFixed(0)}K tokens`
            : `${model.contextWindow} tokens`;
        console.log(chalk.cyan('├─ Context:     '), chalk.blue(contextStr));
    }

    if (model.maxOutput) {
        console.log(chalk.cyan('├─ Max Output:  '), chalk.blue(`${model.maxOutput} tokens`));
    }

    if (model.pricing) {
        console.log(chalk.cyan('├─ Pricing:     '),
            chalk.magenta(`$${model.pricing.input.toFixed(4)}/1K input, $${model.pricing.output.toFixed(4)}/1K output`));
    }

    if (model.supportedFeatures && model.supportedFeatures.length > 0) {
        console.log(chalk.cyan('├─ Features:    '), chalk.gray(model.supportedFeatures.join(', ')));
    }

    console.log(chalk.cyan('├─ Available:   '),
        model.availability === 'available' ? chalk.green('✓ Yes') :
            model.availability === 'limited' ? chalk.yellow('⚠ Limited') :
                chalk.red('✗ No'));

    if (model.deprecated) {
        console.log(chalk.cyan('└─ Status:      '), chalk.yellow('⚠ Deprecated'));
    } else {
        console.log(chalk.cyan('└─ Status:      '), chalk.green('✓ Active'));
    }
}

export function setupModelsCommand(program: Command) {
    program
        .command('models')
        .description('List all available AI models')
        .option('--provider <provider>', 'Filter by specific provider (openai, claude, mistral, llamaai)')
        .option('--json', 'Output as JSON', false)
        .option('--detailed <modelId>', 'Show detailed information for a specific model')
        .option('--pricing', 'Show pricing information in table', false)
        .option('--features', 'Show detailed features in table', false)
        .option('--cache-stats', 'Show cache statistics', false)
        .option('--static', 'Use static model list (no API calls)', false)
        .addHelpText('after', `
Examples:
  List all models dynamically:
    $ ai-json models

  Filter by provider:
    $ ai-json models --provider openai
    $ ai-json models --provider claude

  Show pricing information:
    $ ai-json models --pricing

  Get detailed info for a model:
    $ ai-json models --detailed gpt-4o

  Output as JSON:
    $ ai-json models --json

  Use static list only:
    $ ai-json models --static

Providers:
  openai   - OpenAI GPT models
  claude   - Anthropic Claude models  
  mistral  - Mistral AI models
  llamaai  - LlamaAI and Gemma models
        `)
        .action(async (options) => {
            try {
                // Show detailed model info if requested
                if (options.detailed) {
                    console.log(chalk.blue('Loading detailed model information...'));
                    try {
                        const modelInfo = await AIProviderFactory.getModelInfo(options.detailed, true);
                        if (modelInfo) {
                            displayDetailedModel(modelInfo);
                        } else {
                            console.log(chalk.red(`Model '${options.detailed}' not found.`));

                            // Suggest similar models
                            const allModels = await AIProviderFactory.getAllModelsAsync(true);
                            const similar = allModels.filter(m =>
                                m.id.toLowerCase().includes(options.detailed.toLowerCase()) ||
                                m.name.toLowerCase().includes(options.detailed.toLowerCase())
                            ).slice(0, 5);

                            if (similar.length > 0) {
                                console.log(chalk.yellow('\nSimilar models:'));
                                similar.forEach(model => {
                                    console.log(chalk.cyan(`  ${model.id} (${model.provider})`));
                                });
                            }
                        }
                    } catch (error) {
                        console.error(chalk.red('Error loading model details:'), error instanceof Error ? error.message : 'Unknown error');
                    }
                    return;
                }

                // Use static list if requested
                if (options.static) {
                    console.log(chalk.yellow('Using static model list (no API calls):\n'));
                    console.log(await formatModelsList());
                    try {
                        const models = await AIProviderFactory.getAllModelsAsync(true);
                        console.log(chalk.cyan(`\nTotal available models: ${models.length}`));
                    } catch {
                        console.log(chalk.red('\nUnable to get model count'));
                    }
                    return;
                }

                // Dynamic model loading
                console.log(chalk.blue('Loading models from providers...'));

                let models: ModelInfo[];

                try {
                    if (options.provider) {
                        // Validate provider
                        const validProviders = ['openai', 'claude', 'mistral', 'llamaai'];
                        if (!validProviders.includes(options.provider)) {
                            console.error(chalk.red(`Invalid provider: ${options.provider}`));
                            console.log(chalk.yellow('Valid providers:'), validProviders.join(', '));
                            process.exit(1);
                        }

                        models = await AIProviderFactory.getModelsForProvider(options.provider as any, true);
                    } else {
                        models = await AIProviderFactory.getAllModelsAsync(true);
                    }
                } catch (error) {
                    console.error(chalk.red('Error loading models:'), error instanceof Error ? error.message : 'Unknown error');
                    console.log(chalk.yellow('Falling back to static model list...'));

                    // Fallback: try to load models again without caching
                    try {
                        models = await AIProviderFactory.getAllModelsAsync(true);
                        if (options.provider) {
                            models = models.filter(m => m.provider === options.provider);
                        }
                    } catch (fallbackError) {
                        console.error(chalk.red('All model loading attempts failed'));
                        process.exit(1);
                    }
                }

                // Filter models if provider specified
                let filteredModels = models;
                if (options.provider) {
                    filteredModels = models.filter(m => m.provider === options.provider);
                }

                // Sort models by provider, then by name
                filteredModels.sort((a, b) => {
                    if (a.provider !== b.provider) {
                        return (a.provider || '').localeCompare(b.provider || '');
                    }
                    return a.id.localeCompare(b.id);
                });

                // Output format
                if (options.json) {
                    console.log(JSON.stringify({
                        models: filteredModels,
                        total: filteredModels.length,
                        timestamp: new Date().toISOString(),
                        provider: options.provider || 'all'
                    }, null, 2));
                    return;
                }

                // Display formatted output
                if (filteredModels.length === 0) {
                    console.log(chalk.yellow('No models found.'));
                    return;
                }

                console.log(chalk.green(`\n✅ Found ${filteredModels.length} model(s)${options.provider ? ` from ${options.provider}` : ''}:\n`));

                displayModelsTable(filteredModels, {
                    showPricing: options.pricing,
                    showFeatures: options.features
                });

                // Summary statistics
                const providerCounts = filteredModels.reduce((acc, model) => {
                    const provider = model.provider || 'unknown';
                    acc[provider] = (acc[provider] || 0) + 1;
                    return acc;
                }, {} as Record<string, number>);

                console.log(chalk.blue('\n📊 Summary:'));
                console.log(chalk.cyan('├─ Total Models: '), chalk.yellow(filteredModels.length));
                Object.entries(providerCounts).forEach(([provider, count], index, array) => {
                    const isLast = index === array.length - 1;
                    const prefix = isLast ? '└─' : '├─';
                    console.log(chalk.cyan(`${prefix} ${provider}: `), chalk.yellow(count));
                });

                // Additional help
                console.log(chalk.gray('\n💡 Use --detailed <modelId> for more information about a specific model'));

            } catch (error) {
                console.error(chalk.red('\nFatal Error:'), error instanceof Error ? error.message : 'Unknown error');
                console.log(chalk.yellow('\nTrying static fallback...'));

                try {
                    console.log(await formatModelsList());
                } catch (staticError) {
                    console.error(chalk.red('All fallback attempts failed:'), staticError);
                    process.exit(1);
                }
            }
        });
}
