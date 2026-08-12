import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { GatewayManager } from '../gateway/manager';
import { logger } from '../utils/logger';
import { getAcpTraceSnapshot, recordRendererAcpTrace } from './acp-trace';

const DEFAULT_TAIL_LINES = 200;

type DiagnosticsApiContext = {
  gatewayManager: GatewayManager;
};

export function createDiagnosticsApi(ctx: DiagnosticsApiContext): CompleteHostServiceRegistry['diagnostics'] {
  return {
    gatewaySnapshot: async () => {
      const channels = await ctx.gatewayManager.rpc('channels.status', { probe: false });
      const diagnostics = ctx.gatewayManager.getDiagnostics?.() ?? {
        consecutiveHeartbeatMisses: 0,
        consecutiveRpcFailures: 0,
      };
      const gatewayStatus = ctx.gatewayManager.getStatus();
      const gateway = {
        ...gatewayStatus,
        capabilities: typeof ctx.gatewayManager.getCapabilitySnapshot === 'function'
          ? ctx.gatewayManager.getCapabilitySnapshot()
          : undefined,
      };
      return {
        capturedAt: Date.now(),
        platform: process.platform,
        gateway,
        diagnostics,
        channels,
        openxLogTail: await logger.readLogFile(DEFAULT_TAIL_LINES),
      };
    },
    acpTrace: async () => getAcpTraceSnapshot(),
    recordAcpTrace: async (payload) => recordRendererAcpTrace(payload),
  };
}
