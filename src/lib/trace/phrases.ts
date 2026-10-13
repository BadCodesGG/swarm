/**
 * Hand-written, generic text for sample sessions: building a small software project. No real
 * people, products or paths. Prompts stay under 2,000 characters, excerpts under 280.
 */

export const PROMPTS: readonly string[] = [
  "I want to build a small habit tracker as a web app. Start by sketching the data model and the pages we need, then set up the project with tests and a lint step.",
  "Add a weekly summary page that groups entries by day and shows streaks. Keep the styling consistent with the rest of the app and add tests for the streak logic.",
  "The import step is slow on large files. Profile it, find the hot spot and fix it without changing the output format.",
  "Can you add a settings page with a dark mode toggle and a way to export all data as a file? Persist the choice between visits.",
  "Tests are failing on the date handling after the daylight saving change. Find the cause and fix it properly, not by skipping the test.",
  "Please review the whole change for anything that could break existing users, and write up what you find before touching any code.",
  "Rework the form so validation messages appear next to each field, and make sure the whole form works with the keyboard alone.",
  "Look up the current best practice for caching responses in this kind of app, then apply the simplest option that fits and explain the trade-off.",
  "We need a small command line tool that reads the data file and prints a report. Reuse the existing parsing code rather than writing a second parser.",
  "Split the oversized module into smaller ones with clear names. Behaviour must stay identical, and every existing test must still pass.",
  "Add pagination to the list view, then check the page against the accessibility checklist and fix whatever it flags.",
  "Document how to run the project locally, how the folders are organised and how to add a new page. Keep it short and accurate.",
  "Migrate the stored data to the new shape without losing anything, with a dry run first so I can see what would change.",
  "Something is wrong with the search box: results lag behind what I type. Track it down and fix it.",
];

export const TURN_EXCERPTS: readonly string[] = [
  "I'll start by reading the existing structure so the new pieces follow its conventions.",
  "The tests give me a clear target here, so I'll run them first to see the current failures.",
  "Splitting this into three smaller changes will keep each one easy to check.",
  "That approach duplicates logic that already exists in the helpers; I'll reuse those instead.",
  "I need a few facts before choosing a design, so I'm sending out parallel searches.",
  "The error points at the date parsing, not the formatting, so I'll look there first.",
  "Before I change anything I want a second opinion on the trade-offs between the two designs.",
  "The first attempt compiled but the behaviour is wrong for empty input. Adjusting.",
  "Everything passes locally. Next I'll check the edge cases around empty and very large inputs.",
  "I'll hand the exploration to a helper so this thread stays focused on the design.",
  "Updating the types first, then the call sites, so the compiler finds anything I miss.",
  "That function is used in four places; I'm checking each before changing its signature.",
  "The log shows the slow step is the repeated lookup, so a single pass with a map should help.",
  "Writing the failing test first, then the smallest change that makes it pass.",
  "The documentation for this API changed recently; reading the current page before I rely on it.",
  "Lint is clean. Running the full test suite once more before I report back.",
  "This module is doing two jobs. I'll separate them and keep the public interface the same.",
  "I found the cause: a value is read before it is initialised on the first render.",
  "The build output looks right, so I'm moving on to the remaining items on the list.",
  "I'm summarising what changed so the next step starts from a clean picture.",
  "Two options remain and both are fine; I'll take the simpler one and note why.",
  "Renaming the variable to say what it holds makes the loop below much easier to read.",
];

export const HANDBACKS: readonly string[] = [
  "Done. The new module is in place with tests; all existing tests still pass and lint is clean.",
  "I found three places that need the change and updated all of them. One edge case is covered by a new test.",
  "The slow step was a repeated lookup. Replacing it with a single pass cut the time by roughly a factor of ten.",
  "Research complete: the simplest option is an in-memory cache with a short expiry. Notes are in the summary below.",
  "The review turned up two small risks, both fixed, and one question about naming that needs a decision.",
  "The failing test was correct and the code was wrong. Fixed the parsing and added a regression test.",
  "Explored the folder layout and the entry points; the report lists where each feature lives.",
  "Implemented the page and wired it into the navigation. Keyboard focus order checked by hand.",
  "No changes were needed in this area. Everything I checked already behaves as described.",
  "The migration runs cleanly on the sample data with a dry run first. Counts before and after match.",
  "Wrote the documentation section and verified every command in it on a fresh checkout.",
  "Tests now cover the empty, single and many cases. One flaky test was stabilised by removing a timing dependency.",
];

export const LABEL_VERBS: readonly string[] = [
  "Explore",
  "Review",
  "Implement",
  "Test",
  "Plan",
  "Research",
  "Refactor",
  "Document",
  "Profile",
  "Fix",
];

export const LABEL_NOUNS: readonly string[] = [
  "the data model",
  "the import step",
  "the settings page",
  "the streak logic",
  "date handling",
  "the search box",
  "form validation",
  "the list view",
  "the command line tool",
  "caching options",
  "the build setup",
  "accessibility issues",
  "the export format",
  "error handling",
  "the navigation",
  "the migration script",
];
