import { useState } from 'react';

export function useDisclosure(initial = false): [boolean, { open: () => void; close: () => void; toggle: () => void }] {
  const [opened, setOpened] = useState(initial);
  return [
    opened,
    {
      open: () => setOpened(true),
      close: () => setOpened(false),
      toggle: () => setOpened((value) => !value),
    },
  ];
}

export function useDebouncedValue<T>(value: T, delay: number): [T] {
  void delay;
  return [value];
}
