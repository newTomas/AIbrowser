/**
 * Null safety utilities for better type safety and error handling
 */

/**
 * Safely get a nested property value with type safety
 */
export function safeGet<T>(obj: T | null | undefined, path: string, defaultValue: any = null): any {
  if (!obj || typeof obj !== 'object') {
    return defaultValue;
  }

  return path.split('.').reduce((current: any, key: string) => {
    return current && typeof current === 'object' && key in current
      ? current[key]
      : defaultValue;
  }, obj);
}

/**
 * Safe optional chaining for object properties
 */
export function safeProperty<T, K extends keyof T>(
  obj: T | null | undefined,
  key: K,
  defaultValue: T[K]
): T[K] {
  return obj?.[key] ?? defaultValue;
}

/**
 * Safe array access with bounds checking
 */
export function safeArrayAccess<T>(
  arr: T[] | null | undefined,
  index: number,
  defaultValue: T | null = null
): T | null {
  if (!Array.isArray(arr) || index < 0 || index >= arr.length) {
    return defaultValue;
  }
  return arr[index];
}

/**
 * Safe string operations with null handling
 */
export function safeString(str: string | null | undefined, defaultValue: string = ''): string {
  return str ?? defaultValue;
}

/**
 * Safe string toLowerCase with null handling
 */
export function safeLowerCase(str: string | null | undefined): string {
  return safeString(str).toLowerCase();
}

/**
 * Safe string includes with null handling
 */
export function safeIncludes(
  str: string | null | undefined,
  searchStr: string,
  defaultValue: boolean = false
): boolean {
  const safeStr = safeString(str);
  return safeStr ? safeStr.includes(searchStr) : defaultValue;
}

/**
 * Safe number parsing with fallback
 */
export function safeNumber(
  value: string | number | null | undefined,
  defaultValue: number = 0
): number {
  if (typeof value === 'number' && !isNaN(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? defaultValue : parsed;
  }
  return defaultValue;
}

/**
 * Safe boolean conversion with null handling
 */
export function safeBoolean(
  value: any,
  defaultValue: boolean = false
): boolean {
  if (value === null || value === undefined) {
    return defaultValue;
  }
  return Boolean(value);
}

/**
 * Execute function with null check
 */
export function safeExecute<T>(
  fn: (() => T) | null | undefined,
  defaultValue: T,
  onError?: (error: Error) => void
): T {
  if (!fn) {
    return defaultValue;
  }

  try {
    return fn();
  } catch (error) {
    if (onError && error instanceof Error) {
      onError(error);
    }
    return defaultValue;
  }
}

/**
 * Type guard for non-null values
 */
export function isNotNull<T>(value: T | null | undefined): value is T {
  return value != null;
}

/**
 * Type guard for non-empty strings
 */
export function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Type guard for non-empty arrays
 */
export function isNonEmptyArray<T>(value: T[] | null | undefined): value is T[] {
  return Array.isArray(value) && value.length > 0;
}

/**
 * Safe JSON parsing with fallback
 */
export function safeJsonParse<T>(
  jsonString: string | null | undefined,
  defaultValue: T,
  onError?: (error: Error) => void
): T {
  if (!jsonString) {
    return defaultValue;
  }

  try {
    return JSON.parse(jsonString);
  } catch (error) {
    if (onError && error instanceof Error) {
      onError(error);
    }
    return defaultValue;
  }
}

/**
 * Assert that value is not null (for development)
 */
export function assertNonNull<T>(value: T | null | undefined, message?: string): asserts value is T {
  if (value == null) {
    throw new Error(message || `Expected value to be non-null, but got ${value}`);
  }
}

/**
 * Null-safe filter for arrays
 */
export function filterNulls<T>(array: (T | null | undefined)[]): T[] {
  return array.filter(isNotNull);
}