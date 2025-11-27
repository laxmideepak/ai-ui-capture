import OpenAI from 'openai';
import { config } from './config';
import fs from 'fs/promises';

interface ActionDecision {
  type: 'click' | 'type' | 'wait' | 'navigate' | 'complete' | 'scroll';
  target: string;
  value?: string;
  reasoning: string;
}

interface GPTResponse {
  stateDescription: string;
  nextAction: ActionDecision;
  isKeyState: boolean;
  progressAssessment: number;
}

interface TaskPlan {
  taskName: string;
  estimatedSteps: number;
  keyMilestones: string[];
  startingUrl: string;
  complexity: 'low' | 'medium' | 'high';
  notes?: string;
}

export class GPT4Client {
  private client: OpenAI;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
    this.client = new OpenAI({ apiKey });
  }

  async analyzeScreenshot(imagePath: string, prompt: string): Promise<GPTResponse> {
    const imageBase64 = await this.encodeImage(imagePath);
    
    const response = await this.client.chat.completions.create({
      model: config.openai.model,
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
      max_tokens: config.openai.maxTokens,
      temperature: config.openai.temperature,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0].message.content;
    if (!content?.trim()) {
      throw new Error('Empty response from GPT-4V');
    }

    let parsed: GPTResponse;
    try {
      parsed = JSON.parse(content) as GPTResponse;
    } catch (error) {
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

  async planTask(prompt: string): Promise<TaskPlan> {
    const response = await this.client.chat.completions.create({
      model: config.openai.model,
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

    let parsed: TaskPlan;
    try {
      parsed = JSON.parse(content) as TaskPlan;
    } catch (error) {
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

  private async encodeImage(imagePath: string): Promise<string> {
    const buffer = await fs.readFile(imagePath);
    return buffer.toString('base64');
  }
}
