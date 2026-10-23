import { Star } from "lucide-react";

export function GitHubLink({
  href,
  placement,
}: {
  href: string;
  placement: "home" | "topbar";
}) {
  const inTopBar = placement === "topbar";

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Star on GitHub (opens in a new tab)"
      className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-navy-border bg-surface-2 text-xs font-bold text-text-secondary transition-colors hover:bg-surface-3 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-twilio-red focus-visible:ring-offset-2 focus-visible:ring-offset-navy ${
        inTopBar ? "h-8 w-8 lg:w-auto lg:px-3" : "h-9 px-3"
      }`}
    >
      <Star className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className={inTopBar ? "hidden lg:inline" : undefined}>
        Star on GitHub
      </span>
    </a>
  );
}
