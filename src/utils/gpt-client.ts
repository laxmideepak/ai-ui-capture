import fs from 'fs/promises';
import OpenAI from 'openai';
import { config } from './config';

/**
 * Represents a single action decision from the Vision API.
 */
export interface ActionDecision {
  type: 'click' | 'type' | 'wait' | 'navigate' | 'complete' | 'scroll';
  target: string;
  value?: string;
  reasoning: string;
}

/**
 * Complete response structure from the Vision API after analyzing a screenshot.
 */
export interface GPTResponse {
  stateDescription: string;
  nextAction: ActionDecision;
  isKeyState: boolean;
  progressAssessment: number;
}

/**
 * Task planning response structure from the Planning API.
 */
export interface TaskPlan {
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
      throw new Error('GPT4Client: OPENAI_API_KEY environment variable is required');
    }
    this.client = new OpenAI({ apiKey });
  }

  async analyzeScreenshot(imagePath: string, prompt: string): Promise<GPTResponse> {
    const base64Image = await this.encodeImage(imagePath);
    
    const response = await this.client.chat.completions.create({
      model: config.openai.model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${base64Image}` },
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
      throw new Error('GPT4Client: Empty response received from Vision API');
    }

    const parsed = this.safeJsonParse<GPTResponse>(content);
    return this.validateResponse(parsed);
  }

  async planTask(prompt: string): Promise<TaskPlan> {
    const response = await this.client.chat.completions.create({
      model: config.openai.model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0].message.content;
    if (!content?.trim()) {
      throw new Error('GPT4Client: Empty planning response received');
    }

    const parsed = this.safeJsonParse<TaskPlan>(content);
    return this.validateTaskPlan(parsed);
  }

  // --- Helpers ---

  private async encodeImage(imagePath: string): Promise<string> {
    const buffer = await fs.readFile(imagePath);
    return buffer.toString('base64');
  }

  private safeJsonParse<T>(content: string): T {
    try {
      return JSON.parse(content) as T;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('GPT4Client: JSON Parse Error');
      console.error('Raw Content:', content);
      throw new Error(`Invalid JSON response from GPT: ${msg}`);
    }
  }

  /**
   * Validates and sanitizes the Vision API response.
   * Ensures essential fields exist and numbers are within range.
   */
  private validateResponse(data: Partial<GPTResponse>): GPTResponse {
    if (!data.nextAction) {
      this.logInvalidResponse(data, 'missing nextAction');
      throw new Error('Invalid GPT response: missing nextAction');
    }

    const { type, target } = data.nextAction;
    if (!type || !target) {
      this.logInvalidResponse(data, 'missing type or target in nextAction');
      throw new Error('Invalid GPT response: missing type or target in nextAction');
    }

    // Sanitize numeric fields
    let progress = data.progressAssessment;
    if (typeof progress !== 'number' || progress < 0 || progress > 100) {
      console.warn('GPT4Client: Invalid progressAssessment, defaulting to 0');
      progress = 0;
    }

    return {
      stateDescription: data.stateDescription || 'No description provided',
      nextAction: {
        type,
        target,
        value: data.nextAction.value,
        reasoning: data.nextAction.reasoning || 'No reasoning provided',
      },
      isKeyState: typeof data.isKeyState === 'boolean' ? data.isKeyState : false,
      progressAssessment: progress,
    };
  }

  /**
   * Validates and sanitizes the Planning API response.
   * Applies defaults for missing optional fields.
   */
  private validateTaskPlan(data: Partial<TaskPlan>): TaskPlan {
    return {
      taskName: data.taskName || 'unnamed_task',
      estimatedSteps: (data.estimatedSteps && data.estimatedSteps > 0) ? data.estimatedSteps : 5,
      keyMilestones: Array.isArray(data.keyMilestones) ? data.keyMilestones : [],
      startingUrl: data.startingUrl || '',
      complexity: data.complexity || 'medium',
      notes: data.notes,
    };
  }

  private logInvalidResponse(data: unknown, reason: string): void {
    console.error(`GPT4Client: Validation failed (${reason})`);
    console.error('Parsed Data:', JSON.stringify(data, null, 2));
  }
}
