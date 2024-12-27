# AI JSON Assistant Tool

* A command-line tool for testing and evaluating JSON output across multiple AI providers including: OpenAI, Anthropic (Claude), Mistral, and LlamaAI. 
* Features: 
  * Structured JSON validation
  * Bulk testing
  * Fine-tuning support
  * Assistant API

## How It Works

1. **Put your prompt in file** (prompt.md)
```
You are a helpful assistant that recognizes "Set Timer" and "Set Location" commands
```

2. **Define expected output as JSON schema** (schema.json)
```json
{
  "type": "object",
  "properties": {
    "commandRecognized": { "type": "boolean" },
    "commands": {
      "type": "array",
      "items": {
        "anyOf": [
          {
            "type": "object",
            "properties": {
              "command": { "const": "set_timer" },
              "duration_minutes": { "type": "number" }
            }
          },
          {
            "type": "object", 
            "properties": {
              "command": { "const": "set_location" },
              "location": { "type": "string" }
            }
          }
        ]
      }
    }
  }
}
```

3.  **Set up API keys**
```bash
cp .env.example .env
```

4. **Run your request**
```bash
ai-json -m gpt-4o -p prompt.md -s schema.json ask "I'm at home, set timer for 25 minutes"
# Output: {"commandRecognized": true, "commands": [{"command": "set_location", "location": "home"},{"command": "set_timer", "duration_minutes": 25}]}
```

5. **Run test cases set**
```bash
ai-json test test.jsonl
# Tests multiple inputs like "Set location to Paris", "Timer 10 min", etc.
```

6. **Fine-tune**
```bash
ai-json fine-tune create -m gpt-4.1-2025-04-14 -s test -f training.jsonl
```

## Installation

### Local Development Setup

```bash
# Clone the repository
git clone <repo url>
cd ai-json-assistant-tool

# Install dependencies
npm install

# Build and install locally
npm run local
```

## Quick Start

1. **Copy environment file and add your API keys:**
   ```bash
   cp .env.example examples/diet-tracker/.env
   # Edit .env and add your API keys
   ```

2. **Try the diet tracker example:**
   ```bash
   cd examples/diet-tracker
   ai-json ask -m gpt-4o-mini "I ate 2 slices of pizza and went for a 30 minute run"
   ```

3. **Run tests:**
   ```bash
   ai-json test test.jsonl
   ```

## Commands

### Core Commands

#### `ask` - Interactive Query
Ask a single question and get structured JSON response.

```bash
# Basic usage
ai-json ask "What should I eat for lunch?"

# With specific model
ai-json ask -m claude-3-5-sonnet-latest "Analyze my workout: 45 min HIIT"

# With custom files
ai-json ask -s ./custom-schema.json -p ./custom-prompt.md "Generate user profile"
```

#### `test` - Run Test Suite
Run test cases from JSONL files with comprehensive metrics.

```bash
# Run all tests
ai-json test test.jsonl

# Run first 10 tests with verbose output
ai-json test -v --rows 10 test.jsonl

# Use custom schema and prompt override
ai-json test -s ./schema.json -p ./prompt.md test.jsonl

# Skip validation for faster processing
ai-json test --skip-validation test.jsonl
```

#### `bulk` - Batch Processing
Process multiple inputs from text files.

```bash
# Process all lines in file
ai-json bulk inputs.txt

# Process first 50 lines only
ai-json bulk --rows 50 inputs.txt

# Use custom configuration
ai-json bulk -m claude-3-opus-latest -s ./schema.json inputs.txt
```

#### `assistant` - OpenAI Assistant Management
Create and manage persistent OpenAI assistants with custom schemas and prompts.

```bash
# List existing assistants
ai-json assistant list

# Create a new assistant
ai-json assistant create "Diet Tracker Assistant" -m gpt-4o -s ./schema.json -p ./prompt.md

# Update an existing assistant
ai-json assistant update asst_123 -m gpt-4o-mini -s ./new-schema.json

# Test an assistant
ai-json assistant test asst_123 "I had pizza for lunch"

# Delete an assistant
ai-json assistant delete asst_123 --yes
```

### Utility Commands

#### `models` - List Available Models
```bash
# List all models
ai-json models

# Filter by provider
ai-json models --provider openai
ai-json models --provider claude

# Show detailed model information
ai-json models --detailed
```

#### `env` - Environment Management
```bash
# Show current configuration
ai-json env

# Validate configuration and API keys
ai-json env --validate

# Show detailed provider settings
ai-json env --config
```

#### `server` - Web Server Mode
Start a REST API server for web applications.

```bash
# Start server with default settings
ai-json server

# Custom port and model
ai-json server --port 8080 --model claude-3-5-sonnet-latest

# Production mode with specific CORS
ai-json server --port 3000 --cors "https://myapp.com"
```

#### `fine-tune` - Fine-tuning Support
Manage fine-tuned models and training data.

