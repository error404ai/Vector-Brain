import toast from 'react-hot-toast';
import type { ReactNode } from 'react';

type Notification = {
  title?: string;
  message?: ReactNode;
  color?: string;
  icon?: ReactNode;
};

export const notifications = {
  show({ title, message, color }: Notification) {
    const text = [title, typeof message === 'string' ? message : undefined].filter(Boolean).join(': ');
    if (color === 'red') {
      toast.error(text || 'Error');
    } else if (color === 'green') {
      toast.success(text || 'Success');
    } else {
      toast(text || 'Notice');
    }
  },
};
