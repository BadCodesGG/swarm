/**
 * The published work Act 2 draws on. Every field was checked against the source itself (the arXiv
 * abstract page's citation metadata, the post's own title and date); `npm run test:smoke` checks
 * that each title and link is on the page.
 */
export const SOURCES = [
  {
    id: "control",
    title: "AI Control: Improving Safety Despite Intentional Subversion",
    authors: "Ryan Greenblatt, Buck Shlegeris, Kshitij Sachan, Fabien Roger",
    year: 2023,
    venue: "arXiv:2312.06942",
    href: "https://arxiv.org/abs/2312.06942",
  },
  {
    id: "ctrl-z",
    title: "Ctrl-Z: Controlling AI Agents via Resampling",
    authors: "Aryan Bhatt, Cody Rushing, Adam Kaufman, Tyler Tracy, Vasil Georgiev, David Matolcsi, Akbir Khan, Buck Shlegeris",
    year: 2025,
    venue: "arXiv:2504.10374",
    href: "https://arxiv.org/abs/2504.10374",
  },
  {
    id: "shade",
    title: "SHADE-Arena: Evaluating Sabotage and Monitoring in LLM Agents",
    authors:
      "Jonathan Kutasov, Yuqi Sun, Paul Colognese, Teun van der Weij, Linda Petrini, Chen Bo Calvin Zhang, John Hughes, Xiang Deng, Henry Sleight, Tyler Tracy, Buck Shlegeris, Joe Benton",
    year: 2025,
    venue: "arXiv:2506.15740",
    href: "https://arxiv.org/abs/2506.15740",
  },
  {
    id: "sandboxing",
    title: "Making Claude Code more secure and autonomous with sandboxing",
    authors: "Anthropic",
    year: 2025,
    venue: "Anthropic Engineering",
    href: "https://www.anthropic.com/engineering/claude-code-sandboxing",
  },
] as const;

export type SourceId = (typeof SOURCES)[number]["id"];
