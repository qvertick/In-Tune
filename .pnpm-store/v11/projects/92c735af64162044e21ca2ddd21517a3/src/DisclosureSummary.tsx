import type { ComponentPropsWithoutRef } from "react";
import { ChevronRight } from "lucide-react";
import "./disclosure.css";

/** Keep native details/summary keyboard and open-state semantics. */
export default function DisclosureSummary({
  children,
  className = "",
  ...props
}: ComponentPropsWithoutRef<"summary">) {
  return (
    <summary {...props} className={`disclosure-summary ${className}`.trim()}>
      <span className="disclosure-label">{children}</span>
      <span className="disclosure-indicator" aria-hidden="true">
        <ChevronRight size={17} strokeWidth={1.8} />
      </span>
    </summary>
  );
}
