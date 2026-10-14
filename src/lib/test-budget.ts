/**
 * A wall-clock budget for a timing test. A shared CI runner, with Vitest running other files beside
 * it, measured up to about 2.8x the local time (100 world trials: 6.2 s there, about 2.2 s here), so
 * it gets three times the budget. Locally the budget is the real one, so a regression still shows.
 */
export const budgetMs = (ms: number) => (process.env.CI ? ms * 3 : ms);
