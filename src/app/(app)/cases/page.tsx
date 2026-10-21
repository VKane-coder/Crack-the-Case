import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, SearchX } from "lucide-react";
import { CaseCard } from "@/components/cases/case-card";
import { FilterBar } from "@/components/cases/filter-bar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { filtersToQuery, hasFilters, parseFilters } from "@/features/case-library/filters";
import { requireUser } from "@/server/auth/session";
import { listCases } from "@/server/cases/catalog";
import { patientAvailable } from "@/server/station/llm";

export const metadata: Metadata = { title: "Case library" };

export default async function CasesPage({ searchParams }: PageProps<"/cases">) {
  const user = await requireUser("/cases");
  const filters = parseFilters(await searchParams);
  const { cases, total, page, pageCount, specialties } = await listCases(await createClient(), user.id, filters);
  const canStart = patientAvailable();
  const filtered = hasFilters(filters);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-black sm:text-3xl">Case library</h1>
        <p className="text-muted-foreground" aria-live="polite">
          {filtered ? `${total} case${total === 1 ? "" : "s"} match your filters.` : `${total} case${total === 1 ? "" : "s"} ready to crack.`}
        </p>
      </div>

      <FilterBar key={filtersToQuery({ ...filters, page: 1 })} filters={filters} specialties={specialties} />

      {cases.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {cases.map((c) => (
            <CaseCard key={c.id} c={c} canStart={canStart} />
          ))}
        </div>
      ) : (
        <Card className="items-center py-10 text-center">
          <SearchX className="size-8 text-muted-foreground" />
          <p className="font-bold">{filtered ? "No cases match those filters." : "No cases yet. Check back soon."}</p>
          {filtered && (
            <Button asChild variant="outline">
              <Link href="/cases">Clear filters</Link>
            </Button>
          )}
        </Card>
      )}

      {pageCount > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-between gap-3">
          {page > 1 ? (
            <Button asChild variant="outline">
              <Link href={`/cases${filtersToQuery({ ...filters, page: page - 1 })}`}>
                <ChevronLeft /> Previous
              </Link>
            </Button>
          ) : (
            <span />
          )}
          <span className="text-sm font-semibold text-muted-foreground">
            Page {Math.min(page, pageCount)} of {pageCount}
          </span>
          {page < pageCount ? (
            <Button asChild variant="outline">
              <Link href={`/cases${filtersToQuery({ ...filters, page: page + 1 })}`}>
                Next <ChevronRight />
              </Link>
            </Button>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
