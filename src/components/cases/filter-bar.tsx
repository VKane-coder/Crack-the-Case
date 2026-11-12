"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LENGTHS, filtersToQuery, hasFilters, type CaseFilters } from "@/features/case-library/filters";
import { cn } from "@/lib/utils";

const SELECT =
  "h-12 w-full min-w-0 rounded-xl border-2 bg-card px-3 text-base font-semibold outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-ring/30";

/**
 * Specialty, difficulty and length filters plus search. Filters live in the URL, so a filtered
 * library can be bookmarked or shared, and changing a filter goes back to page 1.
 */
export function FilterBar({ filters, specialties }: { filters: CaseFilters; specialties: { slug: string; name: string }[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(filters.q ?? "");

  function go(next: Partial<CaseFilters>) {
    startTransition(() => router.replace(`/cases${filtersToQuery({ ...filters, ...next, page: 1 })}`, { scroll: false }));
  }

  return (
    <form
      role="search"
      aria-label="Filter cases"
      aria-busy={pending}
      className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr]", pending && "opacity-70")}
      onSubmit={(e) => {
        e.preventDefault();
        go({ q: q.trim() || undefined });
      }}
    >
      <div className="relative sm:col-span-2 lg:col-span-1">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2" />
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search cases"
          aria-label="Search cases"
          className="pl-10"
          maxLength={100}
        />
      </div>
      <select
        aria-label="Specialty"
        className={SELECT}
        value={filters.specialty ?? ""}
        onChange={(e) => go({ specialty: e.target.value || undefined })}
      >
        <option value="">All specialties</option>
        {specialties.map((s) => (
          <option key={s.slug} value={s.slug}>
            {s.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Difficulty"
        className={SELECT}
        value={filters.difficulty ?? ""}
        onChange={(e) => go({ difficulty: Number(e.target.value) || undefined })}
      >
        <option value="">Any difficulty</option>
        {[1, 2, 3, 4, 5].map((d) => (
          <option key={d} value={d}>
            Difficulty {d}/5
          </option>
        ))}
      </select>
      <select
        aria-label="Length"
        className={SELECT}
        value={filters.length ?? ""}
        onChange={(e) => go({ length: (e.target.value || undefined) as CaseFilters["length"] })}
      >
        <option value="">Any length</option>
        {Object.entries(LENGTHS).map(([key, { label }]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
      {hasFilters(filters) && (
        <Button
          type="button"
          variant="ghost"
          className="justify-self-start sm:col-span-2 lg:col-span-4"
          onClick={() => {
            setQ("");
            startTransition(() => router.replace("/cases", { scroll: false }));
          }}
        >
          <X /> Clear filters
        </Button>
      )}
    </form>
  );
}
