"use client";

import { DropdownMenu } from "radix-ui";
import { LogOut } from "lucide-react";

export function UserMenu({ name, emoji }: { name: string; emoji: string }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label="Account menu"
        className="grid size-10 place-items-center rounded-full bg-card text-2xl shadow-sm ring-2 ring-brand-purple/20 outline-none hover:ring-brand-purple/40 focus-visible:ring-brand-purple"
      >
        <span aria-hidden>{emoji}</span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 min-w-44 rounded-2xl border bg-popover p-1.5 shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <DropdownMenu.Label className="px-3 py-2 text-sm font-extrabold">{name}</DropdownMenu.Label>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <form action="/auth/signout" method="post">
            <DropdownMenu.Item asChild>
              <button
                type="submit"
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold outline-none data-[highlighted]:bg-muted"
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
