// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { ChatScrollNavigator } from '../../src/pages/Chat/ChatScrollNavigator';

afterEach(cleanup);

describe('ChatScrollNavigator', () => {
  it('expands a hovered marker, previews the prompt and response, and jumps to the exact anchor', () => {
    const scrollElement = document.createElement('div');
    Object.defineProperty(scrollElement, 'clientHeight', { value: 600 });
    scrollElement.getBoundingClientRect = () => ({ top: 0, bottom: 600 } as DOMRect);
    document.body.appendChild(scrollElement);

    const first = document.createElement('div');
    first.id = 'turn-one';
    first.getBoundingClientRect = () => ({ top: 40 } as DOMRect);
    const second = document.createElement('div');
    second.id = 'turn-two';
    second.getBoundingClientRect = () => ({ top: 420 } as DOMRect);
    const scrollIntoView = vi.fn();
    second.scrollIntoView = scrollIntoView;
    document.body.append(first, second);

    render(<ChatScrollNavigator
      label="Navigate turns"
      scrollElement={scrollElement}
      items={[
        { id: 'one', anchorId: 'turn-one', userPreview: 'First request', assistantPreview: 'First response' },
        { id: 'two', anchorId: 'turn-two', userPreview: 'Second request', assistantPreview: 'Second response' },
      ]}
    />);

    const firstMarker = screen.getByRole('button', { name: 'Navigate turns: First request' });
    const secondMarker = screen.getByRole('button', { name: 'Navigate turns: Second request' });
    expect(firstMarker).not.toHaveAttribute('title');
    fireEvent.mouseEnter(firstMarker);
    expect(screen.getByTestId('chat-scroll-preview')).toHaveTextContent('First request');
    expect(screen.getByTestId('chat-scroll-preview')).toHaveTextContent('First response');
    fireEvent.click(secondMarker);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(secondMarker).not.toHaveAttribute('title');
  });
});
