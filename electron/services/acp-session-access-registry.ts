export type AcpSessionAccessContext = {
  sessionKey: string;
  generation: number;
  workspaceRoot: string;
  executionCwd: string;
  /** False when the cwd belongs to the remote Gateway host, not this desktop. */
  localAccess?: false;
};

export class AcpSessionAccessRegistry {
  private activeGrant: AcpSessionAccessContext | null = null;

  async prepareGrant(input: AcpSessionAccessContext): Promise<AcpSessionAccessContext> {
    // ACP is connected to the user-supplied remote Gateway. Its cwd belongs to
    // that host and must never be resolved or authorized against this desktop.
    return { ...input, localAccess: false };
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
