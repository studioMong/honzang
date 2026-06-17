export const securityHeaderChecks = [
  {
    name: "content-security-policy",
    pattern: /frame-ancestors 'none'/,
    label: "CSP frame-ancestors"
  },
  {
    name: "cross-origin-opener-policy",
    pattern: /^same-origin$/,
    label: "Cross-Origin-Opener-Policy"
  },
  {
    name: "cross-origin-resource-policy",
    pattern: /^same-origin$/,
    label: "Cross-Origin-Resource-Policy"
  },
  {
    name: "permissions-policy",
    pattern: /camera=\(\).*microphone=\(\)/,
    label: "Permissions-Policy"
  },
  {
    name: "referrer-policy",
    pattern: /^no-referrer$/,
    label: "Referrer-Policy"
  },
  {
    name: "strict-transport-security",
    pattern: /max-age=63072000/,
    label: "Strict-Transport-Security"
  },
  {
    name: "x-content-type-options",
    pattern: /^nosniff$/,
    label: "X-Content-Type-Options"
  },
  {
    name: "x-frame-options",
    pattern: /^DENY$/,
    label: "X-Frame-Options"
  }
];

export function findSecurityHeaderIssues(headers) {
  return securityHeaderChecks.flatMap((check) => {
    const value = headers.get(check.name) ?? "";
    if (check.pattern.test(value)) return [];
    return [`${check.label}: ${value || "missing"}`];
  });
}
