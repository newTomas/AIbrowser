import { Thought, Action, Observation, TaggerElement, TabInfo } from '@/types';
import { logger } from '@/cli/Logger';

export interface MemoryEntry {
  id: string;
  timestamp: Date;
  thought: Thought;
  action?: Action;
  observation?: Observation;
  success: boolean;
  error?: string;
  tags: string[];
}

export interface LearningPattern {
  pattern: string;
  success_rate: number;
  occurrences: number;
  last_seen: Date;
  context: string;
}

export class AgentMemory {
  private memories: MemoryEntry[] = [];
  private patterns: Map<string, LearningPattern> = new Map();
  private maxMemories: number = 100;
  private maxPatterns: number = 50;

  /**
   * Add a new memory entry
   */
  addMemory(
    thought: Thought,
    action?: Action,
    observation?: Observation,
    success: boolean = true,
    error?: string,
    tags: string[] = []
  ): string {
    const id = this.generateId();
    const memory: MemoryEntry = {
      id,
      timestamp: new Date(),
      thought,
      action,
      observation,
      success,
      error,
      tags
    };

    this.memories.push(memory);

    // Limit memory size
    if (this.memories.length > this.maxMemories) {
      this.memories.shift();
    }

    // Update learning patterns
    this.updatePatterns(memory);

    logger.debug(`Added memory entry ${id}: ${success ? 'success' : 'failure'}`);
    return id;
  }

  /**
   * Get relevant memories for current context
   */
  getRelevantMemories(
    currentUrl?: string,
    actionType?: string,
    maxResults: number = 5
  ): MemoryEntry[] {
    let relevantMemories = this.memories;

    // Filter by URL if provided
    if (currentUrl) {
      const domain = this.extractDomain(currentUrl);
      relevantMemories = relevantMemories.filter(memory =>
        memory.observation?.page_info.url?.includes(domain) ||
        memory.tags.includes(domain)
      );
    }

    // Filter by action type if provided
    if (actionType) {
      relevantMemories = relevantMemories.filter(memory =>
        memory.action?.tool === actionType
      );
    }

    // Sort by recency and success
    relevantMemories.sort((a, b) => {
      // Prioritize successful memories
      if (a.success && !b.success) return -1;
      if (!a.success && b.success) return 1;

      // Then by recency
      return b.timestamp.getTime() - a.timestamp.getTime();
    });

    return relevantMemories.slice(0, maxResults);
  }

  /**
   * Get failed memories for learning
   */
  getFailedMemories(actionType?: string): MemoryEntry[] {
    return this.memories.filter(memory =>
      !memory.success && (!actionType || memory.action?.tool === actionType)
    );
  }

  /**
   * Get learning patterns
   */
  getPatterns(): LearningPattern[] {
    return Array.from(this.patterns.values())
      .sort((a, b) => b.success_rate - a.success_rate);
  }

  /**
   * Get context summary for LLM
   */
  getContextSummary(currentUrl?: string, actionType?: string): string {
    const relevantMemories = this.getRelevantMemories(currentUrl, actionType, 3);
    const failedMemories = this.getFailedMemories(actionType).slice(0, 2);
    const patterns = this.getPatterns().slice(0, 3);

    let summary = '';

    if (relevantMemories.length > 0) {
      summary += 'Relevant Past Experiences:\n';
      relevantMemories.forEach((memory, index) => {
        summary += `${index + 1}. ${memory.success ? '✓' : '✗'} `;
        if (memory.action) {
          summary += `${memory.action.tool}: ${JSON.stringify(memory.action.parameters)}`;
        }
        if (!memory.success && memory.error) {
          summary += ` (Error: ${memory.error})`;
        }
        summary += '\n';
      });
      summary += '\n';
    }

    if (failedMemories.length > 0) {
      summary += 'Past Failures to Avoid:\n';
      failedMemories.forEach((memory, index) => {
        summary += `${index + 1}. `;
        if (memory.action) {
          summary += `${memory.action.tool}: ${JSON.stringify(memory.action.parameters)}`;
        }
        if (memory.error) {
          summary += ` → ${memory.error}`;
        }
        summary += '\n';
      });
      summary += '\n';
    }

    if (patterns.length > 0) {
      summary += 'Learned Patterns:\n';
      patterns.forEach((pattern, index) => {
        summary += `${index + 1}. ${pattern.pattern} (${(pattern.success_rate * 100).toFixed(1)}% success rate)\n`;
      });
    }

    return summary || 'No relevant memories found.';
  }

  /**
   * Update learning patterns based on new memory
   */
  private updatePatterns(memory: MemoryEntry): void {
    if (!memory.action) return;

    // Create pattern key
    const patternKey = `${memory.action.tool}_${this.getActionSignature(memory.action)}`;

    // Update or create pattern
    const existingPattern = this.patterns.get(patternKey);
    if (existingPattern) {
      existingPattern.occurrences++;
      if (memory.success) {
        existingPattern.success_rate = (existingPattern.success_rate * (existingPattern.occurrences - 1) + 1) / existingPattern.occurrences;
      } else {
        existingPattern.success_rate = (existingPattern.success_rate * (existingPattern.occurrences - 1)) / existingPattern.occurrences;
      }
      existingPattern.last_seen = memory.timestamp;
    } else {
      this.patterns.set(patternKey, {
        pattern: `${memory.action.tool} on ${this.getContextSignature(memory)}`,
        success_rate: memory.success ? 1 : 0,
        occurrences: 1,
        last_seen: memory.timestamp,
        context: this.getContextSignature(memory)
      });
    }

    // Limit patterns size
    if (this.patterns.size > this.maxPatterns) {
      const sortedPatterns = Array.from(this.patterns.entries())
        .sort(([, a], [, b]) => a.last_seen.getTime() - b.last_seen.getTime());

      // Remove oldest patterns
      const toRemove = sortedPatterns.slice(0, sortedPatterns.length - this.maxPatterns);
      toRemove.forEach(([key]) => this.patterns.delete(key));
    }
  }

