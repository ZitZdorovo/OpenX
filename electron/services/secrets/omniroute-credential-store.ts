import { safeStorage } from 'electron';

type StoredOmniRouteCredential = {
  baseUrl: string;
  encryptedToken: string;
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

export async function getOmniRouteCredential(): Promise<{
  baseUrl: string;
  managementToken: string;
} | null> {
  const store = await getStore();
  const value = store.get('omniRouteCredential') as StoredOmniRouteCredential | undefined;
  if (!value?.baseUrl || !value.encryptedToken) return null;
  requireEncryption();
  const managementToken = safeStorage.decryptString(Buffer.from(value.encryptedToken, 'base64'));
  return managementToken ? { baseUrl: value.baseUrl, managementToken } : null;
}

export async function getOmniRouteConfig(): Promise<{ baseUrl: string; configured: boolean }> {
  const credential = await getOmniRouteCredential();
  return {
    baseUrl: credential?.baseUrl ?? '',
    configured: credential !== null,
  };
}

export async function setOmniRouteCredential(
  baseUrl: string,
  managementToken: string,
): Promise<void> {
  requireEncryption();
  const store = await getStore();
  store.set('omniRouteCredential', {
    baseUrl,
    encryptedToken: safeStorage.encryptString(managementToken).toString('base64'),
  } satisfies StoredOmniRouteCredential);
}

export async function updateOmniRouteBaseUrl(baseUrl: string): Promise<void> {
  const credential = await getOmniRouteCredential();
  if (!credential) throw new Error('OmniRoute management token is required');
  await setOmniRouteCredential(baseUrl, credential.managementToken);
}

export async function deleteOmniRouteCredential(): Promise<void> {
  const store = await getStore();
  store.delete('omniRouteCredential');
}
