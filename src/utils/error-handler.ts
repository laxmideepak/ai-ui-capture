export class AutomationError extends Error {
  constructor(
    message: string,
    public code: string,
    public recoverable: boolean,
    public context?: any
  ) {
    super(message);
    this.name = 'AutomationError';
  }
}

export class ErrorHandler {
  async handleError(error: Error, context: any): Promise<{ recovered: boolean; action?: string }> {
    if (error.message.includes('Timeout')) {
      return this.handleTimeout(context);
    }
    
    if (error.message.includes('Element not found') || error.message.includes('not found')) {
      return this.handleElementNotFound(context);
    }
    
    if (error.message.includes('Navigation failed') || error.message.includes('navigation')) {
      return this.handleNavigationFailure(context);
    }
    
    return { recovered: false };
  }

  private async handleTimeout(context: any): Promise<{ recovered: boolean; action?: string }> {
    console.log('⏱️ Timeout detected - increasing wait time...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    return {
      recovered: true,
      action: 'retry_with_longer_timeout'
    };
  }

  private async handleElementNotFound(context: any): Promise<{ recovered: boolean; action?: string }> {
    console.log('🔍 Element not found - trying alternative selectors...');
    return {
      recovered: true,
      action: 'try_alternative_selectors'
    };
  }

  private async handleNavigationFailure(context: any): Promise<{ recovered: boolean; action?: string }> {
    console.log('🌐 Navigation failed - refreshing page...');
    return {
      recovered: true,
      action: 'refresh_and_retry'
    };
  }
}

