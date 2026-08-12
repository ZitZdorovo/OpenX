import type { ProviderAccount, ProviderConfig, ProviderType } from '../../shared/providers/types';
import { getProviderDefinition } from '../../shared/providers/registry';
import { getOpenXProviderStore } from './store-instance';

type LegacyProviderAccount = ProviderAccount & {
  fallbackModels?: unknown;
  fallbackAccountIds?: unknown;
};

function removeFallbackConfiguration(account: LegacyProviderAccount): ProviderAccount {
  const sanitized = { ...account };
  delete sanitized.fallbackModels;
  delete sanitized.fallbackAccountIds;
  return sanitized;
}


function inferAuthMode(type: ProviderType): ProviderAccount['authMode'] {
  if (type === 'ollama') {
    return 'local';
  }

  const definition = getProviderDefinition(type);
  if (definition?.defaultAuthMode) {
    return definition.defaultAuthMode;
  }

  return 'api_key';
}

export function providerConfigToAccount(
  config: ProviderConfig,
  options?: { isDefault?: boolean },
): ProviderAccount {
  return {
    id: config.id,
    vendorId: config.type,
    label: config.name,
    authMode: inferAuthMode(config.type),
    baseUrl: config.baseUrl,
    apiProtocol: config.apiProtocol || (config.type === 'custom' || config.type === 'ollama'
      ? 'openai-completions'
      : getProviderDefinition(config.type)?.providerConfig?.api),
    headers: config.headers,
    model: config.model,
    enabled: config.enabled,
    isDefault: options?.isDefault ?? false,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}

export function providerAccountToConfig(account: ProviderAccount): ProviderConfig {
  return {
    id: account.id,
    name: account.label,
    type: account.vendorId,
    baseUrl: account.baseUrl,
    apiProtocol: account.apiProtocol,
    headers: account.headers,
    model: account.model,
    enabled: account.enabled,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

export async function listProviderAccounts(): Promise<ProviderAccount[]> {
  const store = await getOpenXProviderStore();
  const accounts = store.get('providerAccounts') as Record<string, LegacyProviderAccount> | undefined;
  const sanitizedEntries = Object.entries(accounts ?? {}).map(([id, account]) => [
    id,
    removeFallbackConfiguration(account),
  ] as const);
  if (Object.values(accounts ?? {}).some((account) => (
    Object.hasOwn(account, 'fallbackModels') || Object.hasOwn(account, 'fallbackAccountIds')
  ))) {
    store.set('providerAccounts', Object.fromEntries(sanitizedEntries));
  }
  return sanitizedEntries.map(([, account]) => account);
}

export async function getProviderAccount(accountId: string): Promise<ProviderAccount | null> {
  const store = await getOpenXProviderStore();
  const accounts = store.get('providerAccounts') as Record<string, LegacyProviderAccount> | undefined;
  return accounts?.[accountId] ? removeFallbackConfiguration(accounts[accountId]) : null;
}

export async function saveProviderAccount(account: ProviderAccount): Promise<void> {
  const store = await getOpenXProviderStore();
  const accounts = (store.get('providerAccounts') ?? {}) as Record<string, ProviderAccount>;
  accounts[account.id] = removeFallbackConfiguration(account);
  store.set('providerAccounts', accounts);
}

export async function deleteProviderAccount(accountId: string): Promise<void> {
  const store = await getOpenXProviderStore();
  const accounts = (store.get('providerAccounts') ?? {}) as Record<string, ProviderAccount>;
  delete accounts[accountId];
  store.set('providerAccounts', accounts);

  if (store.get('defaultProviderAccountId') === accountId) {
    store.delete('defaultProviderAccountId');
  }
}

export async function setDefaultProviderAccount(accountId: string): Promise<void> {
  const store = await getOpenXProviderStore();
  store.set('defaultProviderAccountId', accountId);

  const accounts = (store.get('providerAccounts') ?? {}) as Record<string, ProviderAccount>;
  for (const account of Object.values(accounts)) {
    account.isDefault = account.id === accountId;
  }
  store.set('providerAccounts', accounts);
}

export async function getDefaultProviderAccountId(): Promise<string | undefined> {
  const store = await getOpenXProviderStore();
  return store.get('defaultProviderAccountId') as string | undefined;
}
