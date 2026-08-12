// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { descendantFolderIds, normalizePlacementOrder } from '@electron/services/chat-organization-api';

describe('project tree ordering', () => {
  it('collects every nested subfolder without crossing projects', () => {
    const folders = [
      { id: 'root', projectId: 'a', parentId: null, name: 'Root', order: 0 },
      { id: 'child', projectId: 'a', parentId: 'root', name: 'Child', order: 0 },
      { id: 'deep', projectId: 'a', parentId: 'child', name: 'Deep', order: 0 },
      { id: 'other', projectId: 'b', parentId: null, name: 'Other', order: 0 },
    ];
    expect([...descendantFolderIds(folders, 'root')]).toEqual(['root', 'child', 'deep']);
  });

  it('normalizes order independently for each project folder', () => {
    const normalized = normalizePlacementOrder([
      { chatKey: 'b', projectId: 'p', folderId: null, order: 8 },
      { chatKey: 'a', projectId: 'p', folderId: null, order: 2 },
      { chatKey: 'c', projectId: 'p', folderId: 'f', order: 9 },
    ]);
    expect(normalized).toEqual([
      { chatKey: 'a', projectId: 'p', folderId: null, order: 0 },
      { chatKey: 'b', projectId: 'p', folderId: null, order: 1 },
      { chatKey: 'c', projectId: 'p', folderId: 'f', order: 0 },
    ]);
  });
});
