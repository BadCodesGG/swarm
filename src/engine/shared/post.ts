/**
 * Post-processing: scene pass, bloom on the bright light only, then vignette and a fine film grain
 * applied after the sRGB conversion, where the grain also works as dither and breaks up banding in
 * the near-black gradients.
 */

import { RenderPipeline, type Camera, type Scene, type WebGPURenderer } from "three/webgpu";
import { Fn, float, fract, length, mix, pass, rand, renderOutput, screenSize, screenUV, smoothstep, time, vec2, vec4 } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";

export interface PostOptions {
  /** Bloom strength, radius, threshold. */
  bloom?: { strength: number; radius: number; threshold: number };
  /** Darkest vignette multiplier at the corners (1 is none). */
  vignette?: number;
  /** Grain amplitude. */
  grain?: number;
}

export interface Post {
  pipeline: RenderPipeline;
  render(): void;
  dispose(): void;
}

export function createPost(renderer: WebGPURenderer, scene: Scene, camera: Camera, options: PostOptions = {}): Post {
  const { bloom: b = { strength: 0.9, radius: 0.45, threshold: 0.95 }, vignette: edge = 0.45, grain = 0.028 } = options;
  const scenePass = pass(scene, camera);
  const color = scenePass.getTextureNode("output");
  const glow = bloom(color, b.strength, b.radius, b.threshold);
  const hdr = color.add(glow);

  const pipeline = new RenderPipeline(renderer);
  pipeline.outputColorTransform = false;
  pipeline.outputNode = Fn(() => {
    const ldr = renderOutput(hdr);
    const uv = screenUV;
    const aspect = screenSize.x.div(screenSize.y);
    const d = length(uv.sub(0.5).mul(vec2(aspect, 1)));
    const vignette = mix(float(1), float(edge), smoothstep(0.3, 1.05, d));
    const noise = rand(uv.add(fract(time.mul(0.37)))).sub(0.5);
    const rgb = ldr.rgb.mul(vignette).add(noise.mul(grain));
    return vec4(rgb, 1);
  })();

  return {
    pipeline,
    render: () => pipeline.render(),
    dispose() {
      glow.dispose();
      scenePass.dispose();
      pipeline.dispose();
    },
  };
}
