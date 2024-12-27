import { Command } from "commander";
import chalk from "chalk";
import path from "path";
import fs from 'fs/promises';
import dotenv from 'dotenv';
import { AIProviderFactory } from "../ai/provider-factory";

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '.env') });

export function setupEnvCommand(program: Command) {
    program
        .command('env')
        .description('Show current environment configuration and validate settings')
        .option('-v, --validate', 'Validate that all configuration is properly set', false)
        .option('-c, --config', 'Show detailed provider configuration', false)
        .addHelpText('after', `
Examples:
  Show current environment configuration:
    $ ai-json env
  
  Validate all settings and files:
    $ ai-json env --validate

  Show detailed provider configuration:
    $ ai-json env --config

Environment Variables:
  Required API Keys:
    OPENAI_API_KEY       - OpenAI API key
    ANTHROPIC_API_KEY    - Anthropic (Claude) API key  
    MISTRAL_API_KEY      - Mistral AI API key
    LLAMAAI_API_KEY      - LlamaAI API key

  Provider Configuration:
    OPENAI_TEMPERATURE   - OpenAI temperature (0-2, default: 0.7)
    OPENAI_MAX_TOKENS    - OpenAI max tokens (default: 2048)
    CLAUDE_MAX_TOKENS    - Claude max tokens (default: 2048)
    MISTRAL_TEMPERATURE  - Mistral temperature (0-2, default: 0.7)
    ... and more (run with --config for full list)

  Application Settings:
    AI_MODEL            - Default model to use
    SCHEMA_PATH         - Path to schema.json file (optional for unstructured output)
    PROMPT_PATH         - Path to prompt file (.json, .md, .txt, etc.)
    PORT                - Server port (server mode only)
    CORS_ORIGINS        - CORS origins (server mode only)
        `)
        .action(async (options) => {
            try {
                console.log(chalk.blue('\n🔧 AI-JSON Environment Configuration\n'));

                // API Keys validation
                console.log(chalk.blue('🔑 API Keys Status:\n'));
                const apiKeys = [
                    { name: 'OPENAI_API_KEY', value: process.env.OPENAI_API_KEY, provider: 'OpenAI' },
                    { name: 'ANTHROPIC_API_KEY', value: process.env.ANTHROPIC_API_KEY, provider: 'Claude' },
                    { name: 'MISTRAL_API_KEY', value: process.env.MISTRAL_API_KEY, provider: 'Mistral' },
                    { name: 'LLAMAAI_API_KEY', value: process.env.LLAMAAI_API_KEY, provider: 'LlamaAI' }
                ];

                apiKeys.forEach(key => {
                    const isSet = !!key.value;
                    const status = isSet ? chalk.green('✓ Set') : chalk.red('✗ Missing');
                    const value = isSet ? chalk.gray('(hidden)') : chalk.red('(not set)');
                    console.log(chalk.cyan(`${key.provider.padEnd(10)}`), status, value);
                });

                // Application Configuration
                console.log(chalk.blue('\n⚙️ Application Configuration:\n'));
                const appConfig = {
                    AI_MODEL: process.env.AI_MODEL || 'gpt-4o-mini',
                    SCHEMA_PATH: process.env.SCHEMA_PATH || 'none (unstructured output)',
                    PROMPT_PATH: process.env.PROMPT_PATH || path.join(process.cwd(), 'prompt.md'),
                };

                Object.entries(appConfig).forEach(([key, value]) => {
                    const isFromEnv = process.env[key] !== undefined;
                    const source = isFromEnv ? chalk.green('(env)') : chalk.gray('(default)');
                    console.log(chalk.cyan(`${key.padEnd(15)}`), chalk.yellow(value), source);
                });

                // Server Configuration (only if relevant env vars are set)
                const serverVars = ['PORT', 'CORS_ORIGINS', 'RATE_LIMIT_WINDOW', 'RATE_LIMIT_MAX'];
                const hasServerConfig = serverVars.some(varName => process.env[varName]);

                if (hasServerConfig || options.validate) {
                    console.log(chalk.blue('\n🌐 Server Configuration:\n'));
                    const serverConfig = {
                        PORT: process.env.PORT || '3000',
                        CORS_ORIGINS: process.env.CORS_ORIGINS || '*',
                        RATE_LIMIT_WINDOW: process.env.RATE_LIMIT_WINDOW || '900000',
                        RATE_LIMIT_MAX: process.env.RATE_LIMIT_MAX || '100'
                    };

                    Object.entries(serverConfig).forEach(([key, value]) => {
                        const isFromEnv = process.env[key] !== undefined;
                        const source = isFromEnv ? chalk.green('(env)') : chalk.gray('(default)');
                        console.log(chalk.cyan(`${key.padEnd(20)}`), chalk.yellow(value), source);
                    });
                }

                // Detailed provider configuration
                if (options.config) {
                    console.log(chalk.blue('\n🤖 Provider Configuration:\n'));
                    const providerConfig = AIProviderFactory.getCurrentConfig();

                    Object.entries(providerConfig).forEach(([provider, settings]) => {
                        console.log(chalk.magenta(`${provider.toUpperCase()}:`));
                        Object.entries(settings).forEach(([key, value]) => {
                            if (value !== undefined && value !== '') {
                                const displayValue = key.includes('apiKey') ? '***' : value;
                                const isFromEnv = process.env[`${provider.toUpperCase()}_${key.toUpperCase()}`] ||
                                    process.env[`${provider === 'llamaai' ? 'LLAMAAI' : provider.toUpperCase()}_API_KEY`];
                                const source = isFromEnv ? chalk.green('(env)') : chalk.gray('(default)');
                                console.log(chalk.cyan(`  ${key.padEnd(18)}`), chalk.yellow(displayValue), source);
                            }
                        });
                        console.log();
                    });
                }

                // Model validation
                console.log(chalk.blue('🤖 Model Validation:\n'));
                const currentModel = process.env.AI_MODEL || 'gpt-4o-mini';
                if (AIProviderFactory.isValidModel(currentModel)) {
                    const provider = AIProviderFactory.getProviderTypeForModel(currentModel);
                    console.log(chalk.green('✓'), chalk.cyan('Model:'), chalk.yellow(currentModel),
                        chalk.gray(`(${provider} provider)`));
                } else {
                    console.log(chalk.red('✗'), chalk.cyan('Model:'), chalk.red(currentModel),
                        chalk.red('(invalid)'));
                    console.log(chalk.yellow('\nAvailable models:'));
                    try {
                        const models = await AIProviderFactory.getAllModelsAsync();
                        models.slice(0, 10).forEach(model => {
                            console.log(chalk.cyan(`  ${model.id} (${model.provider})`));
                        });
                        if (models.length > 10) {
                            console.log(chalk.gray(`  ... and ${models.length - 10} more (run "ai-json models" to see all)`));
                        }
                    } catch {
                        console.log(chalk.cyan('  Unable to load models. Please check your configuration.'));
                    }
                }

                // File validation if requested
                if (options.validate) {
                    console.log(chalk.blue('\n📁 File Validation:\n'));

                    const filesToCheck = [
                        { name: 'Schema', path: process.env.SCHEMA_PATH || path.join(process.cwd(), 'schema.json'), required: false },
                        { name: 'Prompt', path: appConfig.PROMPT_PATH, required: false }
                    ];
                    
                    // Skip schema check if SCHEMA_PATH is not set
                    const actualFilesToCheck = process.env.SCHEMA_PATH ? filesToCheck : filesToCheck.slice(1);

                    for (const file of actualFilesToCheck) {
                        try {
                            await fs.access(file.path);

                            // Try to parse JSON files
                            try {
                                const content = await fs.readFile(file.path, 'utf-8');
                                const parsed = JSON.parse(content);

                                // Additional validation for specific file types
                                if (file.name === 'Schema') {
                                    if (!parsed.type || parsed.type !== 'object' || !parsed.properties) {
                                        console.log(chalk.yellow('⚠'), chalk.cyan(`${file.name}:`),
                                            chalk.yellow('exists but invalid schema format'));
                                    } else {
                                        const propCount = Object.keys(parsed.properties).length;
                                        console.log(chalk.green('✓'), chalk.cyan(`${file.name}:`),
                                            chalk.green('valid'),
                                            chalk.gray(`(${propCount} properties)`));
                                    }
                                } else if (file.name === 'Prompt') {
                                    if (!Array.isArray(parsed)) {
                                        console.log(chalk.yellow('⚠'), chalk.cyan(`${file.name}:`),
                                            chalk.yellow('exists but should be an array'));
                                    } else {
                                        console.log(chalk.green('✓'), chalk.cyan(`${file.name}:`),
                                            chalk.green('valid'),
                                            chalk.gray(`(${parsed.length} messages)`));
                                    }
                                }

                            } catch (parseError) {
                                console.log(chalk.red('✗'), chalk.cyan(`${file.name}:`),
                                    chalk.red('exists but invalid JSON'));
                            }

                        } catch (error) {
                            if (file.required) {
                                console.log(chalk.red('✗'), chalk.cyan(`${file.name}:`),
                                    chalk.red('not found'), chalk.gray(`(${file.path})`));
                            } else {
                                console.log(chalk.yellow('⚠'), chalk.cyan(`${file.name}:`),
                                    chalk.yellow('not found (optional)'), chalk.gray(`(${file.path})`));
                            }
                        }
                    }

                    // Validate API keys are actually set
                    console.log(chalk.blue('\n🔐 API Key Validation:\n'));
                    const validation = AIProviderFactory.validateEnvironment();
                    if (!validation.valid) {
                        console.log(chalk.red('❌ Missing required API keys:'));
                        validation.missing.forEach(key => {
                            console.log(chalk.red(`  - ${key}`));
                        });
                        console.log(chalk.yellow('\nSet these in your .env file to use the corresponding providers.'));
                    } else {
                        console.log(chalk.green('✅ All required API keys are set'));
                    }
                }

                // Usage examples
                console.log(chalk.blue('\n💡 Usage Examples:\n'));
                console.log(chalk.gray('Set environment variables in .env file:'));
                console.log(chalk.cyan('  AI_MODEL=claude-3-opus-latest'));
                console.log(chalk.cyan('  OPENAI_TEMPERATURE=0.3'));
                console.log(chalk.cyan('  SCHEMA_PATH=./custom-schema.json'));

                console.log(chalk.gray('\nOr export temporarily:'));
                console.log(chalk.cyan('  export AI_MODEL=gpt-4o-mini'));
                console.log(chalk.cyan('  export MISTRAL_TEMPERATURE=0.9'));

                console.log(chalk.gray('\nCommands will use these defaults:'));
                console.log(chalk.cyan('  ai-json ask "What should I eat?"'));
                console.log(chalk.cyan('  ai-json bulk input.txt'));
                console.log(chalk.cyan('  ai-json test test.csv'));
                console.log(chalk.cyan('  ai-json server'));

                console.log(chalk.gray('\nFor more options:'));
                console.log(chalk.cyan('  ai-json env --config    # Show detailed provider settings'));
                console.log(chalk.cyan('  ai-json env --validate  # Validate files and API keys'));

            } catch (error) {
                console.error(chalk.red('\nError:'), error instanceof Error ? error.message : 'Unknown error');
                process.exit(1);
            }
        });
}
