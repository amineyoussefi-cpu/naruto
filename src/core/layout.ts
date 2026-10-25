/** Best-effort keyboard layout detection for help labels (bindings are physical and work on both). */
export async function detectLayout(): Promise<'qwerty' | 'azerty'> {
  try {
    const kb = (navigator as Navigator & { keyboard?: { getLayoutMap(): Promise<Map<string, string>> } }).keyboard;
    if (kb) {
      const map = await kb.getLayoutMap();
      const q = map.get('KeyQ');
      if (q) return q.toLowerCase() === 'a' ? 'azerty' : 'qwerty';
    }
  } catch { /* not supported */ }
  return /^fr\b|^fr-/i.test(navigator.language) ? 'azerty' : 'qwerty';
}
