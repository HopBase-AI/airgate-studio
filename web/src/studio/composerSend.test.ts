import { describe, expect, it, vi } from 'vitest';

import { commitComposerSend, isComposerSubmitKey } from './composerSend';

describe('composer send guards', () => {
  it('does not submit the Enter path while route discovery is unavailable', () => {
    expect(isComposerSubmitKey('Enter', false, false)).toBe(false);
    expect(isComposerSubmitKey('Enter', false, true)).toBe(true);
    expect(isComposerSubmitKey('Enter', true, true)).toBe(false);
  });

  it('does not start or clear the prompt when sending is disabled', () => {
    const start = vi.fn(() => true);
    const clearPrompt = vi.fn();

    expect(commitComposerSend(false, start, clearPrompt)).toBe(false);
    expect(start).not.toHaveBeenCalled();
    expect(clearPrompt).not.toHaveBeenCalled();
  });

  it('clears the prompt only after generation actually starts', () => {
    const clearPrompt = vi.fn();

    expect(commitComposerSend(true, () => false, clearPrompt)).toBe(false);
    expect(clearPrompt).not.toHaveBeenCalled();

    expect(commitComposerSend(true, () => true, clearPrompt)).toBe(true);
    expect(clearPrompt).toHaveBeenCalledOnce();
  });
});
