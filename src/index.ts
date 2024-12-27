#!/usr/bin/env node

import chalk from 'chalk';
import figlet from 'figlet';
import dotenv from 'dotenv';
import path from 'path';
import { program } from 'commander';
import { AIProviderFactory } from './ai/provider-factory';
import { s } from 'ajv-ts';
import fs from 'fs/promises';
import { InvalidModelError, JSONParseError, MessageGlobal, NetworkError, SchemaValidationError } from './models/types';
import { setupModelsCommand } from "./commands/models";
import { setupAskCommand } from "./commands/ask";
import { setupTestCommand } from "./commands/test";
import { setupBulkCommand } from "./commands/bulk";
import { setupServerCommand } from "./commands/server";
import { setupEnvCommand } from "./commands/env";
import {setupFineTuneCommand} from "./commands/fine-tune";
import { setupAssistantCommand } from "./commands/assistant";

// Load environment variables early
dotenv.config({ path: path.join(process.cwd(), '.env') });

// Display banner
console.log(
    chalk.red(
        figlet.textSync('AI-JSON', { horizontalLayout: 'full' })
    )
);

async function main() {
    // Main command
    program
        .name('ai-json')
        .version('1.0.0')
        .description(
            'Comprehensive tool to create and test different AI providers.\n\n' +
            'Example usage:\n' +
            '  $ ai-json ask -m claude-3-opus-20240229 "Generate user profile"\n' +
            '  $ ai-json ask -m gpt-4o-mini "Generate product data"\n' +
            '  $ ai-json server --port 3000 --model gpt-4o-mini\n' +
            '  $ ai-json --help models'
        );

    // Add CLI commands
    setupAskCommand(program);
    setupTestCommand(program);
    setupBulkCommand(program);
    setupModelsCommand(program);
    setupEnvCommand(program);
    setupFineTuneCommand(program);
    setupAssistantCommand(program);

    // Add server command
    setupServerCommand(program);

    await program.parseAsync(process.argv);
}

// Run the main function
main().catch(error => {
    console.error(chalk.red('\nFatal Error:'), error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
});
