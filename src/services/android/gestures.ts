import type { AutomationAction } from './AndroidProtocol';

/** A one-finger drag as the closest of the four fixed swipes (phones before 0.32). */
export function gestureAsSwipe(action: Extract<AutomationAction, { type: 'Gesture' }>): AutomationAction {
  const points = action.strokes[0]?.points ?? [];
  const first = points[0] ?? { x: 0, y: 0 };
  const last = points[points.length - 1] ?? first;
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const direction = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'LEFT' : 'RIGHT') : dy < 0 ? 'UP' : 'DOWN';
  const durationMillis = Math.max(200, Math.min(800, action.strokes[0]?.durationMillis ?? 300));
  return { type: 'Swipe', direction, durationMillis };
}
