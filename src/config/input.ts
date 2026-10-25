/** Input timing. Real time (input layer), not simulation time. */
export const INPUT = {
  /** Left + right click within this window = grab; the individual clicks are then suppressed (ms). */
  grabChordMs: 120,
  /** Max delay between two forward presses that counts as a double tap (ms). */
  doubleTapMs: 300,
} as const;
