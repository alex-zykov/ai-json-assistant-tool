import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { AIProviderFactory } from '../ai/provider-factory';
import { MessageGlobal, NetworkError, JSONParseError, SchemaValidationError, InvalidModelError } from '../models/types';
import { s } from 'ajv-ts';
import { loadJSON } from '../utils/utils';
import { OpenAIAssistantService } from '../ai/openai-assistant';
import chalk from 'chalk';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables FIRST - before any other imports that might use them
dotenv.config({ path: path.join(process.cwd(), '.env') });

interface ServerConfig {
    port: number;
    model: string;
    schemaPath?: string;
    promptPath?: string;
    defaultAssistantId?: string;
    corsOrigins: string[];
    rateLimit: {
        windowMs: number;
        max: number;
    };
}

interface RequestBody {
    text: string;
    prompt?: MessageGlobal[];
    schema?: any;
    model?: string;
}

interface AssistantStartThreadBody {
    userMessage: string;
    userInstructions?: string;
    assistantId?: string;
}

interface AssistantFollowUpBody {
    threadId: string;
    userMessage: string;
    assistantId?: string;
}

interface ErrorResponse {
    error: string;
    type: string;
    timestamp: string;
    requestId?: string;
}

interface SuccessResponse {
    data: any;
    metrics: {
        timeElapsed: number;
        estimatedCost: number;
        totalTokens: number;
        promptTokens: number;
        completionTokens: number;
    };
    timestamp: string;
    requestId: string;
}

export class AIJSONServer {
    private app: express.Application;
    private config: ServerConfig;
    private factory?: AIProviderFactory;
    private defaultSchema?: s.Object;
    private defaultPrompt?: MessageGlobal[];
    private assistantService?: OpenAIAssistantService;

    constructor(config: Partial<ServerConfig> = {}) {
        this.app = express();
        this.config = this.buildConfig(config);
        this.setupMiddleware();
        this.setupRoutes();
    }

    private buildConfig(userConfig: Partial<ServerConfig>): ServerConfig {
        return {
            port: userConfig.port || parseInt(process.env.PORT || '3000'),
            model: userConfig.model || process.env.AI_MODEL || 'gpt-4o-mini',
            schemaPath: userConfig.schemaPath || process.env.SCHEMA_PATH,
            promptPath: userConfig.promptPath || process.env.PROMPT_PATH || path.join(process.cwd(), 'prompt.md'),
            defaultAssistantId: userConfig.defaultAssistantId || process.env.DEFAULT_ASSISTANT_ID,
            corsOrigins: userConfig.corsOrigins || (process.env.CORS_ORIGINS?.split(',') || ['*']),
            rateLimit: {
                windowMs: userConfig.rateLimit?.windowMs || parseInt(process.env.RATE_LIMIT_WINDOW || '900000'), // 15 minutes
                max: userConfig.rateLimit?.max || parseInt(process.env.RATE_LIMIT_MAX || '100') // 100 requests per window
            }
        };
    }

    private setupMiddleware(): void {
        // Security middleware
        this.app.use(helmet());

        // CORS middleware
        this.app.use(cors({
            origin: this.config.corsOrigins,
            credentials: true
        }));

        // Rate limiting
        const limiter = rateLimit({
            windowMs: this.config.rateLimit.windowMs,
            max: this.config.rateLimit.max,
            message: {
                error: 'Too many requests from this IP, please try again later.',
                type: 'RATE_LIMIT_EXCEEDED',
                timestamp: new Date().toISOString()
            },
            standardHeaders: true,
            legacyHeaders: false,
        });
        this.app.use('/api/', limiter);

        // Body parsing middleware
        this.app.use(express.json({ limit: '10mb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

        // Request logging middleware
        this.app.use((req, res, next) => {
            const requestId = Math.random().toString(36).substr(2, 9);
            req.requestId = requestId;
            console.log(chalk.blue(`[${new Date().toISOString()}]`),
                chalk.yellow(`${req.method} ${req.path}`),
                chalk.gray(`ID: ${requestId}`));
            next();
        });
    }

    private setupRoutes(): void {
        // Health check endpoint
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'healthy',
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                version: process.env.npm_package_version || '1.0.0'
            });
        });

