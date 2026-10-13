import { Color, NoToneMapping, WebGPURenderer } from "three/webgpu";

/** The ground colour (#070910): the colour of the space the scene sits in. */
export const BACKGROUND = new Color(0x070910);

export interface RendererHandle {
  renderer: WebGPURenderer;
  /** False when the browser had no WebGPU and three fell back to its WebGL2 backend (or `?webgl=1` forced it). */
  isWebGPU: boolean;
}

export interface RendererOptions {
  /** `?webgl=1`: use the WebGL2 backend even where WebGPU exists. */
  forceWebGL?: boolean;
  trackTimestamp?: boolean;
}

/** True when the URL asks for the WebGL2 backend. */
export function wantsWebGL(search: string): boolean {
  return new URLSearchParams(search).get("webgl") === "1";
}

export async function createRenderer(
  canvas: HTMLCanvasElement,
  { forceWebGL = false, trackTimestamp = false }: RendererOptions = {},
): Promise<RendererHandle> {
  // No MSAA: shapes carry soft analytic edges, and MSAA on the half-float scene target costs blend bandwidth.
  const renderer = new WebGPURenderer({ canvas, antialias: false, forceWebGL, powerPreference: "high-performance", trackTimestamp });
  // The app lowers this once it knows the quality tier (see `maxPixelRatio` in quality.ts).
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(BACKGROUND, 1);
  renderer.toneMapping = NoToneMapping;
  await renderer.init();
  const backend = renderer.backend as { isWebGPUBackend?: boolean };
  return { renderer, isWebGPU: backend.isWebGPUBackend === true };
}
