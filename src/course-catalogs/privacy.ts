const SENSITIVE_KEY_PATTERN =
  /(password|passwd|credential|cookie|session|sso|admin.*id|admin.*account|account.*id|raw|payload|token|secret)/iu;
const SENSITIVE_VALUE_PATTERN =
  /(cookie|session|sso|credential|password|admin\s*id|admin\s*account|bearer\s+[a-z0-9._-]+)/iu;

export function sanitizeMetadata(
  value: unknown,
): Record<string, unknown> {
  const sanitized = sanitizeJsonValue(value);
  if (isRecord(sanitized)) {
    return sanitized;
  }

  return {};
}

export function sanitizeWarning(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  if (containsSensitiveText(value)) {
    return "warning omitted because it contained sensitive source details";
  }

  return value;
}

export function containsSensitiveText(value: string): boolean {
  return SENSITIVE_VALUE_PATTERN.test(value);
}

function sanitizeJsonValue(value: unknown): unknown {
  if (value === null) {
    return null;
  }

  if (
    typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
  ) {
    if (typeof value === "string" && SENSITIVE_VALUE_PATTERN.test(value)) {
      return "[redacted]";
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJsonValue(item));
  }

  if (!isRecord(value)) {
    return null;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      continue;
    }

    sanitized[key] = sanitizeJsonValue(item);
  }

  return sanitized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
