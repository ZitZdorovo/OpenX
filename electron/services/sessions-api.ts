import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { GatewayManager } from '../gateway/manager';
import type { RawMessage } from '@shared/chat/types';
import { isRecord } from './payload-utils';

type SessionPayload = {
  id?: unknown;
  title?: unknown;
  sessionKey?: unknown;
  agentId?: unknown;
  sessionId?: unknown;
  sessionKeys?: unknown;
  limit?: unknown;
};

function sessionKey(payload: unknown): string {
  const body = isRecord(payload) ? payload as SessionPayload : {};
  const value = typeof body.id === 'string' ? body.id : typeof body.sessionKey === 'string' ? body.sessionKey : '';
  if (!value.trim()) throw new Error('Session key is required');
  return value.trim();
}

function limitOf(payload: unknown, fallback = 200): number {
  const value = isRecord(payload) ? (payload as SessionPayload).limit : undefined;
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.floor(value)) : fallback;
}

export function createSessionsApi(gatewayManager: GatewayManager): CompleteHostServiceRegistry['sessions'] {
  return {
    delete: async (payload) => {
      await gatewayManager.rpc('sessions.delete', {
        key: sessionKey(payload),
        deleteTranscript: true,
      });
      return { success: true };
    },
    rename: async (payload) => {
      const body = isRecord(payload) ? payload as SessionPayload : {};
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      if (!title) throw new Error('Label cannot be empty');
      await gatewayManager.rpc('sessions.patch', { key: sessionKey(payload), label: title });
      return { success: true };
    },
    summaries: async (payload) => {
      const body = isRecord(payload) ? payload as SessionPayload : {};
      const requested = Array.isArray(body.sessionKeys)
        ? new Set(body.sessionKeys.filter((key): key is string => typeof key === 'string'))
        : null;
      const response = await gatewayManager.rpc<{ sessions?: Array<Record<string, unknown>> }>('sessions.list', {
        limit: limitOf(payload, requested?.size || 200),
      });
      const sessions = Array.isArray(response.sessions) ? response.sessions : [];
      return {
        success: true,
        summaries: sessions.flatMap((entry) => {
          const key = typeof entry.key === 'string' ? entry.key : '';
          if (!key || (requested && !requested.has(key))) return [];
          const label = typeof entry.label === 'string' ? entry.label : null;
          const updatedAt = typeof entry.updatedAt === 'number'
            ? entry.updatedAt
            : typeof entry.updatedAt === 'string' ? Date.parse(entry.updatedAt) : null;
          const workspacePath = typeof entry.cwd === 'string'
            ? entry.cwd
            : typeof entry.workspace === 'string' ? entry.workspace : null;
          return [{
            sessionKey: key,
            firstUserText: label,
            lastTimestamp: updatedAt && Number.isFinite(updatedAt) ? updatedAt : null,
            workspacePath,
          }];
        }),
      };
    },
    history: async (payload) => {
      const body = isRecord(payload) ? payload as SessionPayload : {};
      const key = typeof body.sessionKey === 'string' && body.sessionKey.trim()
        ? body.sessionKey.trim()
        : typeof body.agentId === 'string' && typeof body.sessionId === 'string'
          ? `agent:${body.agentId.trim()}:${body.sessionId.trim()}`
          : '';
      if (!key) return { success: false, error: 'Session key is required' };
      const response = await gatewayManager.rpc<{ messages?: RawMessage[] }>('chat.history', {
        sessionKey: key,
        limit: limitOf(payload),
      });
      return { success: true, messages: Array.isArray(response.messages) ? response.messages : [] };
    },
    turnTimings: async (payload) => {
      sessionKey(payload);
      if (!gatewayManager.isConnected()) return { success: false, error: 'Gateway not connected' };
      return { success: true, timings: [] };
    },
  };
}
