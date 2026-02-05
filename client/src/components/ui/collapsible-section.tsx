import * as React from "react";
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface CollapsibleSectionProps {
  title: string;
  description?: string;
  badge?: "required" | "recommended";
  isComplete?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}

/**
 * CollapsibleSection component for grouping form fields
 * Features expand/collapse with chevron animation, completion indicator, and badges
 */
export function CollapsibleSection({
  title,
  description,
  badge,
  isComplete = false,
  defaultOpen = true,
  children,
  className
}: CollapsibleSectionProps): JSX.Element {
  const [open, setOpen] = React.useState(defaultOpen);

  return (
    <CollapsiblePrimitive.Root
      open={open}
      onOpenChange={setOpen}
      className={cn("rounded-lg border bg-card", className)}
    >
      <CollapsiblePrimitive.Trigger
        className="flex w-full items-center justify-between gap-3 p-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-expanded={open}
      >
        <div className="flex items-center gap-3">
          {/* Completion indicator */}
          <div
            className={cn(
              "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors",
              isComplete
                ? "border-emerald-500 bg-emerald-500 text-white"
                : "border-muted-foreground/30 bg-transparent"
            )}
            aria-label={isComplete ? "Section complete" : "Section incomplete"}
          >
            {isComplete && <Check className="h-3 w-3" />}
          </div>

          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span className="font-medium">{title}</span>
              {badge && (
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs font-medium",
                    badge === "required"
                      ? "bg-destructive/10 text-destructive"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {badge === "required" ? "Required" : "Recommended"}
                </span>
              )}
            </div>
            {description && (
              <span className="text-sm text-muted-foreground">{description}</span>
            )}
          </div>
        </div>

        {/* Chevron with rotation animation */}
        <ChevronDown
          className={cn(
            "h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-180"
          )}
          aria-hidden="true"
        />
      </CollapsiblePrimitive.Trigger>

      <CollapsiblePrimitive.Content
        className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down"
      >
        <div className="border-t p-4">{children}</div>
      </CollapsiblePrimitive.Content>
    </CollapsiblePrimitive.Root>
  );
}

CollapsibleSection.displayName = "CollapsibleSection";
