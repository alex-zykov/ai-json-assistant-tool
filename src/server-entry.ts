#!/usr/bin/env node

import chalk from 'chalk';
import figlet from 'figlet';
import dotenv from 'dotenv';
import AIJSONServer from './server';
import path from "path";

// Load environment variables FIRST - before any other imports that might use them
dotenv.config({ path: path.join(process.cwd(), '.env') });

// Display banner
console.log(
    chalk.red(
        figlet.textSync('Assistant Server', { horizontalLayout: 'full' })
    )
);

async function main() {
    try {
        // Create and start the server
        const server = new AIJSONServer();
        await server.start();

        // Graceful shutdown handling
        const gracefulShutdown = (signal: string) => {
            console.log(chalk.yellow(`\n${signal} received. Shutting down gracefully...`));
            process.exit(0);
        };

        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    } catch (error) {
        console.error(chalk.red('\nFatal Error:'), error instanceof Error ? error.message : 'Unknown error');
        process.exit(1);
    }
}

// Run the main function
main().catch(error => {
    console.error(chalk.red('\nUnhandled Error:'), error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
});
