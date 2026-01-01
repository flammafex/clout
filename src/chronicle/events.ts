/**
 * Simple event emitter for Chronicle
 */

export class Emitter {
  private listeners: Map<string, Function[]> = new Map();

  on(event: string, listener: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(listener);
  }

  emit(event: string, data: any): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        handler(data);
      }
    }
  }

  off(event: string, listener: Function): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      const index = handlers.indexOf(listener);
      if (index !== -1) {
        handlers.splice(index, 1);
      }
    }
  }
}