```bash
# List fine-tuned models
ai-json fine-tune list

# Start fine-tuning job
ai-json fine-tune create -m gpt-4.1-2025-04-14 -s test -f ./examples/generic-workflow/training.jsonl
```

### Command Options

All commands support these common options:

```
-m, --model <model>      Model to use (run "ai-json models" to see options)
-s, --schema <path>      Path to JSON schema file (default: ./schema.json)
-p, --prompt <path>      Path to prompt file (.json, .md, .txt)
-v, --verbose           Show detailed output
--help                  Show help for specific command
```

## Configuration

### Environment Variables

Set up your environment by copying `.env.example` to `.env`:

```bash
# Required API Keys
OPENAI_API_KEY=your-openai-api-key
ANTHROPIC_API_KEY=your-anthropic-api-key
MISTRAL_API_KEY=your-mistral-api-key
LLAMAAI_API_KEY=your-llamaai-api-key

# Default Settings
AI_MODEL=gpt-4o-mini
SCHEMA_PATH=./schema.json
PROMPT_PATH=./prompt.json

# Server Configuration
PORT=3000
CORS_ORIGINS=http://localhost:3000,http://localhost:3001
```

### File Formats

#### Schema File (schema.json)
```json
{
  "type": "object",
  "properties": {
    "eventRecognized": { "type": "boolean" },
    "events": { "type": "array" },
    "questionRecognized": { "type": "boolean" },
    "questions": { "type": "array" }
  },
  "required": ["eventRecognized", "events", "questionRecognized", "questions"]
}
```

#### Prompt File (prompt.json, prompt.md, or prompt.txt)
```json
[
  {
    "role": "system",
    "content": "You are a helpful assistant that returns structured JSON."
  }
]
```

Or as Markdown:
```markdown
# System Prompt

You are a helpful assistant that returns structured JSON according to the provided schema.
```

#### Test File (test.jsonl)
Each line contains a separate JSON object:
```
{"messages": [{"role": "system", "content": "System prompt"}, {"role": "user", "content": "User input"}, {"role": "assistant", "content": "{\"expectedOutput\": true}"}]}
{"messages": [{"role": "user", "content": "Another input"}, {"role": "assistant", "content": "{\"expectedOutput\": false}"}]}
```

## Examples

The project includes two complete examples:

### Diet Tracker (`examples/diet-tracker/`)
Analyzes health and fitness text to extract meal and training events.

```bash
cd examples/diet-tracker
ai-json ask "I had a burger and fries, then went for a 30 minute run"
ai-json test test.jsonl
```

### Expense Tracker (`examples/expenses-tracker/`)
Analyzes personal finance text to extract expenses, budgets, and balance queries.

```bash
cd examples/expenses-tracker  
ai-json ask "I spent $50 on groceries and $30 on gas. What's my budget remaining?"
ai-json test test.jsonl
```

## OpenAI Assistants (beta)

The `assistant` command provides advanced functionality for creating and managing persistent OpenAI assistants that are specifically configured for structured JSON output.

### Benefits of OpenAI Assistants

- **Persistent Configuration**: Create assistants once with specific schemas and prompts
- **Conversation Memory**: Maintain context across multiple interactions
- **Specialized Models**: Use GPT-4, GPT-4 Turbo, or fine-tuned models optimized for your use case
- **Reusable**: Share assistant IDs across your team or applications
- **Cost Effective**: Pay only for actual usage, not setup/configuration

### Assistant Workflow

1. **Create**: Set up an assistant with your schema and prompt
   ```bash
   ai-json assistant create "Diet Tracker" -m gpt-4o -s ./schema.json -p ./prompt.md
   ```

2. **Test**: Verify the assistant works correctly
   ```bash
   ai-json assistant test asst_123 "I had a salad for lunch"
   ```

3. **Use**: Integrate the assistant ID into your applications or continue testing
   ```bash
   ai-json assistant test asst_123 "I went for a 30 minute run"
   ```

4. **Update**: Modify schema, prompt, or model as needed
   ```bash
   ai-json assistant update asst_123 -s ./new-schema.json
   ```

5. **Manage**: List, update, or delete assistants
   ```bash
   ai-json assistant list
   ai-json assistant delete asst_123 --yes
   ```

## REST API

When running in server mode, the following endpoints are available:

```bash
# Start server
ai-json server

# Make requests
curl -X POST http://localhost:3000/ask \
  -H "Content-Type: application/json" \
  -d '{"input": "What should I eat?", "model": "gpt-4o-mini"}'

curl -X POST http://localhost:3000/bulk \
  -H "Content-Type: application/json" \
  -d '{"inputs": ["Input 1", "Input 2"], "model": "claude-3-5-sonnet-latest"}'

# Get available models
curl http://localhost:3000/models
```

## Development

```bash
# Start development with hot reload
npm start

# Start development server
npm run dev

# Build the project
npm run build

# Install globally from local source
npm run local

# Refresh dependencies
npm run refresh
```

## License

MIT License

## Acknowledgments

- OpenAI API
- Anthropic Claude API  
- Mistral AI API
- LlamaAI API
