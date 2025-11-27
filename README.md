# AI UI Capture Agent

A production-grade web automation agent powered by GPT-4 Vision that can interact with web applications through natural language instructions. The agent uses computer vision to understand UI states and execute complex multi-step tasks across different web applications.

## 🚀 Features

- **Vision-Based Navigation**: Uses GPT-4 Vision to analyze screenshots and understand UI context
- **Multi-App Support**: Works with Linear, Notion, Asana, and other web applications
- **Session Persistence**: Saves browser sessions to avoid repeated logins
- **Intelligent Element Finding**: Advanced element detection with label-to-input resolution
- **Auto-Save Detection**: Automatically detects and clicks save buttons in settings pages
- **Recovery Mechanisms**: Built-in loop detection and recovery strategies
- **Progress Tracking**: Real-time progress assessment and key state capture
- **Chain-of-Thought Planning**: Pre-execution planning for better task breakdown

## 🏗️ Architecture

The agent follows a modular architecture:

```
┌─────────────────┐
│  NavigationAgent│  ← Orchestrates task execution
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
┌───▼───┐ ┌──▼──────┐
│  GPT  │ │Playwright│
│Client │ │ Manager  │
└───────┘ └──────────┘
```

### Core Components

- **NavigationAgent**: Main orchestrator that manages task execution, progress tracking, and recovery
- **GPT4Client**: Handles OpenAI API interactions for vision analysis and task planning
- **PlaywrightManager**: Manages browser automation, element finding, and action execution
- **Element Finding**: Intelligent element detection with special handling for labels, dialogs, and app-specific patterns

## 📦 Installation

### Prerequisites

- Node.js 18+ 
- npm or yarn
- OpenAI API key with GPT-4 Vision access

### Setup

```bash
# Clone the repository
git clone https://github.com/laxmideepak/ai-ui-capture.git
cd ai-ui-capture

# Install dependencies
npm install

# Configure environment variables
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY
```

### Environment Variables

Create a `.env` file in the project root:

```env
OPENAI_API_KEY=sk-your-api-key-here
OPENAI_MODEL=gpt-4o
HEADLESS=false
SLOW_MO=800
TIMEOUT=45000
```

## 🎯 Usage

### Basic Usage

```bash
# Run a task
npm start "Create a new issue titled 'Fix bug' in Linear"

# Or with custom task
npm start "Go to settings and update my name to 'John Doe'"
```

### Login Setup

Before running tasks, set up authentication:

```bash
# Run login script (opens browser for manual login)
npm run login
```

This will save your session to `output/auth.json` for future use.

### Example Tasks

```bash
# Linear tasks
npm start "Create a new issue with priority High in Linear"
npm start "Change the status of issue DEE-9 to In Progress"
npm start "Assign the first issue to yourself"

# Settings tasks
npm start "Go to settings, update my name to 'Demo Name', and capture the state"
npm start "Open notifications"

# Navigation tasks
npm start "Navigate to the projects page in Linear"
```

## 🔧 Configuration

Configuration is managed through `src/utils/config.ts` and environment variables:

### Browser Settings

- `HEADLESS`: Run browser in headless mode (default: `false`)
- `SLOW_MO`: Delay between actions in ms (default: `800`)
- `TIMEOUT`: Page timeout in ms (default: `45000`)
- `VIEWPORT_WIDTH` / `VIEWPORT_HEIGHT`: Browser viewport size

### Agent Settings

- `MAX_STEPS`: Maximum steps per task (default: `20`)
- `RETRIES`: Number of retries for failed actions (default: `2`)

### App URLs

Configure workspace URLs in `config.ts` or via environment variables:

```typescript
urls: {
  linear: process.env.LINEAR_WORKSPACE_URL || 'https://linear.app',
  notion: process.env.NOTION_WORKSPACE_URL || 'https://notion.so',
  asana: process.env.ASANA_WORKSPACE_URL || 'https://app.asana.com',
}
```

## 📁 Project Structure

