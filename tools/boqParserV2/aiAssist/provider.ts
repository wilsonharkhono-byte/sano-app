export interface AiProvider {
  complete(systemPrompt: string, userPrompt: string): Promise<string>;
}

export class NullProvider implements AiProvider {
  async complete(): Promise<string> {
    return JSON.stringify({ result: null, confidence: 0, reasoning: 'no AI provider configured' });
  }
}

export class MockProvider implements AiProvider {
  private queue: string[] = [];
  enqueue(response: string | object): void {
    this.queue.push(typeof response === 'string' ? response : JSON.stringify(response));
  }
  async complete(): Promise<string> {
    const next = this.queue.shift();
    if (next == null) throw new Error('MockProvider: no queued response');
    return next;
  }
}

let current: AiProvider = new NullProvider();

export function configureAiProvider(p: AiProvider): void { current = p; }
export function getAiProvider(): AiProvider { return current; }
export function resetAiProvider(): void { current = new NullProvider(); }
