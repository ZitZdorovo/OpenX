import type { GatewayManager } from '../gateway/manager';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { mutateOpenClawConfig, readOpenClawConfigSnapshot } from '../gateway/config-delivery';
import { isRecord } from './payload-utils';

type ChannelAccountStatus = {
  accountId?: string;
  configured?: boolean;
  connected?: boolean;
  running?: boolean;
  lastError?: string;
  name?: string;
};

type ChannelsStatus = {
  channelAccounts?: Record<string, ChannelAccountStatus[]>;
  channelDefaultAccountId?: Record<string, string>;
};

type ConfigDocument = {
  channels?: Record<string, Record<string, unknown>>;
  bindings?: Array<Record<string, unknown>>;
};

const requireText = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
};

const channelType = (payload: unknown) => requireText(isRecord(payload) ? payload.channelType : undefined, 'channelType');
const accountId = (payload: unknown) => isRecord(payload) && typeof payload.accountId === 'string' && payload.accountId.trim()
  ? payload.accountId.trim()
  : 'default';

function publicValues(section: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(section).flatMap(([key, value]) => {
    if (key === 'accounts' || key === 'enabled' || key === 'defaultAccount') return [];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return [[key, String(value)]];
    }
    return [];
  }));
}

function bindingMatches(binding: Record<string, unknown>, type: string, account?: string): boolean {
  const match = isRecord(binding.match) ? binding.match : {};
  return match.channel === type && (!account || match.accountId === account);
}

