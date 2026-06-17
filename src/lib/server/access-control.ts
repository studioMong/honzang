export const ACCESS_COOKIE_NAME = "honzang_access";
export const ACCESS_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

const ACCESS_CODE_ENV = "HONZANG_ACCESS_CODE";
const ACCESS_TOKEN_SALT_ENV = "HONZANG_ACCESS_TOKEN_SALT";
const DEFAULT_ACCESS_TOKEN_SALT = "honzang-access-v1";

type CookieReader = {
  cookies: {
    get: (name: string) => { value?: string } | undefined;
  };
};

export function isAccessControlEnabled() {
  return getAccessCode() !== null;
}

export function isAccessTokenSaltConfigured() {
  return Boolean(process.env[ACCESS_TOKEN_SALT_ENV]?.trim());
}

export function verifyAccessCode(code: unknown) {
  const expectedCode = getAccessCode();
  return typeof code === "string" && expectedCode !== null && constantTimeEqual(code, expectedCode);
}

export async function createAccessToken() {
  const accessCode = getAccessCode();
  if (!accessCode || !canUseAccessTokenSalt()) return null;
  return sha256Hex(`${getAccessTokenSalt()}:${accessCode}`);
}

export async function isRequestAuthenticated(request: CookieReader) {
  if (!isAccessControlEnabled()) return true;
  const cookieValue = request.cookies.get(ACCESS_COOKIE_NAME)?.value;
  if (!cookieValue) return false;
  const expectedToken = await createAccessToken();
  return expectedToken !== null && constantTimeEqual(cookieValue, expectedToken);
}

function getAccessCode() {
  const value = process.env[ACCESS_CODE_ENV]?.trim();
  return value ? value : null;
}

function getAccessTokenSalt() {
  return process.env[ACCESS_TOKEN_SALT_ENV]?.trim() || DEFAULT_ACCESS_TOKEN_SALT;
}

function canUseAccessTokenSalt() {
  return isAccessTokenSaltConfigured() || process.env.NODE_ENV !== "production";
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}