```
ai-ui-capture/
├── src/
│   ├── agents/
│   │   └── navigation-agent.ts    # Main agent orchestrator
│   ├── automation/
│   │   └── playwright-manager.ts  # Browser automation & element finding
│   ├── output/
│   │   └── generate-dataset.ts    # Dataset generation for runs
│   ├── scripts/
│   │   └── login.ts               # Login session setup
│   ├── utils/
│   │   ├── config.ts              # Configuration management
│   │   ├── gpt-client.ts          # OpenAI API client
│   │   └── prompts.ts             # GPT prompts for vision & planning
│   └── index.ts                   # Entry point
├── output/
│   ├── auth.json                  # Saved browser session
│   └── screenshots/               # Task execution screenshots
├── dataset/                        # Generated datasets from runs
├── package.json
├── tsconfig.json
└── .env                           # Environment variables (not in git)
```

## 🧠 How It Works

### 1. Task Planning

Before execution, the agent creates a plan:
- Estimates number of steps
- Identifies key milestones
- Assesses complexity (low/medium/high)

### 2. Vision-Based Decision Making

For each step:
1. Captures screenshot of current state
2. Extracts simplified DOM context
3. Sends to GPT-4 Vision with task context
4. Receives next action decision

### 3. Element Finding

Intelligent element detection:
- **Dialog-first strategy**: Prioritizes elements in modals/dialogs
- **Label resolution**: Automatically finds input fields from labels
- **App-specific patterns**: Special handling for Linear, Notion, Asana
- **Multiple fallback strategies**: Tries various selectors if initial search fails

### 4. Action Execution

Executes actions with retry logic:
- **Click**: Finds and clicks elements with auto-menu selection
- **Type**: Handles both standard inputs and contenteditable divs
- **Navigate**: URL-based navigation
- **Auto-submit**: Automatically submits forms (Cmd+Enter for Linear)

### 5. Progress Tracking

- Tracks progress assessment (0-100%)
- Identifies key states for screenshot capture
- Detects completion conditions
- Monitors for stuck loops

### 6. Recovery Mechanisms

- Detects repeated actions with no progress
- Attempts alternative approaches
- Clears failed attempts from history
- Provides recovery context to GPT

## 🎨 Key Capabilities

### Element Finding

- **Label-to-Input Resolution**: Automatically resolves labels to their associated input fields
- **Dialog Awareness**: Prioritizes elements in modals/dialogs
- **Status Field Detection**: Special handling for status dropdowns and badges
- **Assignee Field Detection**: Finds assignee-related elements
- **Notification Detection**: Finds notification icons and buttons

### Auto-Save Detection

When typing in settings/profile pages:
- Automatically detects save buttons
- Clicks save after typing
- Falls back to Tab+Enter if no save button found

### Session Management

- Saves browser sessions after login
- Loads saved sessions on startup
- Persists sessions across task runs

## 🔍 Example Output

The agent generates detailed datasets for each task run:

```
dataset/
└── task_name/
    ├── step_000.png
    ├── step_001.png
    ├── README.md          # Human-readable execution log
    ├── metadata.json      # Full execution metadata
    └── run.json          # Machine-readable trace
```

## 🛠️ Development

### Running in Development

```bash
# Install dependencies
npm install

# Run with TypeScript
npx tsx src/index.ts "Your task here"

# Run login script
npx tsx src/scripts/login.ts
```

### Code Quality

The codebase follows production best practices:
- TypeScript with strict type checking
- Comprehensive error handling
- Modular, maintainable architecture
- Clean, readable code with helpful comments

## 📝 Notes

- **Session Files**: The `output/auth.json` file contains your browser session. Keep it secure and don't commit it to version control.
- **API Costs**: Each task execution makes multiple GPT-4 Vision API calls. Monitor your usage.
- **Rate Limits**: The agent includes retry logic, but be aware of OpenAI rate limits.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is open source and available under the MIT License.

## 🙏 Acknowledgments

- Built with [Playwright](https://playwright.dev/) for browser automation
- Powered by [OpenAI GPT-4 Vision](https://openai.com/gpt-4)
- TypeScript for type safety

---

**Made with ❤️ for intelligent web automation**