export function createChannelsApi({
  gatewayManager,
}: {
  gatewayManager: GatewayManager;
}): CompleteHostServiceRegistry['channels'] {
  const readConfig = async () => (await readOpenClawConfigSnapshot()).config as ConfigDocument;

  return {
    configured: async () => {
      const config = await readConfig();
      return { success: true, channels: Object.keys(config.channels ?? {}) };
    },
    accounts: async (payload) => {
      const status = await gatewayManager.rpc<ChannelsStatus>('channels.status', { probe: payload?.probe === true });
      const config = await readConfig();
      const allTypes = new Set([
        ...Object.keys(config.channels ?? {}),
        ...Object.keys(status.channelAccounts ?? {}),
      ]);
      const channels = [...allTypes].sort().map((type) => {
        const rows = status.channelAccounts?.[type] ?? [];
        const section = config.channels?.[type] ?? {};
        const defaultId = status.channelDefaultAccountId?.[type]
          || (typeof section.defaultAccount === 'string' ? section.defaultAccount : 'default');
        const configuredAccounts = isRecord(section.accounts) ? section.accounts : {};
        const ids = new Set([...Object.keys(configuredAccounts), ...rows.map((row) => row.accountId || 'default')]);
        if (ids.size === 0) ids.add('default');
        const accounts = [...ids].map((id) => {
          const row = rows.find((candidate) => (candidate.accountId || 'default') === id);
          const statusValue = row?.lastError ? 'error' : row?.connected ? 'connected' : row?.running ? 'connecting' : 'disconnected';
          const binding = (config.bindings ?? []).find((candidate) => bindingMatches(candidate, type, id));
          return {
            accountId: id,
            name: row?.name || id,
            configured: row?.configured ?? Boolean(configuredAccounts[id] || Object.keys(section).length),
            status: statusValue as 'connected' | 'connecting' | 'disconnected' | 'error',
            statusReason: row?.lastError,
            lastError: row?.lastError,
            isDefault: id === defaultId,
            agentId: typeof binding?.agentId === 'string' ? binding.agentId : undefined,
          };
        });
        const aggregate = accounts.some((row) => row.status === 'connected') ? 'connected'
          : accounts.some((row) => row.status === 'error') ? 'error' : 'disconnected';
        return { channelType: type, defaultAccountId: defaultId, status: aggregate as 'connected' | 'disconnected' | 'error', accounts };
      });
      return { success: true, channels };
    },
    targets: async (payload) => ({
      success: true,
      channelType: channelType(payload),
      accountId: accountId(payload),
      targets: [],
    }),
    setDefaultAccount: async (payload) => {
      const type = channelType(payload);
      const id = requireText(payload.accountId, 'accountId');
      await mutateOpenClawConfig((raw) => {
        const config = raw as ConfigDocument;
        const section = config.channels?.[type];
        if (!section) throw new Error(`Channel "${type}" is not configured`);
        section.defaultAccount = id;
      });
      return { success: true };
    },
    bindingSave: async (payload) => {
      const type = channelType(payload);
      const id = requireText(payload.accountId, 'accountId');
      const agent = requireText(payload.agentId, 'agentId');
      await mutateOpenClawConfig((raw) => {
        const config = raw as ConfigDocument;
        const bindings = (config.bindings ?? []).filter((binding) => !bindingMatches(binding, type, id));
        bindings.push({ agentId: agent, match: { channel: type, accountId: id } });
        config.bindings = bindings;
      });
      return { success: true };
    },
    bindingDelete: async (payload) => {
      const type = channelType(payload);
      const id = accountId(payload);
      await mutateOpenClawConfig((raw) => {
        const config = raw as ConfigDocument;
        config.bindings = (config.bindings ?? []).filter((binding) => !bindingMatches(binding, type, id));
      });
      return { success: true };
    },
    validateConfig: async (payload) => {
      channelType(payload);
      await readConfig();
      return { success: true };
    },
    validateCredentials: async (payload) => {
      channelType(payload);
      const hasCredential = Object.values(payload.config).some((value) => typeof value === 'string' && value.trim());
      return { success: hasCredential, valid: hasCredential, errors: hasCredential ? [] : ['At least one credential value is required'] };
    },
    saveConfig: async (payload) => {
      const type = channelType(payload);
      const id = accountId(payload);
      await mutateOpenClawConfig((raw) => {
        const config = raw as ConfigDocument;
        config.channels ??= {};
        const current = config.channels[type] ?? {};
        const accounts = isRecord(current.accounts) ? current.accounts : {};
        accounts[id] = { ...(isRecord(accounts[id]) ? accounts[id] : {}), ...payload.config, enabled: true };
        config.channels[type] = { ...current, enabled: true, defaultAccount: current.defaultAccount || id, accounts };
      });
      return { success: true };
    },
    setEnabled: async (payload) => {
      const type = channelType(payload);
      await mutateOpenClawConfig((raw) => {
        const config = raw as ConfigDocument;
        config.channels ??= {};
        config.channels[type] = { ...(config.channels[type] ?? {}), enabled: payload.enabled };
      });
      await gatewayManager.rpc(payload.enabled ? 'channels.start' : 'channels.stop', { channel: type });
      return { success: true };
    },
    formValues: async (payload) => {
      const type = channelType(payload);
      const id = accountId(payload);
      const config = await readConfig();
      const section = config.channels?.[type] ?? {};
      const accounts = isRecord(section.accounts) ? section.accounts : {};
      const stored = isRecord(accounts[id]) ? accounts[id] : section;
      return { success: true, values: publicValues(stored) };
    },
    deleteConfig: async (payload) => {
      const type = channelType(payload);
      const requestedId = isRecord(payload) && typeof payload.accountId === 'string' && payload.accountId.trim() ? payload.accountId.trim() : undefined;
      await mutateOpenClawConfig((raw) => {
        const config = raw as ConfigDocument;
        const section = config.channels?.[type];
        if (!section) return;
        if (!requestedId) delete config.channels?.[type];
        else if (isRecord(section.accounts)) delete section.accounts[requestedId];
        config.bindings = (config.bindings ?? []).filter((binding) => !bindingMatches(binding, type, requestedId));
      });
      return { success: true };
    },
    startLogin: async (payload) => {
      await gatewayManager.rpc('channels.start', { channel: channelType(payload), accountId: accountId(payload) });
      return { success: true };
    },
    cancelLogin: async (payload) => {
      await gatewayManager.rpc('channels.stop', { channel: channelType(payload), accountId: accountId(payload) });
      return { success: true };
    },
  };
}
