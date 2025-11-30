export const isDev = Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);
