import { Command } from "commander";
import chalk from "chalk";
import path from "path";
import AIJSONServer from "../server";
import { AIProviderFactory } from "../ai/provider-factory";

interface ServerOptions {
    port: number;
    model: string;
    config: string;
    schema: string;
    prompt: string;
    cors: string;
    rateLimit: number;
    rateLimitWindow: number;
}

export function setupServerCommand(program: Command) {
    program
        .command('server')
        .description('Start the AI-JSON web server')
        .option(
            '-p, --port <port>',
            'Port to run the server on',
            (value) => parseInt(value),
            3000
        )
        .option(
            '-m, --model <model>',
            'Model to use (run "ai-json models" to see available models)',
            process.env.AI_MODEL || 'gpt-4o-mini'
        )
        .option(
            '-s, --schema <path>',
            'Path to schema.json containing schema definition (optional for unstructured output)'
        )
        .option(
            '-p, --prompt <path>',
            'Path to prompt file (.json, .md, .txt, or no extension) containing message array',
            process.env.PROMPT_PATH || path.join(process.cwd(), 'prompt.md')
        )
        .option(
            '--cors <origins>',
            'Comma-separated list of allowed CORS origins (use * for all)',
            '*'
        )
        .option(
            '--rate-limit <max>',
            'Maximum requests per rate limit window',
            (value) => parseInt(value),
            100
        )
        .option(
            '--rate-limit-window <ms>',
            'Rate limit window in milliseconds',
            (value) => parseInt(value),
            900000 // 15 minutes
        )
        .addHelpText('after', `
Examples:
  Start server with default settings:
    $ ai-json server

  Start on custom port with Claude model:
    $ ai-json server --port 8080 --model claude-3-opus-latest

  Start with custom configuration:
    $ ai-json server -s ./my-schema.json

  Start with CORS for specific domains:
    $ ai-json server --cors "http://localhost:3000,https://myapp.com"

  Start with custom rate limiting:
    $ ai-json server --rate-limit 200 --rate-limit-window 600000

Environment Variables:
  You can also set configuration via environment variables:
    PORT=3000
    AI_MODEL=gpt-4o-mini
    SCHEMA_PATH=./schema.json  # Optional
    PROMPT_PATH=./prompt.md
    CORS_ORIGINS=*
    RATE_LIMIT_MAX=100
    RATE_LIMIT_WINDOW=900000
        `)
        .action(async (options: ServerOptions) => {
            try {
                console.log(chalk.blue('\nValidating configuration...'));

                // Validate model name
                try {
                    const isValid = await AIProviderFactory.validateModelAsync(options.model);
                    if (!isValid) {
                        throw new Error(`Invalid model: ${options.model}`);
                    }
                } catch (error) {
                    if (!AIProviderFactory.isValidModel(options.model)) {
                        console.error(chalk.red(`Invalid model: ${options.model}`));
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
                            console.log(chalk.cyan('  Unable to load models. Please check your configuration.'));
                        }
                        process.exit(1);
                    }
                }

                // Parse CORS origins
                const corsOrigins = options.cors === '*' ? ['*'] : options.cors.split(',').map(s => s.trim());

                // Create server configuration
                const serverConfig = {
                    port: options.port,
                    model: options.model,
                    configPath: options.config,
                    schemaPath: options.schema || process.env.SCHEMA_PATH,  // Optional
                    promptPath: options.prompt,
                    corsOrigins,
                    rateLimit: {
                        windowMs: options.rateLimitWindow,
                        max: options.rateLimit
                    }
                };

                console.log(chalk.magenta('Server Configuration:'));
                console.log(chalk.cyan('├─ Port:              '), chalk.yellow(options.port));
                console.log(chalk.cyan('├─ Model:             '), chalk.yellow(options.model));
                console.log(chalk.cyan('├─ Schema:            '), options.schema ? chalk.green(options.schema) : chalk.gray('none (unstructured)'));
                console.log(chalk.cyan('├─ Prompt:            '), chalk.green(options.prompt));
                console.log(chalk.cyan('├─ CORS Origins:      '), chalk.yellow(corsOrigins.join(', ')));
                console.log(chalk.cyan('├─ Rate Limit:        '), chalk.yellow(`${options.rateLimit} requests`));
                console.log(chalk.cyan('└─ Rate Limit Window: '), chalk.yellow(`${options.rateLimitWindow}ms`));

                // Create and start server
                const server = new AIJSONServer(serverConfig);
                await server.start();

                // Graceful shutdown handling
                const gracefulShutdown = (signal: string) => {
                    console.log(chalk.yellow(`\n${signal} received. Shutting down gracefully...`));
                    process.exit(0);
                };

                process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
                process.on('SIGINT', () => gracefulShutdown('SIGINT'));

            } catch (error) {
                console.error(chalk.red('\nServer Error:'), error instanceof Error ? error.message : 'Unknown error');

                if (error instanceof Error) {
                    if (error.message.includes('EADDRINUSE')) {
                        console.log(chalk.yellow(`Port ${options.port} is already in use. Try a different port with --port <number>`));
                    } else if (error.message.includes('ENOENT')) {
                        console.log(chalk.yellow('Make sure all required files exist:'));
                        console.log(chalk.cyan('  - schema.json (JSON schema) - optional'));
                        console.log(chalk.cyan('  - prompt file (.json, .md, .txt, etc.) (optional)'));
                    }
                }

                process.exit(1);
            }
        });
}
