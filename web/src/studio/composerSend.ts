export function isComposerSubmitKey(key: string, shiftKey: boolean, canSend: boolean): boolean {
  return key === 'Enter' && !shiftKey && canSend;
}

export function commitComposerSend(
  canSend: boolean,
  start: () => boolean,
  onStarted: () => void,
): boolean {
  if (!canSend) return false;
  const started = start();
  if (started) onStarted();
  return started;
}
