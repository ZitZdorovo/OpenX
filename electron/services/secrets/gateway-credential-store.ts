import { safeStorage } from 'electron';

type GatewayAuthMode = 'token' | 'password';

type StoredGatewayCredential = {
  mode: GatewayAuthMode;
  encryptedValue: string;
};

let storePromise: Promise<{
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
  delete: (key: string) => void;
}> | null = null;

async function getStore() {
  if (!storePromise) {
    storePromise = import('electron-store').then(({ default: Store }) => new Store({
      name: 'openx-secrets',
    }));
  }
  return storePromise;
}

function requireEncryption(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Operating-system credential encryption is unavailable');
  }
}

export async function getGatewayCredential(): Promise<{ mode: GatewayAuthMode; secret: string } | null> {
  const store = await getStore();
  const value = store.get('gatewayCredential') as StoredGatewayCredential | undefined;
  if (!value || (value.mode !== 'token' && value.mode !== 'password') || !value.encryptedValue) {
    return null;
  }
  requireEncryption();
  const secret = safeStorage.decryptString(Buffer.from(value.encryptedValue, 'base64'));
  return secret ? { mode: value.mode, secret } : null;
}

export async function setGatewayCredential(mode: GatewayAuthMode, secret: string): Promise<void> {
  const normalized = secret.trim();
  if (!normalized) throw new Error('Gateway credential is required');
  requireEncryption();
  const store = await getStore();
  const encryptedValue = safeStorage.encryptString(normalized).toString('base64');
  store.set('gatewayCredential', { mode, encryptedValue } satisfies StoredGatewayCredential);
}

export async function deleteGatewayCredential(): Promise<void> {
  const store = await getStore();
  store.delete('gatewayCredential');
}

export async function hasGatewayCredential(): Promise<boolean> {
  return (await getGatewayCredential()) !== null;
}
