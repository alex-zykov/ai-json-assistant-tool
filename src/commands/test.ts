// src/commands/test.ts

import chalk from 'chalk';
import path from 'path';
import fs from 'fs/promises';
import dotenv from 'dotenv';
import { AIProviderFactory } from '../ai/provider-factory';
import { MetricsCalculator } from '../metrics/metrics-calculator';
import { MessageGlobal } from '../models/types';
import { table } from 'table';
import { s } from 'ajv-ts';
import { loadJSON, loadPrompt, selectModelInteractively } from "../utils/utils";

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '.env') });

interface TestCase {
    messages: MessageGlobal[];
    expectedResponse: any;
}

interface TestOptions {
    model: string;
    config: string;
    schema: string;
    prompt: string;
    rows: number;
    verbose: boolean;
    skipValidation: boolean;
}

interface JSONLTestCase {
    messages: Array<{
        role: 'system' | 'user' | 'assistant';
        content: string;
    }>;
}

export async function setupTestCommand(program: any) {
    program
        .command('test')
        .description('Run tests from JSONL file containing message arrays with expected responses')
        .option(
            '-m, --model <model>',
            'Model to use (run "ai-json models" to see available models)'
        )
        .option(
            '-r, --rows <rows>',
            'Number of rows to process, 0 for all',
            (value: any) => parseInt(value),
            0
        )
        .option(
            '-s, --schema <path>',
            'Path to schema.json containing schema definition (optional for string comparison)'
        )
        .option(
            '-p, --prompt <path>',
            'Path to prompt file (.json, .md, .txt, or no extension) - optional, overrides JSONL messages',
            process.env.PROMPT_PATH
        )
        .option(
            '-v, --verbose',
            'Show detailed output including differences in responses',
            false
        )
        .option(
            '--skip-validation',
            'Skip JSONL format validation (faster but less safe)',
            false
        )
        .argument(
            '[jsonlPath]',
            'Path to test JSONL file',
            'test.jsonl'
        )
        .addHelpText('after', `
Environment Variables:
  You can set defaults using environment variables:
    AI_MODEL=gpt-4o-mini
    SCHEMA_PATH=./schema.json
    PROMPT_PATH=./prompt.md (optional)

JSONL File Format:
  Each line should be a JSON object with a "messages" array:
    {"messages": [{"role": "system", "content": "You are a helpful assistant."}, {"role": "user", "content": "What should I eat?"}, {"role": "assistant", "content": "{\\"questionRecognized\\": true, \\"confidence\\": 0.9}"}]}
    {"messages": [{"role": "user", "content": "How is the weather?"}, {"role": "assistant", "content": "{\\"questionRecognized\\": false, \\"confidence\\": 0.1}"}]}

  The last message with role "assistant" will be used as the expected response.
  If you provide a --prompt file, it will override the system/assistant messages in the JSONL.

Examples:
  Run all tests with environment defaults:
    $ ai-json test test.jsonl
  
  Run first 10 tests with verbose output:
    $ ai-json test -v --rows 10 test.jsonl
  
  Use custom schema and override with prompt file:
    $ ai-json test -s ./custom-schema.json -p ./system-prompt.md test.jsonl
  
  Skip validation for faster processing:
    $ ai-json test --skip-validation test.jsonl

File Structure:
  test.jsonl       - Test cases in JSONL format
  schema.json      - JSON schema for validation
  prompt files     - Optional: Override system/assistant messages
    .json - Array of messages: [{"role": "system", "content": "..."}]
    .md/.txt - Plain text (automatically converted to system message)
    no extension - Treated as plain text
        `)
        .action(async (jsonlPath: string, options: TestOptions) => {
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
                console.log(chalk.cyan('├─ Schema:    '), schemaPath ? chalk.green(schemaPath) : chalk.gray('none (string comparison)'),
                    options.schema ? chalk.gray('(from args)') : schemaPath ? chalk.gray('(from env)') : '');

                if (options.prompt) {
                    console.log(chalk.cyan('├─ Prompt:    '), chalk.green(options.prompt),
                        options.prompt === process.env.PROMPT_PATH ? chalk.gray('(from env)') : chalk.gray('(from args)'));
                } else {
                    console.log(chalk.cyan('├─ Prompt:    '), chalk.gray('(from JSONL messages)'));
                }

                console.log(chalk.cyan('├─ JSONL File:'), chalk.green(jsonlPath));
                console.log(chalk.cyan('├─ Rows:      '), chalk.yellow(options.rows || 'all'));
                console.log(chalk.cyan('├─ Verbose:   '), chalk.yellow(options.verbose ? 'enabled' : 'disabled'));
                console.log(chalk.cyan('└─ Validation:'), chalk.yellow(options.skipValidation ? 'disabled' : 'enabled'));

                console.log(chalk.blue('\nInitializing test suite...'));

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
                console.log(chalk.magenta(' – Using'), chalk.red(provider), chalk.magenta('provider with model'), chalk.red(options.model));

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
                    console.log(chalk.blue('No schema provided - using string comparison'));
                }

                // Load optional prompt override
                let promptOverride: MessageGlobal[] | null = null;
                if (options.prompt) {
                    console.log(chalk.blue('Loading prompt override...'));
                    promptOverride = await loadPrompt(options.prompt);
                    const promptKeys = promptOverride.map(p => p.role).join(', ');
                    console.log(chalk.magenta(' – Prompt override loaded successfully messages:'), chalk.green(promptKeys));
                }

                // Load and parse JSONL file
                console.log(chalk.blue('Loading test cases...'));
                const jsonlContent = await fs.readFile(jsonlPath, 'utf-8');
                const lines = jsonlContent.split('\n').filter(line => line.trim());

                const testCases: TestCase[] = [];
                const errors: string[] = [];

                for (let i = 0; i < lines.length; i++) {
                    const lineNum = i + 1;
                    const line = lines[i].trim();

                    if (!line) continue;

                    try {
                        const jsonlCase: JSONLTestCase = JSON.parse(line);

                        // Validate JSONL structure
                        if (!options.skipValidation) {
                            if (!jsonlCase.messages || !Array.isArray(jsonlCase.messages)) {
                                errors.push(`Line ${lineNum}: Missing or invalid 'messages' array`);
                                continue;
                            }

                            if (jsonlCase.messages.length < 1) {
                                errors.push(`Line ${lineNum}: 'messages' array must have at least one message`);
                                continue;
                            }

                            // Validate message structure
                            for (const msg of jsonlCase.messages) {
                                if (!msg.role || !msg.content || typeof msg.content !== 'string') {
                                    errors.push(`Line ${lineNum}: Invalid message structure - need 'role' and 'content'`);
                                    break;
                                }
                                if (!['system', 'user', 'assistant'].includes(msg.role)) {
                                    errors.push(`Line ${lineNum}: Invalid role '${msg.role}' - must be 'system', 'user', or 'assistant'`);
                                    break;
                                }
                            }
                        }

                        // Find the last assistant message as expected response
                        const assistantMessages = jsonlCase.messages.filter(msg => msg.role === 'assistant');
                        if (assistantMessages.length === 0) {
                            errors.push(`Line ${lineNum}: No assistant message found for expected response`);
                            continue;
                        }

                        const expectedResponse = assistantMessages[assistantMessages.length - 1].content;

                        // Parse expected response (JSON if schema provided, string otherwise)
                        let parsedExpected;
                        if (schema) {
                            try {
                                parsedExpected = JSON.parse(expectedResponse);
                            } catch (parseError) {
                                errors.push(`Line ${lineNum}: Expected response is not valid JSON: ${parseError}`);
                                continue;
                            }
                        } else {
                            // For string comparison, use the raw expected response
                            parsedExpected = expectedResponse;
                        }

                        // Prepare messages for the test
                        let messagesForTest: MessageGlobal[];

                        if (promptOverride) {
                            // Use prompt override: take system messages from override, user message from JSONL
                            const userMessage = jsonlCase.messages.find(msg => msg.role === 'user');
                            if (!userMessage) {
                                errors.push(`Line ${lineNum}: No user message found in JSONL when using prompt override`);
                                continue;
                            }
                            messagesForTest = [...promptOverride, userMessage];
                        } else {
                            // Use messages from JSONL but exclude the last assistant message (that's our expected response)
                            messagesForTest = jsonlCase.messages
                                .filter((msg, idx) => !(msg.role === 'assistant' && idx === jsonlCase.messages.length - 1))
                                .map(msg => ({ role: msg.role, content: msg.content }));
                        }

                        testCases.push({
                            messages: messagesForTest,
                            expectedResponse: parsedExpected
                        });

                    } catch (parseError) {
                        errors.push(`Line ${lineNum}: JSON parse error - ${parseError}`);
                    }
                }

                // Apply rows limit after parsing
                const finalTestCases = options.rows > 0 ? testCases.slice(0, options.rows) : testCases;

                console.log(chalk.magenta(` – Loaded ${finalTestCases.length} test cases from`), chalk.green(jsonlPath));

                if (errors.length > 0) {
                    console.log(chalk.yellow(`\n⚠️  Found ${errors.length} errors in JSONL file:`));
                    errors.slice(0, 10).forEach(error => {
                        console.log(chalk.red(`  ${error}`));
                    });
                    if (errors.length > 10) {
                        console.log(chalk.gray(`  ... and ${errors.length - 10} more errors`));
                    }

                    if (finalTestCases.length === 0) {
                        console.log(chalk.red('\nNo valid test cases found. Please fix the JSONL file format.'));
                        process.exit(1);
                    }
                    console.log(chalk.yellow(`\nContinuing with ${finalTestCases.length} valid test cases...\n`));
                }

                console.log(`${chalk.blue('\nRunning "')}${chalk.green(jsonlPath)}${chalk.blue('" on ')}${chalk.red(options.model)}${chalk.blue('...')}`);

                // Create provider and run tests
                const providerInstance = factory.createProvider(provider);
                const results = [];

                // Progress bar variables
                const progressBarWidth = 40;
                let lastProgressString = '';

                for (const [index, testCase] of finalTestCases.entries()) {
                    // Update progress bar
                    const progress = Math.round((index + 1) / finalTestCases.length * progressBarWidth);
                    const progressString = `[${'='.repeat(progress)}${' '.repeat(progressBarWidth - progress)}] ${index + 1}/${finalTestCases.length}`;

                    if (progressString !== lastProgressString) {
                        process.stdout.write(`\r${chalk.yellow(progressString)}`);
                        lastProgressString = progressString;
                    }

                    try {
                        const startTime = Date.now();

                        // Extract user input from messages
                        const userMessage = testCase.messages.find(msg => msg.role === 'user');
                        const userInput = userMessage ? userMessage.content : 'No user input found';

                        // For the provider, we need to separate the user input from the conversation context
                        const contextMessages = testCase.messages.filter(msg => msg.role !== 'user' || msg !== userMessage);

                        const result = await providerInstance.run(options.model, contextMessages, schema, userInput);
                        const timeElapsed = Date.now() - startTime;

                        const testResult = await MetricsCalculator.evaluateTestCase(
                            testCase.expectedResponse,
                            result.data,
                            timeElapsed,
                            result.metrics.estimatedCost,
                            userInput
                        );

                        results.push(testResult);

                        // If verbose mode is on, show immediate results
                        if (options.verbose) {
                            console.log('\n');
                            console.log(chalk.cyan(`Test case ${index + 1}:`));
                            console.log(chalk.yellow('Input:'), userInput);
                            console.log(chalk.yellow('Status:'), testResult.isSuccess ?
                                chalk.green('✓ PASS') :
                                chalk.red('✗ FAIL'));

                            if (testResult.differences && testResult.differences.length > 0) {
                                console.log(chalk.red('\nDifferences found:'));
                                const diffTable = testResult.differences.map(diff => [
                                    chalk.cyan(diff.key),
                                    chalk.yellow(JSON.stringify(diff.expected)),
                                    chalk.red(JSON.stringify(diff.actual)),
                                    chalk.red(diff.similarity?.toFixed(2) || 'N/A')
                                ]);

                                console.log(table([
                                    [chalk.white('Field'), chalk.white('Expected'), chalk.white('Actual'), chalk.white('Similarity')],
                                    ...diffTable
                                ], {
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

                            console.log(chalk.gray('Time:'), `${(timeElapsed / 1000).toFixed(2)}s`);
                            console.log(chalk.gray('Cost:'), `${result.metrics.estimatedCost.toFixed(6)}`);
                            console.log(chalk.gray('─'.repeat(80)));
                        }

                        // Add delay between requests to avoid rate limits
                        if (index < finalTestCases.length - 1) {
                            await new Promise(resolve => setTimeout(resolve, 1000));
                        }

                    } catch (error) {
                        console.error(chalk.red(`\nError in test case ${index + 1}:`), error);

                        const userMessage = testCase.messages.find(msg => msg.role === 'user');
                        const userInput = userMessage ? userMessage.content : 'No user input found';

                        results.push({
                            isFinished: false,
                            isSuccess: false,
                            input: userInput,
                            expectedResponse: testCase.expectedResponse,
                            actualResponse: null,
                            timeElapsed: 0,
                            cost: 0
                        });
                    }
                }

                // Calculate and display metrics
                const metrics = MetricsCalculator.calculateMetrics(results);

                console.log('\n');
                console.log(chalk.green('📊 Test Results Summary:'));
                console.log(chalk.cyan('├─ Total Tests:       '), metrics.totalTests);
                console.log(chalk.cyan('├─ Successful Tests:  '), chalk.green(metrics.successfulTests));
                console.log(chalk.cyan('├─ Failed Tests:      '), chalk.red(metrics.failedTests));
                console.log(chalk.cyan('├─ Success Rate:      '), `${(metrics.precision * 100).toFixed(1)}%`);
                console.log(chalk.cyan('├─ Average Time:      '), `${(metrics.averageTime / 1000).toFixed(2)}s`);
                console.log(chalk.cyan('├─ Total Cost:        '), `${metrics.totalCost.toFixed(6)}`);
                console.log(chalk.cyan('├─ Average Cost:      '), `${metrics.averageCost.toFixed(6)}`);
                console.log(chalk.cyan('└─ F1 Score:          '), metrics.f1Score.toFixed(4));

                // Failed tests summary in non-verbose mode
                if (!options.verbose && metrics.successfulTests < metrics.totalTests) {
                    console.log(chalk.yellow('\nFailed Tests Summary:'));
                    results.forEach((result, index) => {
                        if (!result.isSuccess) {
                            console.log(chalk.red(`\nTest case ${index + 1}:`));
                            console.log(chalk.yellow('Input:'), result.input);

                            if (result.differences) {
                                const diffTable = result.differences.map(diff => [
                                    chalk.cyan(diff.key),
                                    chalk.yellow(JSON.stringify(diff.expected)),
                                    chalk.red(JSON.stringify(diff.actual))
                                ]);

                                console.log(table([
                                    [chalk.white('Field'), chalk.white('Expected'), chalk.white('Actual')],
                                    ...diffTable
                                ]));
                            }
                        }
                    });
                }

                // Field-level success rates
                if (Object.keys(metrics.fieldSuccessRates).length > 0) {
                    console.log(chalk.blue('\n📈 Field-level Success Rates:'));
                    Object.entries(metrics.fieldSuccessRates).forEach(([field, rate]) => {
                        const percentage = (rate * 100).toFixed(1);
                        const color = rate > 0.8 ? chalk.green : rate > 0.5 ? chalk.yellow : chalk.red;
                        console.log(chalk.cyan(`├─ ${field.padEnd(20)}`), color(`${percentage}%`));
                    });
                }

                // Most failed fields
                if (metrics.mostFailedFields.length > 0) {
                    console.log(chalk.red('\n❌ Most Failed Fields:'));
                    metrics.mostFailedFields.slice(0, 5).forEach((fieldInfo, index) => {
                        const isLast = index === Math.min(4, metrics.mostFailedFields.length - 1);
                        const prefix = isLast ? '└─' : '├─';
                        console.log(chalk.cyan(`${prefix} ${fieldInfo.field.padEnd(20)}`),
                            chalk.red(`${(fieldInfo.failureRate * 100).toFixed(1)}% failure rate`));
                    });
                }

                // Cost projection
                const monthlyProjection = metrics.averageCost * 150000; // 1000 users * 5 requests * 30 days
                console.log(chalk.magenta('\n💰 Monthly Cost Projection:'));
                console.log(chalk.magenta('1000 users x 5 requests per day x 30 days:'), `${monthlyProjection.toFixed(6)}`);

            } catch (error) {
                console.error(chalk.red('\nError:'), error instanceof Error ? error.message : 'Unknown error');

                // Provide helpful hints for common errors
                if (error instanceof Error) {
                    if (error.message.includes('ENOENT')) {
                        if (error.message.includes(jsonlPath)) {
                            console.log(chalk.yellow(`\nJSONL file not found: ${jsonlPath}`));
                            console.log(chalk.cyan('Make sure the test JSONL file exists and is readable'));
                            console.log(chalk.gray('\nExample JSONL format:'));
                            console.log(chalk.gray('{"messages": [{"role": "user", "content": "What should I eat?"}, {"role": "assistant", "content": "{\\"questionRecognized\\": true}"}]}'));
                        } else if (error.message.includes(options.config)) {
                            console.log(chalk.yellow(`\nConfig file not found: ${options.config}`));
                            console.log(chalk.cyan('Set CONFIG_PATH environment variable or use -c option'));
                        } else if (schemaPath && error.message.includes(schemaPath)) {
                            console.log(chalk.yellow(`\nSchema file not found: ${schemaPath}`));
                            console.log(chalk.cyan('Set SCHEMA_PATH environment variable or use -s option'));
                        } else if (options.prompt && error.message.includes(options.prompt)) {
                            console.log(chalk.yellow(`\nPrompt file not found: ${options.prompt}`));
                            console.log(chalk.cyan('Set PROMPT_PATH environment variable or use -p option'));
                        }
                    } else if (error.message.includes('JSON parse error')) {
                        console.log(chalk.yellow('\nJSONL parsing failed. Check:'));
                        console.log(chalk.cyan('├─ File format (each line should be valid JSON)'));
                        console.log(chalk.cyan('├─ Message structure (need "messages" array with role/content)'));
                        console.log(chalk.cyan('└─ File encoding (should be UTF-8)'));
                    }
                }

                process.exit(1);
            }
        });
}
