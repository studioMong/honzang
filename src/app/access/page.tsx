import { Suspense } from "react";
import { AccessGate } from "@/components/access-gate";

export default function AccessPage() {
  return (
    <Suspense fallback={<AccessFallback />}>
      <AccessGate />
    </Suspense>
  );
}

function AccessFallback() {
  return (
    <main className="access-page">
      <section className="access-card panel">
        <div className="access-brand">
          <div className="brand-mark">장</div>
          <div>
            <p>혼자장부</p>
            <h1>접근 코드</h1>
          </div>
        </div>
      </section>
    </main>
  );
}
