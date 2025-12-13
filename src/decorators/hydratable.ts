// decorators/hydratable.ts
type HydrationConfig = {
  methodName: string;
  propertyName: string;
};

const camelToSnake = (value: string) => {
  if (!value) return value;
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
};

export function Hydrate(target: any, propertyKey: string) {
  if (!target.__hydratableConfigs) {
    target.__hydratableConfigs = [] as HydrationConfig[];
  }

  const propertyName = camelToSnake(propertyKey);

  if (!target.__hydratableConfigs.some((config: HydrationConfig) => config.methodName === propertyKey)) {
    target.__hydratableConfigs.push({ methodName: propertyKey, propertyName });
  }
}

export type { HydrationConfig };