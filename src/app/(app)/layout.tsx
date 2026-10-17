import Link from "next/link";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh [background:var(--hub-gradient)]">
      <header className="sticky top-0 z-10 border-b bg-background/70 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link href="/hub" className="text-lg font-black">
            Crack the <span className="text-brand-purple">Case</span>
          </Link>
          <nav className="flex gap-4 text-sm font-bold text-muted-foreground">
            <Link href="/hub" className="text-foreground">Hub</Link>
            <span aria-disabled className="opacity-50">Cases</span>
            <span aria-disabled className="opacity-50">Trophies</span>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
