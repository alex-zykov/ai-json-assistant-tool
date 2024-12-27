import fs from "fs/promises";
import path from "path";
import readline from "readline";
import chalk from "chalk";
import { MessageGlobal } from "../models/types";
import { AIProviderFactory } from "../ai/provider-factory";

export async function loadJSON<T>(filePath: string): Promise<T> {
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(content) as T;
    } catch (error) {
        throw new Error(`Error loading JSON from ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

export async function loadPrompt(filePath: string): Promise<MessageGlobal[]> {
    try {
        const fileExtension = path.extname(filePath).toLowerCase();
        const content = await fs.readFile(filePath, 'utf-8');

        if (fileExtension === '.json') {
            // Parse as JSON and return as is
            const parsed = JSON.parse(content) as MessageGlobal[];
            if (!Array.isArray(parsed)) {
                throw new Error('JSON prompt file must contain an array of messages');
            }
            return parsed;
        } else if (fileExtension === '.md' || fileExtension === '.txt' || fileExtension === '') {
            // Transform text/markdown to system message format
            return [
                {
                    role: "system",
                    content: content.trim()
                }
            ];
        } else {
            throw new Error(`Unsupported prompt file extension: ${fileExtension}. Supported extensions: .json, .md, .txt, or no extension`);
        }
    } catch (error) {
        if (error instanceof Error && error.message.includes('Unsupported prompt file extension')) {
            throw error;
        }
        throw new Error(`Error loading prompt from ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

export async function selectModelInteractively(): Promise<string> {
    console.log(chalk.blue('\nNo model specified. Please select a model:'));
    
    // Define the short list of base models as requested
    const baseModels = [
        'gpt-4o',
        'gpt-4o-mini', 
        'claude-3-5-sonnet-20241022',
        'claude-3-haiku-20240307',
        'mistral-large-latest',
        'llama3-8b-8192'
    ];
    
    try {
        // Get all available models
        const allModels = await AIProviderFactory.getAllModelsAsync();
        
        // Filter for fine-tuned models (starting with 'ft:')
        const fineTunedModels = allModels
            .filter(model => model.id.startsWith('ft:'))
            .map(model => model.id);
        
        // Combine base models with fine-tuned models
        const modelOptions = [...baseModels, ...fineTunedModels];
        
        // Display options
        console.log(chalk.cyan('\nBase Models:'));
        baseModels.forEach((model, index) => {
            console.log(chalk.yellow(`  ${index + 1}. ${model}`));
        });
        
        if (fineTunedModels.length > 0) {
            console.log(chalk.cyan('\nFine-tuned Models:'));
            fineTunedModels.forEach((model, index) => {
                console.log(chalk.yellow(`  ${baseModels.length + index + 1}. ${model}`));
            });
        }
        
        // Create readline interface
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        // Prompt for selection
        const answer = await new Promise<string>((resolve) => {
            rl.question(chalk.green('\nEnter the number of your choice (or type model name directly): '), (answer) => {
                rl.close();
                resolve(answer.trim());
            });
        });
        
        // Parse the answer
        const choiceNumber = parseInt(answer);
        if (!isNaN(choiceNumber) && choiceNumber >= 1 && choiceNumber <= modelOptions.length) {
            return modelOptions[choiceNumber - 1];
        } else if (answer) {
            // User typed a model name directly - validate it
            const isValid = await AIProviderFactory.validateModelAsync(answer);
            if (isValid) {
                return answer;
            } else {
                console.log(chalk.red('\nInvalid model name. Please try again.'));
                return selectModelInteractively();
            }
        } else {
            console.log(chalk.red('\nNo selection made. Please try again.'));
            return selectModelInteractively();
        }
        
    } catch (error) {
        console.log(chalk.yellow('\nFailed to load available models. Using default base models only.'));
        console.log(chalk.cyan('\nBase Models:'));
        baseModels.forEach((model, index) => {
            console.log(chalk.yellow(`  ${index + 1}. ${model}`));
        });
        
        // Create readline interface
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        // Prompt for selection
        const answer = await new Promise<string>((resolve) => {
            rl.question(chalk.green('\nEnter the number of your choice (or type model name directly): '), (answer) => {
                rl.close();
                resolve(answer.trim());
            });
        });
        
        // Parse the answer
        const choiceNumber = parseInt(answer);
        if (!isNaN(choiceNumber) && choiceNumber >= 1 && choiceNumber <= baseModels.length) {
            return baseModels[choiceNumber - 1];
        } else if (answer) {
            // User typed a model name directly - use static validation as fallback
            if (AIProviderFactory.isValidModel(answer)) {
                return answer;
            } else {
                console.log(chalk.red('\nInvalid model name. Please try again.'));
                return selectModelInteractively();
            }
        } else {
            console.log(chalk.red('\nNo selection made. Please try again.'));
            return selectModelInteractively();
        }
    }
}
