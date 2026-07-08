import type { ReactNode } from 'react';

type ConfirmOptions = {
  title?: string;
  children?: ReactNode;
  labels?: { confirm?: string; cancel?: string };
  confirmProps?: Record<string, unknown>;
  onConfirm?: () => void | Promise<void>;
};

function childrenToText(children: ReactNode) {
  return typeof children === 'string' ? children : 'Are you sure?';
}

export const modals = {
  openConfirmModal(options: ConfirmOptions) {
    const confirmed = window.confirm(`${options.title ? `${options.title}\n\n` : ''}${childrenToText(options.children)}`);
    if (confirmed) {
      void options.onConfirm?.();
    }
  },
};
