/** The three playback speeds: the desktop's segmented control and the phone's cycling button. */
export const RATES = [1, 20, 200] as const;

export type Rate = (typeof RATES)[number];

/** The rate the phone's button shows: the selected one, or 20x (the phone board's) for any other. */
export const shownRate = (rate: number): Rate => RATES.find((r) => r === rate) ?? 20;

/** The rate one press moves to, cycling from the shown one. */
export const nextRate = (rate: number): Rate => RATES[(RATES.indexOf(shownRate(rate)) + 1) % RATES.length];
