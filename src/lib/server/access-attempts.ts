export const ACCESS_LOGIN_MAX_FAILURES = 5;
export const ACCESS_LOGIN_WINDOW_SECONDS = 10 * 60;
export const ACCESS_LOGIN_LOCK_SECONDS = 10 * 60;

type AttemptRecord = {
  failureCount: number;
  lockedUntil: number;
  windowStartedAt: number;
};

type AttemptState = {
  blocked: boolean;
  remainingAttempts: number;
  retryAfterSeconds: number;
};

const globalAttemptStore = globalThis as typeof globalThis & {
  __honzangAccessAttempts?: Map<string, AttemptRecord>;
};

const attempts = globalAttemptStore.__honzangAccessAttempts ?? new Map<string, AttemptRecord>();
globalAttemptStore.__honzangAccessAttempts = attempts;

export function inspectAccessAttempt(request: Request): AttemptState {
  const key = accessAttemptKey(request);
  const now = Date.now();
  const record = attempts.get(key);
  if (!record) return createOpenState(ACCESS_LOGIN_MAX_FAILURES);

  if (record.lockedUntil > now) {
    return {
      blocked: true,
      remainingAttempts: 0,
      retryAfterSeconds: secondsUntil(record.lockedUntil, now)
    };
  }

  if (isExpired(record, now)) {
    attempts.delete(key);
    return createOpenState(ACCESS_LOGIN_MAX_FAILURES);
  }

  return createOpenState(Math.max(0, ACCESS_LOGIN_MAX_FAILURES - record.failureCount));
}

export function recordAccessFailure(request: Request): AttemptState {
  const key = accessAttemptKey(request);
  const now = Date.now();
  const existing = attempts.get(key);
  const record =
    existing && !isExpired(existing, now)
      ? existing
      : {
          failureCount: 0,
          lockedUntil: 0,
          windowStartedAt: now
        };

  record.failureCount += 1;
  if (record.failureCount >= ACCESS_LOGIN_MAX_FAILURES) {
    record.lockedUntil = now + ACCESS_LOGIN_LOCK_SECONDS * 1000;
  }

  attempts.set(key, record);
  return inspectAccessAttempt(request);
}

export function clearAccessFailures(request: Request) {
  attempts.delete(accessAttemptKey(request));
}

function accessAttemptKey(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  return forwardedFor || realIp || "local";
}

function createOpenState(remainingAttempts: number): AttemptState {
  return {
    blocked: false,
    remainingAttempts,
    retryAfterSeconds: 0
  };
}

function isExpired(record: AttemptRecord, now: number) {
  return now - record.windowStartedAt > ACCESS_LOGIN_WINDOW_SECONDS * 1000;
}

function secondsUntil(timestamp: number, now: number) {
  return Math.max(1, Math.ceil((timestamp - now) / 1000));
}
