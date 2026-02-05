import { NavLink } from "react-router-dom";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOnboardingProgress } from "@/state/useOnboardingProgress";

interface NavItemProps {
  to: string;
  label: string;
  isComplete?: boolean;
}

function NavItem({ to, label, isComplete }: NavItemProps): JSX.Element {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-1.5 transition-colors hover:text-primary",
          isActive ? "text-primary" : "text-muted-foreground"
        )
      }
    >
      {label}
      {isComplete !== undefined && (
        <span
          className={cn(
            "flex h-4 w-4 items-center justify-center rounded-full text-[10px]",
            isComplete
              ? "bg-emerald-500 text-white"
              : "bg-muted-foreground/20"
          )}
          aria-label={isComplete ? "Complete" : "Incomplete"}
        >
          {isComplete && <Check className="h-2.5 w-2.5" />}
        </span>
      )}
    </NavLink>
  );
}

export function Header(): JSX.Element {
  const profilePublished = useOnboardingProgress((state) => state.profilePublished);
  const menuPublished = useOnboardingProgress((state) => state.menuPublished);
  const discoveryPageUrl = useOnboardingProgress((state) => state.discoveryPageUrl);
  const restaurantName = useOnboardingProgress((state) => state.restaurantName);
  
  // Discovery is considered published when we have a URL
  const discoveryPublished = discoveryPageUrl !== null;

  return (
    <header className="border-b">
      <div className="container flex h-16 items-center justify-between">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold">Synvya</span>
            {restaurantName && (
              <>
                <span className="text-muted-foreground">|</span>
                <span className="text-sm font-medium text-muted-foreground">
                  {restaurantName}
                </span>
              </>
            )}
          </div>
          <nav className="flex items-center gap-3 text-sm">
            <NavItem
              to="/app/profile"
              label="Profile"
              isComplete={profilePublished}
            />
            <NavItem
              to="/app/menu"
              label="Menu"
              isComplete={menuPublished}
            />
            {/* TODO: Re-enable when Reservations feature is ready */}
            {false && (
              <NavLink
                to="/app/reservations"
                className={({ isActive }) =>
                  cn(
                    "transition-colors hover:text-primary",
                    isActive ? "text-primary" : "text-muted-foreground"
                  )
                }
              >
                Reservations
              </NavLink>
            )}
            <NavItem
              to="/app/website"
              label="Get Discovered"
              isComplete={discoveryPublished}
            />
            {import.meta.env.DEV && (
              <NavLink
                to="/app/test-harness"
                className={({ isActive }) =>
                  cn(
                    "transition-colors hover:text-primary",
                    isActive ? "text-primary" : "text-muted-foreground"
                  )
                }
              >
                Test Harness
              </NavLink>
            )}
            <NavLink
              to="/app/settings"
              className={({ isActive }) =>
                cn(
                  "transition-colors hover:text-primary",
                  isActive ? "text-primary" : "text-muted-foreground"
                )
              }
            >
              Account
            </NavLink>
          </nav>
        </div>
      </div>
    </header>
  );
}
