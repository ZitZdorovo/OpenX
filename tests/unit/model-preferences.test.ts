import { beforeEach, describe, expect, it } from 'vitest';
import {
  modelSelectionKey,
  mostUsedModelSelection,
  useModelPreferencesStore,
  type ModelSelection,
} from '../../src/stores/model-preferences';

const alpha: ModelSelection = { modelRef: 'provider/alpha', thinkingLevel: 'high' };
const beta: ModelSelection = { modelRef: 'provider/beta', thinkingLevel: 'low' };

describe('model preference persistence logic', () => {
  beforeEach(() => {
    useModelPreferencesStore.setState({
      aliases: {},
      thinkingLevels: {},
      presets: [],
      sessionSelections: {},
      usageCounts: {},
    });
  });

  it('stores per-session choices and only counts intentional selections', () => {
    const apply = useModelPreferencesStore.getState().applySelection;
    apply({ sessionKey: 'agent:main:first', selection: alpha, intentional: false });
    expect(useModelPreferencesStore.getState().sessionSelections['agent:main:first']).toEqual(alpha);
    expect(useModelPreferencesStore.getState().usageCounts).toEqual({});

    apply({ sessionKey: 'agent:main:second', selection: beta, intentional: true });
    apply({ sessionKey: 'agent:main:second', selection: beta, intentional: true });
    expect(useModelPreferencesStore.getState().usageCounts[modelSelectionKey(beta)]).toBe(2);
    expect(mostUsedModelSelection(useModelPreferencesStore.getState())).toEqual(beta);
  });

  it('creates, renames, and deletes a model plus thinking preset', () => {
    const id = useModelPreferencesStore.getState().createPreset('Research', alpha);
    expect(useModelPreferencesStore.getState().presets[0]).toMatchObject({ id, name: 'Research', ...alpha });
    useModelPreferencesStore.getState().renamePreset(id, 'Deep research');
    expect(useModelPreferencesStore.getState().presets[0].name).toBe('Deep research');
    useModelPreferencesStore.getState().deletePreset(id);
    expect(useModelPreferencesStore.getState().presets).toEqual([]);
  });
});
