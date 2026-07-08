import { useState } from 'react';

type Validator<T> = Partial<Record<keyof T, (value: any, values: T) => string | null>>;

export function useForm<T extends Record<string, any>>({ initialValues, validate }: { initialValues: T; validate?: Validator<T> }) {
  const [values, setValuesState] = useState<T>(initialValues);
  const [errors, setErrors] = useState<Partial<Record<keyof T, string>>>({});

  const runValidation = (nextValues: T) => {
    const nextErrors: Partial<Record<keyof T, string>> = {};
    Object.entries(validate ?? {}).forEach(([key, validator]) => {
      const error = validator?.(nextValues[key], nextValues);
      if (error) nextErrors[key as keyof T] = error;
    });
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  return {
    values,
    errors,
    setValues(nextValues: Partial<T>) {
      setValuesState((current) => ({ ...current, ...nextValues }));
    },
    reset() {
      setValuesState(initialValues);
      setErrors({});
    },
    getInputProps(key: keyof T, options?: { type?: string }) {
      const isCheckbox = options?.type === 'checkbox';
      return {
        [isCheckbox ? 'checked' : 'value']: values[key],
        error: errors[key],
        onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
          const nextValue = isCheckbox ? (event.target as HTMLInputElement).checked : event.target.value;
          setValuesState((current) => ({ ...current, [key]: nextValue }));
        },
      };
    },
    onSubmit(handler: (values: T) => void | Promise<void>) {
      return (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (runValidation(values)) {
          void handler(values);
        }
      };
    },
  };
}
