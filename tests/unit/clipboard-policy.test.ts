// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { isCopyAllowed } from '../../src/lib/clipboard-policy';

describe('OpenX clipboard policy', () => {
  it('allows copying from any readable application surface', () => {
    const chat = document.createElement('div');
    chat.dataset.testid = 'chat-page';
    const timeline = document.createElement('div');
    timeline.dataset.testid = 'acp-chat-timeline';
    const message = document.createElement('p');
    const composer = document.createElement('div');
    composer.textContent = 'Model and gateway controls';
    message.textContent = 'Assistant answer';
    timeline.appendChild(message);
    chat.append(timeline, composer);
    const sidebar = document.createElement('aside');
    document.body.append(chat, sidebar);

    expect(isCopyAllowed(message)).toBe(true);
    expect(isCopyAllowed(timeline)).toBe(true);
    expect(isCopyAllowed(composer)).toBe(true);
    expect(isCopyAllowed(chat)).toBe(true);
    expect(isCopyAllowed(sidebar)).toBe(true);
    expect(isCopyAllowed(document)).toBe(true);

    const selection = document.getSelection();
    selection?.selectAllChildren(message);
    expect(isCopyAllowed(document, selection)).toBe(true);
    selection?.selectAllChildren(composer);
    expect(isCopyAllowed(document, selection)).toBe(true);
  });
});