  /**
   * Get action signature for pattern matching
   */
  private getActionSignature(action: Action): string {
    // Normalize action parameters for pattern matching
    const normalized: Record<string, string> = {};

    Object.entries(action.parameters).forEach(([key, value]) => {
      if (typeof value === 'number') {
        normalized[key] = 'number';
      } else if (typeof value === 'string') {
        // For URLs, just note that it's a URL
        if (value.startsWith('http')) {
          normalized[key] = 'url';
        } else {
          normalized[key] = 'string';
        }
      } else {
        normalized[key] = typeof value;
      }
    });

    return JSON.stringify(normalized);
  }

  /**
   * Get context signature for pattern matching
   */
  private getContextSignature(memory: MemoryEntry): string {
    if (!memory.observation) return 'unknown';

    const url = memory.observation.page_info.url;
    const domain = this.extractDomain(url);
    const elementCount = memory.observation.elements.length;

    return `${domain} (${elementCount} elements)`;
  }

  /**
   * Extract domain from URL
   */
  private extractDomain(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace('www.', '');
    } catch {
      return 'unknown';
    }
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  /**
   * Search memories by text content
   */
  searchMemories(query: string, maxResults: number = 10): MemoryEntry[] {
    const lowerQuery = query.toLowerCase();

    return this.memories
      .filter(memory => {
        // Search in thought reasoning
        if (memory.thought.reasoning.toLowerCase().includes(lowerQuery)) {
          return true;
        }

        // Search in action parameters
        if (memory.action && JSON.stringify(memory.action.parameters).toLowerCase().includes(lowerQuery)) {
          return true;
        }

        // Search in error messages
        if (memory.error && memory.error.toLowerCase().includes(lowerQuery)) {
          return true;
        }

        // Search in tags
        if (memory.tags.some(tag => tag.toLowerCase().includes(lowerQuery))) {
          return true;
        }

        return false;
      })
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, maxResults);
  }

  /**
   * Get memory statistics
   */
  getStatistics(): {
    totalMemories: number;
    successRate: number;
    mostUsedActions: Array<{ action: string; count: number }>;
    topDomains: Array<{ domain: string; count: number }>;
  } {
    const totalMemories = this.memories.length;
    const successCount = this.memories.filter(m => m.success).length;
    const successRate = totalMemories > 0 ? successCount / totalMemories : 0;

    // Most used actions
    const actionCounts = new Map<string, number>();
    this.memories.forEach(memory => {
      if (memory.action) {
        const count = actionCounts.get(memory.action.tool) || 0;
        actionCounts.set(memory.action.tool, count + 1);
      }
    });

    const mostUsedActions = Array.from(actionCounts.entries())
      .map(([action, count]) => ({ action, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Top domains
    const domainCounts = new Map<string, number>();
    this.memories.forEach(memory => {
      if (memory.observation?.page_info.url) {
        const domain = this.extractDomain(memory.observation.page_info.url);
        const count = domainCounts.get(domain) || 0;
        domainCounts.set(domain, count + 1);
      }
    });

    const topDomains = Array.from(domainCounts.entries())
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      totalMemories,
      successRate,
      mostUsedActions,
      topDomains
    };
  }

  /**
   * Clear old memories (older than specified days)
   */
  clearOldMemories(daysOld: number = 30): void {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const originalLength = this.memories.length;
    this.memories = this.memories.filter(memory => memory.timestamp > cutoffDate);

    logger.debug(`Cleared ${originalLength - this.memories.length} old memories`);
  }

  /**
   * Export memories to JSON
   */
  exportMemories(): string {
    return JSON.stringify({
      memories: this.memories,
      patterns: Array.from(this.patterns.entries()),
      exportedAt: new Date().toISOString()
    }, null, 2);
  }

  /**
   * Import memories from JSON
   */
  importMemories(jsonData: string): void {
    try {
      const data = JSON.parse(jsonData);

      if (data.memories && Array.isArray(data.memories)) {
        this.memories = data.memories.map((m: any) => ({
          ...m,
          timestamp: new Date(m.timestamp)
        }));
      }

      if (data.patterns && Array.isArray(data.patterns)) {
        this.patterns = new Map(
          data.patterns.map(([key, pattern]: [string, any]) => [
            key,
            {
              ...pattern,
              last_seen: new Date(pattern.last_seen)
            }
          ])
        );
      }

      logger.info('Successfully imported memories');
    } catch (error) {
      logger.error('Failed to import memories:', error);
      throw error;
    }
  }

  /**
   * Clear all memories
   */
  clearAll(): void {
    this.memories = [];
    this.patterns.clear();
    logger.debug('All memories cleared');
  }

  /**
   * Get memory by ID
   */
  getMemoryById(id: string): MemoryEntry | undefined {
    return this.memories.find(memory => memory.id === id);
  }

  /**
   * Delete memory by ID
   */
  deleteMemory(id: string): boolean {
    const index = this.memories.findIndex(memory => memory.id === id);
    if (index !== -1) {
      this.memories.splice(index, 1);
      logger.debug(`Deleted memory ${id}`);
      return true;
    }
    return false;
  }
}