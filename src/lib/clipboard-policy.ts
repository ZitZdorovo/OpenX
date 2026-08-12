export function isCopyAllowed(
  _target: EventTarget | null,
  _selection: Selection | null = document.getSelection(),
): boolean {
  return true;
}
