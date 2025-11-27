"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GPT4Client = void 0;
const openai_1 = __importDefault(require("openai"));
const config_1 = require("./config");
const promises_1 = __importDefault(require("fs/promises"));
class GPT4Client {
    client;
    constructor() {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY environment variable is required');
        }
        this.client = new openai_1.default({ apiKey });
    }
    async analyzeScreenshot(imagePath, prompt) {
        const imageBase64 = await this.encodeImage(imagePath);
        const response = await this.client.chat.completions.create({
            model: config_1.config.openai.model,
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        {
                            type: 'image_url',
                            image_url: { url: `data:image/png;base64,${imageBase64}` },
                        },
                    ],
                },
            ],
            max_tokens: config_1.config.openai.maxTokens,
            temperature: config_1.config.openai.temperature,
            response_format: { type: 'json_object' },
        });
        const content = response.choices[0].message.content;
        if (!content?.trim()) {
            throw new Error('Empty response from GPT-4V');
        }
        let parsed;
        try {
            parsed = JSON.parse(content);
        }
        catch (error) {
            console.error('Failed to parse GPT response as JSON');
            console.error('Raw response:', content);
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Invalid JSON response from GPT: ${errorMessage}`);
        }
        if (!parsed.nextAction) {
            console.error('Missing nextAction in GPT response');
            console.error('Parsed response:', JSON.stringify(parsed, null, 2));
            throw new Error('Invalid GPT response: missing nextAction');
        }
        if (!parsed.nextAction.type || !parsed.nextAction.target) {
            console.error('Missing required fields in nextAction');
            console.error('Parsed response:', JSON.stringify(parsed, null, 2));
            throw new Error('Invalid GPT response: missing type or target in nextAction');
        }
        if (typeof parsed.progressAssessment !== 'number' || parsed.progressAssessment < 0 || parsed.progressAssessment > 100) {
            console.warn('Invalid progressAssessment, defaulting to 0');
            parsed.progressAssessment = 0;
        }
        if (typeof parsed.isKeyState !== 'boolean') {
            parsed.isKeyState = false;
        }
        return parsed;
    }
    async planTask(prompt) {
        const response = await this.client.chat.completions.create({
            model: config_1.config.openai.model,
            messages: [
                {
                    role: 'user',
                    content: prompt,
                },
            ],
            max_tokens: 500,
            temperature: 0.3,
            response_format: { type: 'json_object' },
        });
        const content = response.choices[0].message.content;
        if (!content?.trim()) {
            throw new Error('Empty planning response from GPT');
        }
        let parsed;
        try {
            parsed = JSON.parse(content);
        }
        catch (error) {
            console.error('Failed to parse planning response as JSON');
            console.error('Raw response:', content);
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Invalid JSON planning response: ${errorMessage}`);
        }
        if (!parsed.estimatedSteps || parsed.estimatedSteps < 1) {
            parsed.estimatedSteps = 5;
        }
        if (!parsed.complexity) {
            parsed.complexity = 'medium';
        }
        if (!parsed.keyMilestones) {
            parsed.keyMilestones = [];
        }
        return parsed;
    }
    async encodeImage(imagePath) {
        const buffer = await promises_1.default.readFile(imagePath);
        return buffer.toString('base64');
    }
}
exports.GPT4Client = GPT4Client;
