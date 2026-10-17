import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-primary/15 text-primary",
        teal: "bg-brand-teal/15 text-brand-teal",
        purple: "bg-brand-purple/15 text-brand-purple",
        coral: "bg-brand-coral/15 text-brand-coral",
        outline: "border text-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
