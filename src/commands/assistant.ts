// src/commands/assistant.ts

import { Command } from "commander";
import path from "path";
import chalk from "chalk";
import dotenv from 'dotenv';
import { s } from "ajv-ts";
import { loadJSON, loadPrompt, selectModelInteractively } from "../utils/utils";
import { OpenAIAssistantService } from "../ai/openai-assistant";
import { table } from 'table';

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '.env') });

interface AssistantCreateOptions {
    model: string;
    schema: string;
    prompt: string;
}

interface AssistantUpdateOptions {
    model: string;
    schema: string;
    prompt: string;
}

interface AssistantListOptions {
    limit: number;
}

export function setupAssistantCommand(program: Command) {
    const assistant = program
        .command('assistant')
        .description('Manage OpenAI assistants for structured JSON output');

    // List assistants sub-command
    assistant
        .command('list')
        .description('List existing assistants')
        .option(
            '-l, --limit <limit>',
            'Maximum number of assistants to show',
            (value: any) => parseInt(value),
            20
        )
        .action(async (options: AssistantListOptions) => {
            try {
                console.log(chalk.blue('\nListing assistants...'));
                
                const assistantService = new OpenAIAssistantService();
                const assistants = await assistantService.listAssistants(options.limit);

                if (assistants.length === 0) {
                    console.log(chalk.yellow('No assistants found.'));
                    console.log(chalk.cyan('Create a new assistant with: ai-json assistant create'));
                    return;
                }

                console.log(chalk.green(`\nFound ${assistants.length} assistant(s):`));

                // Create table data
                const tableData = [
                    [chalk.white('ID'), chalk.white('Name'), chalk.white('Model'), chalk.white('Instructions Preview')]
                ];

                assistants.forEach(assistant => {
                    const instructionsPreview = assistant.instructions 
                        ? (assistant.instructions.length > 50 
                            ? assistant.instructions.substring(0, 50) + '...' 
                            : assistant.instructions)
                        : chalk.gray('(no instructions)');

                    tableData.push([
                        chalk.cyan(assistant.id),
                        chalk.yellow(assistant.name || chalk.gray('(unnamed)')),
                        chalk.green(assistant.model),
                        chalk.gray(instructionsPreview)
                    ]);
                });

                console.log(table(tableData, {
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

                console.log(chalk.magenta('\nCommands:'));
                console.log(chalk.cyan('  Create new assistant: '), 'ai-json assistant create "My Assistant"');
                console.log(chalk.cyan('  Update assistant:     '), 'ai-json assistant update <assistant-id>');
                console.log(chalk.cyan('  Delete assistant:     '), 'ai-json assistant delete <assistant-id>');

            } catch (error) {
                console.error(chalk.red('\nError listing assistants:'), error instanceof Error ? error.message : 'Unknown error');
                
                if (error instanceof Error && error.message.includes('OPENAI_API_KEY')) {
                    console.log(chalk.yellow('\nMake sure you have set your OpenAI API key:'));
                    console.log(chalk.cyan('  export OPENAI_API_KEY=your-api-key-here'));
                }
                
                process.exit(1);
            }
        });

    // Create assistant sub-command
    assistant
        .command('create <name>')
        .description('Create a new assistant with schema and prompt configuration')
        .option(
            '-m, --model <model>',
            'Model to use for the assistant'
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
        .addHelpText('after', `
Environment Variables:
  You can set defaults using environment variables:
    SCHEMA_PATH=./schema.json  # Optional
    PROMPT_PATH=./prompt.md
    OPENAI_API_KEY=your-api-key-here

File Formats:
  schema.json - Contains JSON schema definition
  prompt files - Support multiple formats:
    .json - Array of messages: [{"role": "system", "content": "..."}]
    .md/.txt - Plain text (automatically converted to system message)
    no extension - Treated as plain text

Examples:
  Create assistant with defaults:
    $ ai-json assistant create "My Assistant"
  
  Create with custom files:
    $ ai-json assistant create "Custom Assistant" -s ./my-schema.json -p ./instructions.md
  
  Create with specific model:
    $ ai-json assistant create "GPT-4 Assistant" -m gpt-4o
        `)
        .action(async (name: string, options: AssistantCreateOptions) => {
            // Determine schema path
            const schemaPath = options.schema || process.env.SCHEMA_PATH;
            
            try {
                // Check if model was provided, if not, use interactive selection
                if (!options.model) {
                    options.model = await selectModelInteractively();
                }

                // Show configuration
                console.log(chalk.blue('\nConfiguration:'));
                console.log(chalk.cyan('├─ Name:   '), chalk.yellow(name));
                console.log(chalk.cyan('├─ Model:  '), chalk.yellow(options.model), chalk.gray('(interactive/args)'));
                console.log(chalk.cyan('├─ Schema: '), schemaPath ? chalk.green(schemaPath) : chalk.gray('none (unstructured)'));
                console.log(chalk.cyan('└─ Prompt: '), chalk.green(options.prompt));

                console.log(chalk.blue('\nValidating inputs...'));

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
                    schema = s.object();
                    schema.schema = schemaData;
                } else {
                    console.log(chalk.blue('No schema provided - assistant will support unstructured output'));
                }

                // Load prompt
                console.log(chalk.blue('Loading prompt...'));
                const promptMessages = await loadPrompt(options.prompt);
                
                // Convert messages to base prompt string
                let basePrompt = '';
                if (promptMessages.length === 1 && promptMessages[0].role === 'system') {
                    // Single system message - use content directly
                    basePrompt = promptMessages[0].content;
                } else {
                    // Multiple messages - combine them
                    basePrompt = promptMessages
                        .map(msg => `${msg.role.toUpperCase()}: ${msg.content}`)
                        .join('\n\n');
                }
                
                const promptPreview = basePrompt.length > 100 
                    ? basePrompt.substring(0, 100) + '...' 
                    : basePrompt;
                console.log(chalk.magenta(' – Prompt loaded successfully:'), chalk.green(promptPreview));

                // Validate model
                const assistantService = new OpenAIAssistantService();
                if (!assistantService.isValidAssistantModel(options.model)) {
                    console.error(chalk.red(`Invalid model for assistants: ${options.model}`));
                    console.log(chalk.yellow('Supported models:'));
                    console.log(chalk.cyan('  Base models: gpt-4o, gpt-4o-mini, gpt-4-turbo, gpt-4, gpt-3.5-turbo'));
                    console.log(chalk.cyan('  Fine-tuned: ft:gpt-3.5-turbo-* or ft:gpt-4-* models'));
                    process.exit(1);
                }

                // Create assistant
                console.log(chalk.blue('\nCreating assistant...'));
                const assistant = await assistantService.createAssistant({
                    model: options.model,
                    name: name,
                    schema: schema,
                    basePrompt: basePrompt
                });

                console.log(chalk.green('\n✅ Assistant created successfully!'));
                console.log(chalk.cyan('Assistant ID: '), chalk.yellow(assistant.id));
                console.log(chalk.cyan('Name:         '), chalk.yellow(assistant.name));
                console.log(chalk.cyan('Model:        '), chalk.yellow(assistant.model));
                
                // Show next steps
                console.log(chalk.magenta('\nNext steps:'));
                console.log(chalk.cyan('  Test the assistant:'), `ai-json assistant test ${assistant.id} "Your test message"`);
                console.log(chalk.cyan('  Update assistant: '), `ai-json assistant update ${assistant.id}`);
                console.log(chalk.cyan('  List assistants:   '), 'ai-json assistant list');
                console.log(chalk.cyan('  Delete assistant:  '), `ai-json assistant delete ${assistant.id}`);

            } catch (error) {
                console.error(chalk.red('\nError creating assistant:'), error instanceof Error ? error.message : 'Unknown error');
                
                // Provide helpful hints for common errors
                if (error instanceof Error) {
                    if (error.message.includes('ENOENT')) {
                        console.log(chalk.yellow('\nFile not found. Make sure these files exist:'));
                        if (schemaPath) console.log(chalk.cyan(`  Schema: ${schemaPath}`));
                        console.log(chalk.cyan(`  Prompt: ${options.prompt}`));
                        console.log(chalk.yellow('\nOr set different paths using environment variables or command options.'));
                    } else if (error.message.includes('OPENAI_API_KEY')) {
                        console.log(chalk.yellow('\nMake sure you have set your OpenAI API key:'));
                        console.log(chalk.cyan('  export OPENAI_API_KEY=your-api-key-here'));
                    } else if (error.message.includes('Invalid schema format')) {
                        console.log(chalk.yellow('\nSchema must be a valid JSON schema object with:'));
                        console.log(chalk.cyan('  - "type": "object"'));
                        console.log(chalk.cyan('  - "properties": { ... }'));
                    }
                }
                
                process.exit(1);
            }
        });

    // Update assistant sub-command
    assistant
        .command('update <assistantId>')
        .description('Update an existing assistant\'s model, schema, or prompt (name cannot be changed)')
        .option(
            '-m, --model <model>',
            'Model to use for the assistant'
        )
        .option(
            '-s, --schema <path>',
            'Path to schema.json containing schema definition'
        )
        .option(
            '-p, --prompt <path>',
            'Path to prompt file (.json, .md, .txt, or no extension)'
        )
        .addHelpText('after', `
Environment Variables:
  You can set defaults using environment variables:
    SCHEMA_PATH=./schema.json  # Optional
    PROMPT_PATH=./prompt.md
    OPENAI_API_KEY=your-api-key-here

File Formats:
  schema.json - Contains JSON schema definition
  prompt files - Support multiple formats:
    .json - Array of messages: [{"role": "system", "content": "..."}]
    .md/.txt - Plain text (automatically converted to system message)
    no extension - Treated as plain text

Examples:
  Update only the model:
    $ ai-json assistant update asst_123 -m gpt-4o
  
  Update schema and prompt:
    $ ai-json assistant update asst_123 -s ./new-schema.json -p ./new-prompt.md
  
  Update with interactive model selection:
    $ ai-json assistant update asst_123 -s ./schema.json
        `)
        .action(async (assistantId: string, options: AssistantUpdateOptions) => {
            // Determine schema path for updates
            const schemaPath = options.schema || process.env.SCHEMA_PATH;
            
            try {
                console.log(chalk.blue('\nUpdating assistant...'));
                console.log(chalk.cyan('Assistant ID:'), chalk.yellow(assistantId));

                const assistantService = new OpenAIAssistantService();
                
                // Get current assistant details
                console.log(chalk.blue('Loading current assistant...'));
                const currentAssistant = await assistantService.getAssistant(assistantId);
                console.log(chalk.magenta(' – Current assistant:'), chalk.green(currentAssistant.name || '(unnamed)'));
                console.log(chalk.magenta(' – Current model:    '), chalk.green(currentAssistant.model));

                // Prepare update options
                const updateData: Partial<{model: string, schema: any, basePrompt: string}> = {};
                let hasUpdates = false;

                // Handle model update
                if (options.model) {
                    updateData.model = options.model;
                    hasUpdates = true;
                } else if (!options.schema && !options.prompt) {
                    // If no specific options provided, prompt for interactive model selection
                    console.log(chalk.blue('\nNo update options specified. Select new model:'));
                    updateData.model = await selectModelInteractively();
                    hasUpdates = true;
                }

                // Handle schema update
                if (schemaPath) {
                    console.log(chalk.blue('Loading new schema...'));
                    const schemaData = await loadJSON<any>(schemaPath);
                    if (!schemaData['type'] || schemaData['type'] !== 'object' || !schemaData['properties']) {
                        throw new Error(`Invalid schema format: ${schemaPath}. Schema must be an object type.`);
                    } else {
                        const propertiesKeys = Object.keys(schemaData['properties']).join(', ');
                        console.log(chalk.magenta(' – New schema properties:'), chalk.green(propertiesKeys));
                    }
                    const schema = s.object();
                    schema.schema = schemaData;
                    updateData.schema = schema;
                    hasUpdates = true;
                }

                // Handle prompt update
                if (options.prompt) {
                    console.log(chalk.blue('Loading new prompt...'));
                    const promptMessages = await loadPrompt(options.prompt);
                    
                    // Convert messages to base prompt string
                    let basePrompt = '';
                    if (promptMessages.length === 1 && promptMessages[0].role === 'system') {
                        // Single system message - use content directly
                        basePrompt = promptMessages[0].content;
                    } else {
                        // Multiple messages - combine them
                        basePrompt = promptMessages
                            .map(msg => `${msg.role.toUpperCase()}: ${msg.content}`)
                            .join('\n\n');
                    }
                    
                    const promptPreview = basePrompt.length > 100 
                        ? basePrompt.substring(0, 100) + '...' 
                        : basePrompt;
                    console.log(chalk.magenta(' – New prompt preview:'), chalk.green(promptPreview));
                    updateData.basePrompt = basePrompt;
                    hasUpdates = true;
                }

                if (!hasUpdates) {
                    console.log(chalk.yellow('\nNo updates specified. Use -m, -s, or -p to specify what to update.'));
                    console.log(chalk.cyan('Examples:'));
                    console.log(chalk.cyan('  Update model:  '), `ai-json assistant update ${assistantId} -m gpt-4o`);
                    console.log(chalk.cyan('  Update schema: '), `ai-json assistant update ${assistantId} -s ./new-schema.json`);
                    console.log(chalk.cyan('  Update prompt: '), `ai-json assistant update ${assistantId} -p ./new-prompt.md`);
                    return;
                }

                // Validate model if being updated
                if (updateData.model && !assistantService.isValidAssistantModel(updateData.model)) {
                    console.error(chalk.red(`Invalid model for assistants: ${updateData.model}`));
                    console.log(chalk.yellow('Supported models:'));
                    console.log(chalk.cyan('  Base models: gpt-4o, gpt-4o-mini, gpt-4-turbo, gpt-4, gpt-3.5-turbo'));
                    console.log(chalk.cyan('  Fine-tuned: ft:gpt-3.5-turbo-* or ft:gpt-4-* models'));
                    process.exit(1);
                }

                // Show what will be updated
                console.log(chalk.blue('\nUpdates to apply:'));
                if (updateData.model) {
                    console.log(chalk.cyan('├─ Model: '), chalk.green(currentAssistant.model), chalk.gray('→'), chalk.yellow(updateData.model));
                }
                if (updateData.schema) {
                    console.log(chalk.cyan('├─ Schema:'), chalk.yellow('will be updated'));
                }
                if (updateData.basePrompt) {
                    console.log(chalk.cyan('└─ Prompt:'), chalk.yellow('will be updated'));
                }

                // Update assistant
                console.log(chalk.blue('\nApplying updates...'));
                const updatedAssistant = await assistantService.updateAssistant(assistantId, updateData);

                console.log(chalk.green('\n✅ Assistant updated successfully!'));
                console.log(chalk.cyan('Assistant ID: '), chalk.yellow(updatedAssistant.id));
                console.log(chalk.cyan('Name:         '), chalk.yellow(updatedAssistant.name));
                console.log(chalk.cyan('Model:        '), chalk.yellow(updatedAssistant.model));
                
                // Show next steps
                console.log(chalk.magenta('\nNext steps:'));
                console.log(chalk.cyan('  Test the assistant:'), `ai-json assistant test ${updatedAssistant.id} "Your test message"`);
                console.log(chalk.cyan('  List assistants:   '), 'ai-json assistant list');

            } catch (error) {
                console.error(chalk.red('\nError updating assistant:'), error instanceof Error ? error.message : 'Unknown error');
                
                // Provide helpful hints for common errors
                if (error instanceof Error) {
                    if (error.message.includes('ENOENT')) {
                        console.log(chalk.yellow('\nFile not found. Make sure these files exist:'));
                        if (schemaPath) console.log(chalk.cyan(`  Schema: ${schemaPath}`));
                        if (options.prompt) console.log(chalk.cyan(`  Prompt: ${options.prompt}`));
                        console.log(chalk.yellow('\nOr set different paths using environment variables or command options.'));
                    } else if (error.message.includes('OPENAI_API_KEY')) {
                        console.log(chalk.yellow('\nMake sure you have set your OpenAI API key:'));
                        console.log(chalk.cyan('  export OPENAI_API_KEY=your-api-key-here'));
                    } else if (error.message.includes('Invalid schema format')) {
                        console.log(chalk.yellow('\nSchema must be a valid JSON schema object with:'));
                        console.log(chalk.cyan('  - "type": "object"'));
                        console.log(chalk.cyan('  - "properties": { ... }'));
                    } else if (error.message.includes('404') || error.message.includes('not found')) {
                        console.log(chalk.yellow(`\nAssistant with ID "${assistantId}" not found.`));
                        console.log(chalk.cyan('List available assistants:'), 'ai-json assistant list');
                    }
                }
                
                process.exit(1);
            }
        });

    // Delete assistant sub-command
    assistant
        .command('delete')
        .description('Delete an assistant by ID')
        .argument('<assistantId>', 'Assistant ID to delete')
        .option(
            '-y, --yes',
            'Skip confirmation prompt',
            false
        )
        .action(async (assistantId: string, options: { yes: boolean }) => {
            try {
                console.log(chalk.blue('\nDeleting assistant...'));
                
                const assistantService = new OpenAIAssistantService();
                
                if (!options.yes) {
                    // Show assistant details before deletion
                    try {
                        const assistant = await assistantService.getAssistant(assistantId);
                        console.log(chalk.yellow('\nAssistant to be deleted:'));
                        console.log(chalk.cyan('ID:   '), chalk.white(assistant.id));
                        console.log(chalk.cyan('Name: '), chalk.white(assistant.name || '(unnamed)'));
                        console.log(chalk.cyan('Model:'), chalk.white(assistant.model));
                        
                        // Simple confirmation (in a real CLI, you'd use a proper prompt library)
                        console.log(chalk.red('\nWARNING: This action cannot be undone!'));
                        console.log(chalk.yellow('To confirm deletion, run:'));
                        console.log(chalk.cyan(`  ai-json assistant delete ${assistantId} --yes`));
                        return;
                    } catch (error) {
                        console.log(chalk.red('Assistant not found or error retrieving details.'));
                        console.log(chalk.yellow('Proceeding with deletion attempt...'));
                    }
                }

                // Perform deletion
                await assistantService.deleteAssistant(assistantId);
                
                console.log(chalk.green('\n✅ Assistant deleted successfully!'));
                console.log(chalk.cyan('Deleted Assistant ID:'), chalk.yellow(assistantId));
                
                console.log(chalk.magenta('\nNext steps:'));
                console.log(chalk.cyan('  List remaining assistants:'), 'ai-json assistant list');
                console.log(chalk.cyan('  Create new assistant:     '), 'ai-json assistant create');

            } catch (error) {
                console.error(chalk.red('\nError deleting assistant:'), error instanceof Error ? error.message : 'Unknown error');
                
                if (error instanceof Error) {
                    if (error.message.includes('OPENAI_API_KEY')) {
                        console.log(chalk.yellow('\nMake sure you have set your OpenAI API key:'));
                        console.log(chalk.cyan('  export OPENAI_API_KEY=your-api-key-here'));
                    } else if (error.message.includes('404') || error.message.includes('not found')) {
                        console.log(chalk.yellow(`\nAssistant with ID "${assistantId}" not found.`));
                        console.log(chalk.cyan('List available assistants:'), 'ai-json assistant list');
                    }
                }
                
                process.exit(1);
            }
        });

    // Test assistant sub-command (bonus)
    assistant
        .command('test')
        .description('Test an assistant with a message')
        .argument('<assistantId>', 'Assistant ID to test')
        .argument('[message]', 'Test message to send', 'Generate a test response based on your schema.')
        .action(async (assistantId: string, message: string) => {
            try {
                console.log(chalk.blue('\nTesting assistant...'));
                console.log(chalk.cyan('Assistant ID:'), chalk.yellow(assistantId));
                console.log(chalk.cyan('Test Message:'), chalk.green(message));
                
                const assistantService = new OpenAIAssistantService();
                
                // Start a thread and get response
                console.log(chalk.blue('\nSending message...'));
                const result = await assistantService.startThread(
                    assistantId,
                    'Please respond according to your configured schema.',
                    message
                );
                
                console.log(chalk.green('\n🎯 Assistant Response:'));
                console.log(JSON.stringify(JSON.parse(result.assistantResponse), null, 2));
                
                if (result.usage) {
                    console.log(chalk.yellow('\n📝 Token Usage:'));
                    console.log(chalk.yellow('├─ Prompt:    '), result.usage.prompt_tokens?.toLocaleString() || 'N/A', 'tokens');
                    console.log(chalk.yellow('├─ Completion:'), result.usage.completion_tokens?.toLocaleString() || 'N/A', 'tokens');
                    console.log(chalk.yellow('└─ Total:     '), result.usage.total_tokens?.toLocaleString() || 'N/A', 'tokens');
                    
                    const estimatedCost = assistantService.getEstimatedCost(
                        { 
                            prompt_tokens: result.usage.prompt_tokens || 0, 
                            completion_tokens: result.usage.completion_tokens || 0 
                        }, 
                        'gpt-4o-mini' // Default fallback
                    );
                    console.log(chalk.cyan('\n💰 Estimated Cost:'), `$${estimatedCost.toFixed(6)}`);
                }
                
                console.log(chalk.cyan('\nThread ID:'), chalk.gray(result.threadId), chalk.gray('(for follow-up messages)'));

            } catch (error) {
                console.error(chalk.red('\nError testing assistant:'), error instanceof Error ? error.message : 'Unknown error');
                
                if (error instanceof Error) {
                    if (error.message.includes('404') || error.message.includes('not found')) {
                        console.log(chalk.yellow(`\nAssistant with ID "${assistantId}" not found.`));
                        console.log(chalk.cyan('List available assistants:'), 'ai-json assistant list');
                    }
                }
                
                process.exit(1);
            }
        });

    return assistant;
}