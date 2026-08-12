import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { parseModelVariant, type ThinkingLevel } from '@/lib/model-display';

export interface ModelSelection {
  modelRef: string;
  thinkingLevel: ThinkingLevel;
}

export interface ModelPreset extends ModelSelection {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

interface ApplySelectionInput {
  sessionKey: string;
  selection: ModelSelection;
  intentional: boolean;
}

interface ModelPreferencesState {
  aliases: Record<string, string>;
  thinkingLevels: Record<string, ThinkingLevel>;
  presets: ModelPreset[];
  sessionSelections: Record<string, ModelSelection>;
  usageCounts: Record<string, number>;
  setAlias: (baseKey: string, alias: string) => void;
  resetAlias: (baseKey: string) => void;
  applySelection: (input: ApplySelectionInput) => void;
  createPreset: (name: string, selection: ModelSelection) => string;
  renamePreset: (id: string, name: string) => void;
  deletePreset: (id: string) => void;
}

export function modelSelectionKey(selection: ModelSelection): string {
  return `${selection.modelRef}\u0000${selection.thinkingLevel}`;
}

export function mostUsedModelSelection(state: Pick<ModelPreferencesState, 'usageCounts'>): ModelSelection | null {
  const winner = Object.entries(state.usageCounts)
    .filter(([, count]) => Number.isFinite(count) && count > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0];
  if (!winner) return null;
  const [modelRef, thinkingLevel] = winner[0].split('\u0000');
  if (!modelRef || !thinkingLevel) return null;
  return { modelRef, thinkingLevel: thinkingLevel as ThinkingLevel };
}

function nextId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useModelPreferencesStore = create<ModelPreferencesState>()(
  persist(
    (set) => ({
      aliases: {},
      thinkingLevels: {},
      presets: [],
      sessionSelections: {},
      usageCounts: {},
      setAlias: (baseKey, alias) => set((state) => {
        const value = alias.trim();
        if (!value) {
          const aliases = { ...state.aliases };
          delete aliases[baseKey];
          return { aliases };
        }
        return { aliases: { ...state.aliases, [baseKey]: value } };
      }),
      resetAlias: (baseKey) => set((state) => {
        const aliases = { ...state.aliases };
        delete aliases[baseKey];
        return { aliases };
      }),
      applySelection: ({ sessionKey, selection, intentional }) => set((state) => ({
        thinkingLevels: {
          ...state.thinkingLevels,
          [parseModelVariant(selection.modelRef).baseKey]: selection.thinkingLevel,
        },
        sessionSelections: sessionKey
          ? { ...state.sessionSelections, [sessionKey]: selection }
          : state.sessionSelections,
        usageCounts: intentional
          ? {
            ...state.usageCounts,
            [modelSelectionKey(selection)]: (state.usageCounts[modelSelectionKey(selection)] ?? 0) + 1,
          }
          : state.usageCounts,
      })),
      createPreset: (name, selection) => {
        const id = nextId();
        const now = Date.now();
        set((state) => ({
          presets: [...state.presets, {
            id,
            name: name.trim(),
            ...selection,
            createdAt: now,
            updatedAt: now,
          }],
        }));
        return id;
      },
      renamePreset: (id, name) => set((state) => ({
        presets: state.presets.map((preset) => (
          preset.id === id ? { ...preset, name: name.trim(), updatedAt: Date.now() } : preset
        )),
      })),
      deletePreset: (id) => set((state) => ({ presets: state.presets.filter((preset) => preset.id !== id) })),
    }),
    {
      // Keep the legacy key so existing aliases survive the OpenX rename.
      name: 'openx-model-preferences',
      version: 2,
      migrate: (persisted) => {
        const legacy = persisted as Partial<ModelPreferencesState> | undefined;
        return {
          aliases: legacy?.aliases ?? {},
          thinkingLevels: legacy?.thinkingLevels ?? {},
          presets: legacy?.presets ?? [],
          sessionSelections: legacy?.sessionSelections ?? {},
          usageCounts: legacy?.usageCounts ?? {},
        };
      },
    },
  ),
);