        // Main generation endpoint
        this.app.post('/api/generate', async (req, res) => {
            try {
                await this.handleGenerate(req, res);
            } catch (error) {
                this.handleError(error, req, res);
            }
        });

        // Assistant endpoints
        this.app.post('/api/assistant/start-thread', async (req, res) => {
            try {
                await this.handleStartThread(req, res);
            } catch (error) {
                this.handleError(error, req, res);
            }
        });

        this.app.post('/api/assistant/follow-up', async (req, res) => {
            try {
                await this.handleFollowUp(req, res);
            } catch (error) {
                this.handleError(error, req, res);
            }
        });

        // 404 handler
        this.app.use('*', (req, res) => {
            res.status(404).json({
                error: 'Route not found',
                type: 'NOT_FOUND',
                timestamp: new Date().toISOString(),
                requestId: req.requestId
            });
        });

        // Global error handler
        this.app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
            this.handleError(error, req, res);
        });
    }

    private async handleGenerate(req: express.Request, res: express.Response): Promise<void> {
        const { text, prompt, schema, model }: RequestBody = req.body;
        if (!this.factory) {
            throw new Error('Server not properly initialized. Call initialize() first.');
        }

        // Validate required fields
        if (!text || typeof text !== 'string') {
            res.status(400).json({
                error: 'Text field is required and must be a string',
                type: 'VALIDATION_ERROR',
                timestamp: new Date().toISOString(),
                requestId: req.requestId
            });
            return;
        }

        // Use provided values or defaults
        const targetModel = model || this.config.model;
        const targetPrompt = prompt || this.defaultPrompt || [];
        let targetSchema = this.defaultSchema;

        // Handle custom schema if provided
        if (schema) {
            if (!schema.type || schema.type !== 'object' || !schema.properties) {
                res.status(400).json({
                    error: 'Invalid schema format. Schema must be an object type with properties.',
                    type: 'SCHEMA_ERROR',
                    timestamp: new Date().toISOString(),
                    requestId: req.requestId
                });
                return;
            }
            targetSchema = s.object();
            targetSchema.schema = schema;
        }

        console.log(chalk.cyan(`[${req.requestId}]`),
            chalk.magenta('Processing request with model:'),
            chalk.red(targetModel));

        const providerInstance = this.factory.createProviderForModel(targetModel);
        const result = await providerInstance.run(targetModel, targetPrompt, targetSchema, text);

        const response: SuccessResponse = {
            data: result.data,
            metrics: result.metrics,
            timestamp: new Date().toISOString(),
            requestId: req.requestId
        };

        console.log(chalk.green(`[${req.requestId}]`),
            chalk.cyan('Request completed -'),
            chalk.yellow(`${result.metrics.totalTokens} tokens`),
            chalk.yellow(`$${result.metrics.estimatedCost.toFixed(6)}`));

        res.json(response);
    }

    private async handleStartThread(req: express.Request, res: express.Response): Promise<void> {
        const { userMessage, userInstructions, assistantId }: AssistantStartThreadBody = req.body;
        
        if (!this.assistantService) {
            throw new Error('Assistant service not initialized. Check OpenAI API key.');
        }

        // Validate required fields
        if (!userMessage || typeof userMessage !== 'string') {
            res.status(400).json({
                error: 'userMessage field is required and must be a string',
                type: 'VALIDATION_ERROR',
                timestamp: new Date().toISOString(),
                requestId: req.requestId
            });
            return;
        }

        // Use provided assistantId or default from config
        const targetAssistantId = assistantId || this.config.defaultAssistantId;
        if (!targetAssistantId) {
            res.status(400).json({
                error: 'No assistant ID provided and no default assistant configured',
                type: 'VALIDATION_ERROR',
                timestamp: new Date().toISOString(),
                requestId: req.requestId
            });
            return;
        }

        console.log(chalk.cyan(`[${req.requestId}]`),
            chalk.magenta('Starting thread with assistant:'),
            chalk.red(targetAssistantId));

        const result = await this.assistantService.startThread(
            targetAssistantId,
            userInstructions || 'Please respond according to your configured schema.',
            userMessage
        );

        const response = {
            data: JSON.parse(result.assistantResponse),
            threadId: result.threadId,
            usage: result.usage,
            timestamp: new Date().toISOString(),
            requestId: req.requestId
        };

        console.log(chalk.green(`[${req.requestId}]`),
            chalk.cyan('Thread started -'),
            chalk.yellow(`Thread ID: ${result.threadId}`));

        res.json(response);
    }

    private async handleFollowUp(req: express.Request, res: express.Response): Promise<void> {
        const { threadId, userMessage, assistantId }: AssistantFollowUpBody = req.body;
        
        if (!this.assistantService) {
            throw new Error('Assistant service not initialized. Check OpenAI API key.');
        }

        // Validate required fields
        if (!threadId || typeof threadId !== 'string') {
            res.status(400).json({
                error: 'threadId field is required and must be a string',
                type: 'VALIDATION_ERROR',
                timestamp: new Date().toISOString(),
                requestId: req.requestId
            });
            return;
        }

        if (!userMessage || typeof userMessage !== 'string') {
            res.status(400).json({
                error: 'userMessage field is required and must be a string',
                type: 'VALIDATION_ERROR',
                timestamp: new Date().toISOString(),
                requestId: req.requestId
            });
            return;
        }

        // Use provided assistantId or default from config
        const targetAssistantId = assistantId || this.config.defaultAssistantId;
        if (!targetAssistantId) {
            res.status(400).json({
                error: 'No assistant ID provided and no default assistant configured',
                type: 'VALIDATION_ERROR',
                timestamp: new Date().toISOString(),
                requestId: req.requestId
            });
            return;
        }

        console.log(chalk.cyan(`[${req.requestId}]`),
            chalk.magenta('Following up on thread:'),
            chalk.red(threadId),
            chalk.magenta('with assistant:'),
            chalk.red(targetAssistantId));

        const result = await this.assistantService.followUp(
            targetAssistantId,
            threadId,
            userMessage
        );

        const response = {
            data: JSON.parse(result.assistantResponse),
            threadId: result.threadId,
            usage: result.usage,
            timestamp: new Date().toISOString(),
            requestId: req.requestId
        };

        console.log(chalk.green(`[${req.requestId}]`),
            chalk.cyan('Follow-up completed -'),
            chalk.yellow(`Thread ID: ${result.threadId}`));

        res.json(response);
    }

    private handleError(error: any, req: express.Request, res: express.Response): void {
        console.error(chalk.red(`[${req.requestId || 'unknown'}] Error:`), error);

        let statusCode = 500;
        let errorType = 'INTERNAL_SERVER_ERROR';
        let message = 'An unexpected error occurred';

        if (error.name === 'NetworkError') {
            statusCode = 502;
            errorType = 'NETWORK_ERROR';
            message = 'Failed to communicate with AI provider';
        } else if (error.name === 'JSONParseError') {
            statusCode = 502;
            errorType = 'JSON_PARSE_ERROR';
            message = 'Failed to parse AI response';
        } else if (error.name === 'SchemaValidationError') {
            statusCode = 502;
            errorType = 'SCHEMA_VALIDATION_ERROR';
            message = 'AI response does not match expected schema';
        } else if (error.name === 'InvalidModelError') {
            statusCode = 400;
            errorType = 'INVALID_MODEL_ERROR';
            message = error.message;
        } else if (error instanceof Error) {
            message = error.message;
        }

        const errorResponse: ErrorResponse = {
            error: message,
            type: errorType,
            timestamp: new Date().toISOString(),
            requestId: req.requestId
        };

        res.status(statusCode).json(errorResponse);
    }

    public async initialize(): Promise<void> {
        try {
            console.log(chalk.blue('Initializing AI-JSON Server...'));

            this.factory = new AIProviderFactory();

            // Load schema (optional)
            if (this.config.schemaPath) {
                console.log(chalk.magenta('Loading schema from:'), chalk.green(this.config.schemaPath));
                const schemaData = await loadJSON<any>(this.config.schemaPath);
                if (!schemaData.type || schemaData.type !== 'object' || !schemaData.properties) {
                    throw new Error(`Invalid schema format in ${this.config.schemaPath}`);
                }
                this.defaultSchema = s.object();
                this.defaultSchema.schema = schemaData;
            } else {
                console.log(chalk.yellow('No schema configured - server will support unstructured output'));
            }

            // Load default prompt (optional)
            if (this.config.promptPath) {
                try {
                    console.log(chalk.magenta('Loading prompt from:'), chalk.green(this.config.promptPath));
                    this.defaultPrompt = await loadJSON<MessageGlobal[]>(this.config.promptPath);
                } catch (error) {
                    console.log(chalk.yellow('Warning: Could not load prompt file, using default'));
                    this.defaultPrompt = [
                        {
                            role: "system",
                            content: "You are a helpful assistant that generates JSON responses according to the provided schema."
                        }
                    ];
                }
            } else {
                this.defaultPrompt = [
                    {
                        role: "system",
                        content: "You are a helpful assistant that generates JSON responses according to the provided schema."
                    }
                ];
            }

            // Initialize assistant service if OpenAI API key is available
            try {
                this.assistantService = new OpenAIAssistantService();
                console.log(chalk.green('✓ Assistant service initialized'));
                if (this.config.defaultAssistantId) {
                    console.log(chalk.cyan('Default assistant ID:'), chalk.red(this.config.defaultAssistantId));
                }
            } catch (error) {
                console.log(chalk.yellow('⚠ Assistant service not available:'), error instanceof Error ? error.message : 'Unknown error');
                console.log(chalk.gray('Assistant endpoints will not be functional'));
            }

            console.log(chalk.green('✓ Server initialized successfully'));
            console.log(chalk.cyan('Default model:'), chalk.red(this.config.model));
            if (this.defaultSchema && this.defaultSchema.schema && this.defaultSchema.schema.properties) {
                console.log(chalk.cyan('Schema properties:'),
                    chalk.green(Object.keys(this.defaultSchema.schema.properties).join(', ')));
            } else {
                console.log(chalk.cyan('Schema:'), chalk.gray('none (unstructured output)'));
            }

        } catch (error) {
            console.error(chalk.red('Failed to initialize server:'), error);
            throw error;
        }
    }

    public async start(): Promise<void> {
        await this.initialize();

        return new Promise((resolve) => {
            this.app.listen(this.config.port, () => {
                console.log(chalk.green('\n🚀 AI-JSON Server is running!'));
                console.log(chalk.cyan('Port:'), chalk.yellow(this.config.port));
                console.log(chalk.cyan('Health check:'), chalk.blue(`http://localhost:${this.config.port}/health`));
                console.log(chalk.cyan('API endpoints:'));
                console.log(chalk.blue(`  POST http://localhost:${this.config.port}/api/generate`));
                if (this.assistantService) {
                    console.log(chalk.blue(`  POST http://localhost:${this.config.port}/api/assistant/start-thread`));
                    console.log(chalk.blue(`  POST http://localhost:${this.config.port}/api/assistant/follow-up`));
                }
                resolve();
            });
        });
    }
}

// Extend Express Request interface to include requestId
declare global {
    namespace Express {
        interface Request {
            requestId: string;
        }
    }
}

// Export for use as a module
export default AIJSONServer;
