import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "bg-card placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-ring/30 aria-invalid:border-destructive h-12 w-full min-w-0 rounded-xl border-2 px-4 text-base font-semibold transition-colors outline-none placeholder:font-normal focus-visible:ring-[3px] disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
