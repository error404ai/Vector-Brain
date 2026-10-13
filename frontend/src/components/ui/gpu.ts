/**
 * Whether this browser has a real GPU for WebGL.
 *
 * Without one (no graphics driver, hardware acceleration off, a VM, and the
 * headless Chrome that PageSpeed Insights and Lighthouse use) WebGL still works
 * but runs on the CPU through SwiftShader or llvmpipe. A three.js scene drawn
 * that way blocks the page's main thread for seconds at a time: PageSpeed
 * measured 12 s of blocking time on the home page from its 3D scene alone. The
 * 3D scenes ask this first and show their still fallback instead.
 *
 * `failIfMajorPerformanceCaveat` is the browser's own signal for "this context
 * would be slow"; the renderer name catches software rasterisers that do not
 * set it. The answer is cached: it does not change while the page is open.
 */
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i;

let cached: boolean | null = null;

export function hasHardwareWebGL(): boolean {
  if (cached !== null) return cached;
  cached = false;
  try {
    const canvas = document.createElement('canvas');
    const options = { failIfMajorPerformanceCaveat: true } as WebGLContextAttributes;
    const gl = (canvas.getContext('webgl2', options) || canvas.getContext('webgl', options)) as WebGLRenderingContext | null;
    if (!gl) return cached;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    cached = !SOFTWARE_RENDERER.test(name);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    cached = false;
  }
  return cached;
}

/**
 * Frame limiter for a requestAnimationFrame loop: true when at least `fps`'s
 * worth of time has passed since the last drawn frame. A 3D scene that mostly
 * drifts gains nothing from 60 or 120 frames a second and costs twice the GPU
 * and battery; 30 looks the same.
 */
export function frameGate(fps = 30) {
  const minGap = 1000 / fps - 2;
  let last = -Infinity;
  return (now: number): boolean => {
    if (now - last < minGap) return false;
    last = now;
    return true;
  };
}

/**
 * Turns a per-frame easing factor tuned for 60 fps into the factor for a frame
 * that took `dtMs`, so smoothing keeps the same feel at 30 fps.
 */
export function easeFor(factorAt60: number, dtMs: number): number {
  return 1 - Math.pow(1 - factorAt60, Math.min(4, dtMs / (1000 / 60)));
}
