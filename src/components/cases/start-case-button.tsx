"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";

export function StartCaseButton({ caseSlug, label = "Start case" }: { caseSlug: string; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/consultations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ caseSlug }),
    });
    const body = await res.json().catch(() => null);
    if (body?.data?.id) return router.push(`/station/${body.data.id}`);
    setBusy(false);
    setError(body?.error?.message ?? "Couldn't start the case. Please try again.");
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="reward" size="lg" onClick={start} disabled={busy}>
        <Stethoscope /> {busy ? "Calling them in…" : label}
      </Button>
      {error && (
        <p role="alert" className="text-sm font-semibold text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
