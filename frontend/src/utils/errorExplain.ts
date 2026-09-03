/**
 * Translates raw agent/device failure text into plain language the user can act on.
 *
 * The backend emits FailureCode values (see src/services/android/AndroidProtocol.ts):
 * ACCESSIBILITY_DISABLED, APP_NOT_FOUND, NODE_NOT_FOUND, ACTION_REJECTED,
 * CAPTURE_NOT_CONFIGURED, CONFIRMATION_REQUIRED, INVALID_WORKFLOW, TIMEOUT,
 * INTERNAL_ERROR — plus free-text messages like "No screen frame was returned".
 *
 * Matching is substring-based on purpose: codes arrive embedded in longer
 * strings ("Action failed: NODE_NOT_FOUND: No current UI node matches ...").
 */

export interface ErrorExplanation {
  /** One-line plain description of what happened. */
  title: string;
  /** Why this usually happens. */
  cause: string;
  /** What the user can do about it. */
  suggestion: string;
  /** Optional one-tap task that often recovers from this failure. */
  recoveryPrompt?: string;
}

interface ErrorRule {
  /** Case-insensitive substrings; the first rule with any match wins. */
  patterns: string[];
  explanation: ErrorExplanation;
}

const RULES: ErrorRule[] = [
  {
    patterns: ['no screen frame', 'screen frame arrived', 'no frame was returned'],
    explanation: {
      title: 'The phone stopped sending its screen',
      cause: 'The screen probably turned off, or the companion app lost screen-capture permission.',
      suggestion: 'Wake the phone and check that screen capture is still allowed in the Vector Brain companion app.',
      recoveryPrompt: 'Go to the Home screen',
    },
  },
  {
    patterns: ['accessibility_disabled'],
    explanation: {
      title: 'Accessibility service is turned off',
      cause: 'Android sometimes disables accessibility services after reboots or app updates.',
      suggestion: 'On the phone, open Settings → Accessibility and re-enable the Vector Brain service, then retry.',
    },
  },
  {
    patterns: ['app_not_found'],
    explanation: {
      title: 'That app is not installed on this phone',
      cause: 'The agent tried to open an app that does not exist on this device.',
      suggestion: 'Install the app on the phone, or rephrase the task to use an app that is installed.',
    },
  },
  {
    patterns: ['node_not_found'],
    explanation: {
      title: 'The button or element was not on screen',
      cause: 'The screen changed before the tap landed, or the app shows a different layout on this device.',
      suggestion: 'Usually harmless — the agent retries another way. If it keeps failing, try describing the element differently.',
    },
  },
  {
    patterns: ['action_rejected'],
    explanation: {
      title: 'Android blocked the action',
      cause: 'Some screens (payments, permission dialogs, secure apps) do not allow automated input.',
      suggestion: 'Complete that step manually on the phone, then ask the agent to continue.',
    },
  },
  {
    patterns: ['capture_not_configured'],
    explanation: {
      title: 'Screen capture is not set up',
      cause: 'The companion app has not been granted screen-recording permission.',
      suggestion: 'Open the Vector Brain companion app on the phone and grant the screen capture permission.',
    },
  },
  {
    patterns: ['confirmation_required'],
    explanation: {
      title: 'The phone is asking for a confirmation',
      cause: 'A system dialog (permission, sign-in, or security prompt) is waiting for a human.',
      suggestion: 'Confirm the dialog on the phone, then re-run or continue the task.',
    },
  },
  {
    patterns: ['invalid_workflow'],
    explanation: {
      title: 'The agent produced an invalid plan',
      cause: 'The model generated a step the device cannot execute — more common on weaker free models.',
      suggestion: 'Retry the task; if it repeats, switch to a stronger model in the header dropdown.',
    },
  },
  {
    patterns: ['step limit', 'step-limit'],
    explanation: {
      title: 'Ran out of steps',
      cause: 'The task needed more moves than the step budget allowed.',
      suggestion: 'Continue the task with a bigger budget, or raise the Steps number in the header before starting long tasks.',
    },
  },
  {
    patterns: ['timeout', 'timed out'],
    explanation: {
      title: 'The phone took too long to respond',
      cause: 'The device may be asleep, on a slow connection, or the companion app was pushed to the background.',
      suggestion: 'Check the phone is awake and online, then retry.',
      recoveryPrompt: 'Go to the Home screen',
    },
  },
  {
    patterns: ['internal_error'],
    explanation: {
      title: 'Something went wrong inside the agent',
      cause: 'An unexpected error occurred on the server or device bridge.',
      suggestion: 'Retry the task. If it keeps happening, note what you asked and report it.',
    },
  },
];

/**
 * Returns a plain-language explanation for known failure text, or null when the
 * text matches no known pattern (caller should then fall back to the raw text).
 */
export function explainError(raw: string | null | undefined): ErrorExplanation | null {
  if (!raw) return null;
  const haystack = raw.toLowerCase();
  for (const rule of RULES) {
    if (rule.patterns.some((pattern) => haystack.includes(pattern))) {
      return rule.explanation;
    }
  }
  return null;
}
