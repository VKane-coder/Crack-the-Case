"use client";

import { DropdownMenu } from "radix-ui";
import { LogOut } from "lucide-react";

export function UserMenu({ name, emoji }: { name: string; emoji: string }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label="Account menu"
        className="bg-card ring-brand-purple/20 hover:ring-brand-purple/40 focus-visible:ring-brand-purple grid size-10 place-items-center rounded-full text-2xl shadow-sm ring-2 outline-none"
      >
        <span aria-hidden>{emoji}</span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="bg-popover data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 z-50 min-w-44 rounded-2xl border p-1.5 shadow-lg"
        >
          <DropdownMenu.Label className="px-3 py-2 text-sm font-extrabold">{name}</DropdownMenu.Label>
          <DropdownMenu.Separator className="bg-border my-1 h-px" />
          <form action="/auth/signout" method="post">
            {/* Keep the menu open on select: closing unmounts the form before the browser submits it. */}
            <DropdownMenu.Item asChild onSelect={(e) => e.preventDefault()}>
              <button
                type="submit"
                className="data-[highlighted]:bg-muted flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold outline-none"
              >
                <LogOut className="size-4" /> Sign out
              </button>
            </DropdownMenu.Item>
          </form>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
