import type { GatewayManager } from '../gateway/manager';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { getAllSkillConfigs, getSkillConfig, updateSkillConfig, updateSkillConfigs } from '../utils/skill-config';
import { isRecord } from './payload-utils';

type SkillStatusRow = {
  skillKey: string;
  slug?: string;
  name?: string;
  description?: string;
  disabled?: boolean;
  version?: string;
  author?: string;
  source?: string;
  baseDir?: string;
  filePath?: string;
  bundled?: boolean;
};

type SkillsStatus = { skills?: SkillStatusRow[] };

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function skillKey(payload: unknown): string {
  if (!isRecord(payload) || typeof payload.skillKey !== 'string' || !payload.skillKey.trim()) {
    throw new Error('skillKey is required');
  }
  return payload.skillKey.trim();
}

function configUpdate(payload: unknown) {
  if (!isRecord(payload)) throw new Error('Invalid skill config');
  const env = isRecord(payload.env)
    ? Object.fromEntries(Object.entries(payload.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    : undefined;
  return {
    skillKey: skillKey(payload),
    enabled: typeof payload.enabled === 'boolean' ? payload.enabled : undefined,
    apiKey: typeof payload.apiKey === 'string' ? payload.apiKey : undefined,
    env,
  };
}

export function createSkillsApi({
  gatewayManager,
}: {
  gatewayManager: GatewayManager;
}): CompleteHostServiceRegistry['skills'] {
  const status = () => gatewayManager.rpc<SkillsStatus>('skills.status', {});

  return {
    local: async () => {
      const rows = (await status()).skills ?? [];
      return {
        success: true,
        skills: rows.map((row) => ({
          id: row.skillKey,
          slug: row.slug,
          name: row.name || row.slug || row.skillKey,
          description: row.description || '',
          enabled: !row.disabled,
          version: row.version,
          author: row.author,
          source: row.source,
          baseDir: row.baseDir,
          filePath: row.filePath,
          isBundled: row.bundled,
        })),
      };
    },
    configs: () => getAllSkillConfigs(),
    allConfigs: () => getAllSkillConfigs(),
    getConfig: async (payload) => ({ ...await getSkillConfig(skillKey(payload)) }),
    updateConfig: async (payload) => {
      const { skillKey: key, ...updates } = configUpdate(payload);
      return updateSkillConfig(key, updates);
    },
    updateConfigs: async (payload) => {
      if (!isRecord(payload) || !Array.isArray(payload.updates)) return { success: true };
      return updateSkillConfigs(payload.updates.map(configUpdate));
    },
    status,
    update: (payload) => gatewayManager.rpc('skills.update', payload),
    quickAccess: async () => {
      const rows = (await status()).skills ?? [];
      return {
        success: true,
        skills: rows.filter((row) => !row.disabled).map((row) => ({
          name: row.name || row.slug || row.skillKey,
          description: row.description || '',
          source: 'openclaw' as const,
          sourceLabel: 'Remote Gateway',
          manifestPath: row.filePath || '',
          baseDir: row.baseDir || '',
        })),
      };
    },
    clawhubCapability: async () => ({
      success: true,
      capability: { remote: true, search: true, install: true, update: true },
    }),
    clawhubList: async () => {
      const rows = (await status()).skills ?? [];
      return {
        success: true,
        results: rows.filter((row) => row.source === 'clawhub').map((row) => ({
          slug: row.slug || row.skillKey,
          version: row.version,
          source: row.source,
          baseDir: row.baseDir,
        })),
      };
    },
    clawhubSearch: async (payload) => {
      try {
        const result = await gatewayManager.rpc<{ results?: unknown[] }>('skills.search', payload);
        return { success: true, results: (result.results ?? []) as never };
      } catch (error) {
        return { success: false, error: message(error) };
      }
    },
    clawhubInstall: async (payload) => {
      try {
        await gatewayManager.rpc('skills.install', { source: 'clawhub', ...payload });
        return { success: true };
      } catch (error) {
        return { success: false, error: message(error) };
      }
    },
    clawhubUninstall: async () => ({
      success: false,
      error: 'The connected Gateway does not expose a skill uninstall RPC.',
    }),
    clawhubOpenSkillReadme: async (payload) => {
      try {
        const key = isRecord(payload) && typeof payload.skillKey === 'string' ? payload.skillKey : '';
        await gatewayManager.rpc('skills.skillCard', { skillKey: key });
        return { success: true };
      } catch (error) {
        return { success: false, error: message(error) };
      }
    },
    clawhubOpenSkillPath: async () => ({
      success: false,
      error: 'Remote Gateway paths cannot be opened on this computer.',
    }),
  };
}
