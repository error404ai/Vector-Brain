/**
 * Captures what this browser tab shows, at full size, using the screen-capture
 * prompt (the browser asks which tab to share; Chrome offers this tab first).
 * One frame is grabbed and the share stops at once.
 *
 * `beforeGrab` runs after permission is granted, so callers can close menus
 * and let the page settle before the frame is taken.
 */
export async function capturePage(beforeGrab?: () => Promise<void> | void): Promise<string> {
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('This browser cannot capture the page');
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: 'browser', frameRate: 5 },
    audio: false,
    // Chrome-only hints, ignored elsewhere: offer this tab and allow choosing it.
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
  } as DisplayMediaStreamOptions);
  try {
    await beforeGrab?.();
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    // Two frames in, the share preview has painted the real page.
    await new Promise((r) => setTimeout(r, 450));
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx || !canvas.width) throw new Error('No frame came through');
    ctx.drawImage(video, 0, 0);
    video.srcObject = null;
    const png = canvas.toDataURL('image/png');
    // Keep uploads well under the server's 12 MB limit.
    return png.length > 11_000_000 ? canvas.toDataURL('image/jpeg', 0.9) : png;
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}
