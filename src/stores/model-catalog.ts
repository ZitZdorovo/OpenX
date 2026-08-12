import { create } from 'zustand';
import { useGatewayStore } from './gateway';
import type { GatewayModelCatalogEntry } from '@/lib/model-options';

interface ModelCatalogState {
  models: GatewayModelCatalogEntry[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export const useModelCatalogStore = create<ModelCatalogState>((set) => ({
  models: [],
  loading: false,
  error: null,
  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const response = await useGatewayStore.getState().rpc<{ models?: GatewayModelCatalogEntry[] }>(
        'models.list',
        { view: 'default' },
        15_000,
      );
      set({ models: Array.isArray(response.models) ? response.models : [], loading: false });
    } catch (error) {
      set({ error: String(error), loading: false });
    }
  },
}));
