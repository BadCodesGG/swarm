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

/** What a sample's web call looks up: generic topics, no real sites or people. */
export const WEB_QUERIES: readonly string[] = [
  "streak counting across time zones",
  "daylight saving date bugs",
  "http cache control headers",
  "accessible form error messages",
  "keyboard focus order in dialogs",
  "paginating a long list",
  "safe data migration dry run",
  "debounce search input",
  "profiling a slow file import",
  "dark mode preference storage",
  "export data as csv",
  "splitting a large module",
];

/** What an orchestrator tells a subagent: plain engineering briefs, each under 280 characters. */
export const BRIEFS: readonly string[] = [
  "Find every caller of parseConfig and report which ones pass a default value. Do not change any code; list file, line and the argument used.",
  "Read the import step and measure where the time goes on a large input. Report the three slowest functions with rough timings and one suggested fix each.",
  "Write failing tests for the streak logic covering an empty list, a single day, a gap of one day and a change of time zone. Do not touch the implementation.",
  "Review the settings page for keyboard access: tab order, visible focus and labels on every control. Report each problem with the file and a one line fix.",
  "Look up the current guidance on cache headers for static assets and summarise the two safest options in five lines, with the trade-off of each.",
  "Split the oversized form module into a validation file and a view file. Keep every export working and run the existing tests before and after.",
  "Check how dates are stored and compared across the app, and list every place that assumes local time. Report only; no edits.",
  "Document how to run the project locally and how the folders are organised. Verify each command on a clean checkout and fix anything that fails.",
  "Trace why the search box lags behind typing. Find the handler, say what runs on each keystroke and propose the smallest change that debounces it.",
  "Write a dry run for the data migration that prints what would change and counts rows before and after. It must not modify anything.",
  "Add pagination to the list view using the existing component styles. Cover the first page, the last page and an empty list with tests.",
  "List every place the export format is built and confirm they agree on column order and quoting. Report differences with file and line.",
  "Explore the repository layout and report the entry points, the main data types and where each feature lives, in under twenty lines.",
  "Reproduce the failing date test, find the root cause and fix it properly. Explain why the test was right and what the code got wrong.",
  "Audit error handling in the file import: which failures are swallowed, which are shown to the user. Report a table of cases and gaps.",
  "Compare the two candidate caching approaches on complexity and risk, then recommend one. Keep the answer to a short paragraph and a list of caveats.",
];
