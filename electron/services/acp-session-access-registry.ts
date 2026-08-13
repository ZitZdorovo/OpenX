export type AcpSessionAccessContext = {
  sessionKey: string;
  generation: number;
  workspaceRoot: string;
  executionCwd: string;
  /** Whether attachment references may resolve against this desktop filesystem. */
  localAccess?: boolean;
};

export class AcpSessionAccessRegistry {
  private activeGrant: AcpSessionAccessContext | null = null;

  async prepareGrant(input: AcpSessionAccessContext): Promise<AcpSessionAccessContext> {
    // OpenX is a personal desktop client, so existing local attachment paths
    // remain available. Callers may still pass localAccess: false explicitly
    // for a deliberately isolated session.
    return { ...input, localAccess: input.localAccess ?? true };
  }

  snapshot(): AcpSessionAccessContext | null {
    return this.activeGrant ? { ...this.activeGrant } : null;
  }

  commitGrant(context: AcpSessionAccessContext): void {
    this.activeGrant = { ...context };
  }

  restore(snapshot: AcpSessionAccessContext | null): void {
    this.activeGrant = snapshot ? { ...snapshot } : null;
  }

  get(sessionKey: string, generation: number): AcpSessionAccessContext | null {
    if (this.activeGrant?.sessionKey !== sessionKey || this.activeGrant.generation !== generation) return null;
    return { ...this.activeGrant };
  }
}
