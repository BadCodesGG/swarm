import type { Metadata } from "next";

/**
 * Canonical origin for absolute URLs (metadataBase, social cards). Defaults to the production
 * domain so a build without the env var still emits absolute production URLs: a relative or
 * deployment URL is what makes Slack and Facebook drop the image. NEXT_PUBLIC_SITE_URL overrides it.
 */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://swarm.badcodes.dev";

export const SITE_NAME = "Swarm";
export const SITE_DESCRIPTION =
  "Inside an AI: watch a real agent swarm think, then see what happens when one tries to leave the box.";

/**
 * The static share image, public/og.jpg. There is no opengraph-image file convention here, so the
 * root layout and every route's own metadata (see pageMetadata) must list it explicitly.
 */
export const OG_IMAGE = {
  url: "/og.jpg",
  width: 1200,
  height: 630,
  alt: "An AI agent swarm: an orchestrator core with subagents and tool calls around it: Swarm",
};

/**
 * The title a card shows, which is the page's own `<title>`. The layout's template
 * (`%s | ${SITE_NAME}`) applies to every route below the root but never to the root page, and
 * og:title and twitter:title never go through it, so the suffix is added here.
 */
export function shareTitle(title: string, path: string): string {
  return path === "/" ? title : `${title} | ${SITE_NAME}`;
}

/**
 * Metadata for a route that sets its own. Next replaces a layout's `openGraph` and `twitter`
 * wholesale when a route declares its own, so a route that set only its title would otherwise lose
 * the image or carry the layout's title.
 */
export function pageMetadata({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  const card = shareTitle(title, path);
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: "website", siteName: SITE_NAME, title: card, description, url: path, images: [OG_IMAGE] },
    twitter: { card: "summary_large_image", title: card, description, images: [OG_IMAGE.url] },
  };
}
