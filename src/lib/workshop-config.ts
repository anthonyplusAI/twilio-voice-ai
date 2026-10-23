import type { ChapterMeta } from "./types";

// ─── Workshop Configuration ─────────────────────────────────────────
// This is the single source of truth for a workshop instance.
// Every layout component, page, and feature reads from this config.
// To create a new workshop, copy workshop.config.ts and customize.

export interface WorkshopConfig {
  /** Unique ID — used for localStorage namespacing (e.g. "voice-ai") */
  id: string;

  /** Full title shown on hero page (e.g. "Build a Voice AI Agent") */
  title: string;

  /** Short title for the top bar (e.g. "Voice AI Workshop") */
  shortTitle: string;

  /** Meta description for SEO */
  description: string;

  /** Estimated total duration (e.g. "90 minutes") */
  duration: string;

  /** Optional GitHub repository URL shown in the workshop chrome */
  repositoryUrl?: string;

  /** Hero page configuration */
  hero: {
    /** Subtitle / tagline below the title */
    tagline: string;
    /**
     * Optional word within the tagline to color with the accent. Default is
     * "Conversation Relay"; set to `null` to disable accent highlighting, or
     * override with a word specific to your workshop.
     */
    taglineAccent?: string | null;
    /** Paragraph description */
    description: string;
    /** Call-to-action button text */
    ctaText: string;
    /** Optional hero illustration path (relative to /public/) */
    illustration?: string;
  };

  /** Branding overrides */
  branding: {
    /** Primary accent color hex (e.g. "#EF223A") */
    accentColor: string;
    /** RGB values for rgba usage (e.g. "239, 34, 58") */
    accentColorRgb: string;
    /**
     * Square logo shown in the TopBar and on the hero page. Public-relative
     * path. Defaults to the Twilio bug if omitted so new workshops still
     * render; forks should override to their own mark.
     */
    logo?: {
      /** Image path (relative to /public/) */
      src: string;
      /** Alt text for the logo */
      alt: string;
    };
    /**
     * "Powered by" logo shown in the home-page footer. If omitted, the footer
     * hides — a workshop forked for a different brand won't awkwardly declare
     * it's powered by Twilio unless you say so.
     */
    poweredByLogo?: {
      /** Logo path for dark mode (relative to /public/) */
      dark: string;
      /** Logo path for light mode (relative to /public/) */
      light: string;
      /** Alt text for the logo */
      alt: string;
      /** Optional link URL (defaults to no link) */
      href?: string;
    };
  };

  /** Chapter structure — defines all chapters and their steps */
  chapters: ChapterMeta[];

  /** Sidebar widget configuration */
  sidebar: {
    /** Widget type: 'custom' shows configurable key-value card, 'none' hides it */
    widget: "custom" | "none";
    /** Title of the sidebar card (e.g. "Your Agent") */
    title?: string;
    /** Fields to display — reads values from progress.workshopState[key] */
    fields?: { label: string; key: string }[];
  };

  /** Feature flags */
  features: {
    /** Enable Builder/Explorer audience toggle */
    audienceToggle: boolean;
    /** Enable chapter completion celebrations */
    celebrations: boolean;
    /** Enable dark/light theme toggle */
    themeToggle: boolean;
  };

  /** Default theme — "dark" or "light" (users can override via toggle) */
  defaultTheme?: "dark" | "light";

  /**
   * Copy shown on `/workshop/complete`. All fields optional — sensible
   * defaults ship below so a fresh workshop still renders a celebration.
   * Override any subset per workshop to match the agent/project being built.
   */
  completionCopy?: {
    /** Small uppercase eyebrow above the headline */
    eyebrow?: string;
    /** Main H1 headline (e.g. "You built a Voice AI Agent.") */
    headline?: string;
    /** Supporting paragraph under the headline */
    description?: string;
    /** Celebration icon path (relative to /public/) — default: award badge */
    icon?: string;
    /** Confetti burst colors (hex strings). Falls back to Twilio palette. */
    confettiColors?: string[];
  };

  /** Social media sharing configuration (shown on final celebration) */
  sharing?: {
    /** Whether sharing buttons are enabled */
    enabled: boolean;
    /** Event/context name (e.g. "Twilio SIGNAL 2026") */
    eventName?: string;
    /** URL to share (e.g. workshop URL or event landing page) */
    shareUrl?: string;
    /** Platform-specific configs */
    platforms: {
      x?: {
        /** The account handle to tag, without @ (e.g. "twilio") */
        handle: string;
        /** Profile URL for display purposes */
        url: string;
        /** Pre-filled tweet text. Supports {title}, {event} placeholders */
        message: string;
        /** Hashtags without # (e.g. ["TwilioSIGNAL", "VoiceAI"]) */
        hashtags?: string[];
      };
      linkedin?: {
        /** Company page URL */
        url: string;
        /** Share message text. Supports {title}, {event} placeholders */
        message: string;
      };
    };
  };
}
