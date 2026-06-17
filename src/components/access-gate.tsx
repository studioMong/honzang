"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { LockKeyhole, LogIn } from "lucide-react";
import { useSearchParams } from "next/navigation";

type SessionPayload = {
  enabled: boolean;
  authenticated: boolean;
};

export function AccessGate() {
  const searchParams = useSearchParams();
  const nextPath = useMemo(() => sanitizeNextPath(searchParams.get("next")), [searchParams]);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let active = true;

    async function checkSession() {
      const response = await fetch("/api/auth/session", { cache: "no-store" }).catch(() => null);
      if (!response?.ok) return;
      const payload = (await response.json()) as SessionPayload;
      if (active && (!payload.enabled || payload.authenticated)) {
        window.location.replace(nextPath);
      }
    }

    void checkSession();
    return () => {
      active = false;
    };
  }, [nextPath]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!code.trim()) {
      setMessage("접근 코드를 입력하세요.");
      return;
    }

    setPending(true);
    setMessage("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() })
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setMessage(typeof payload.message === "string" ? payload.message : "접근 코드를 확인하세요.");
        return;
      }

      window.location.assign(nextPath);
    } catch {
      setMessage("로그인 요청을 처리하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="access-page">
      <section className="access-card panel" aria-labelledby="access-title">
        <div className="access-brand">
          <div className="brand-mark">장</div>
          <div>
            <p>혼자장부</p>
            <h1 id="access-title">접근 코드</h1>
          </div>
        </div>
        <form className="access-form" onSubmit={submit}>
          <div className="field">
            <label htmlFor="access-code">코드</label>
            <input
              autoComplete="current-password"
              autoFocus
              id="access-code"
              inputMode="text"
              type="password"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="Railway 환경변수에 설정한 코드"
            />
          </div>
          {message && (
            <p className="field-help" role="alert">
              {message}
            </p>
          )}
          <div className="access-actions">
            <span className="status blue">
              <LockKeyhole size={14} />
              보호됨
            </span>
            <button className="primary-button" disabled={pending} type="submit">
              <LogIn size={17} />
              {pending ? "확인 중" : "들어가기"}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}

function sanitizeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/access")) return "/";
  return value;
}
