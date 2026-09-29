import type { IconName } from "@/types";

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

const ICONS: Record<IconName, React.ReactNode> = {
  systems: (
    <>
      <path d="M12 3 3 7.5 12 12l9-4.5L12 3Z" />
      <path d="M3 12.5 12 17l9-4.5" />
      <path d="M3 17 12 21.5 21 17" />
    </>
  ),
  "ui-kits": (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18" />
      <path d="M9 9v11" />
    </>
  ),
  "3d-assets": (
    <>
      <path d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7L12 2.5Z" />
      <path d="M3.5 7 12 11.5 20.5 7" />
      <path d="M12 11.5v10" />
    </>
  ),
  vfx: (
    <>
      <path d="M12 3.5 13.7 8.3 18.5 10 13.7 11.7 12 16.5 10.3 11.7 5.5 10l4.8-1.7L12 3.5Z" />
      <path d="M18.5 15.5l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7.7-1.9Z" />
    </>
  ),
  audio: (
    <>
      <path d="M4 10v4" />
      <path d="M8 7v10" />
      <path d="M12 4.5v15" />
      <path d="M16 7v10" />
      <path d="M20 10v4" />
    </>
  ),
  "developer-tools": (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m7.5 9.5 3 2.5-3 2.5" />
      <path d="M13 15h3.5" />
    </>
  ),
  templates: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6" />
      <path d="M9 17h4" />
    </>
  ),
  "complete-kits": (
    <>
      <rect x="4" y="7" width="16" height="13" rx="2" />
      <path d="M9 7V5.5A2.5 2.5 0 0 1 11.5 3h1A2.5 2.5 0 0 1 15 5.5V7" />
      <path d="M4 12.5h16" />
    </>
  ),
  production: (
    <>
      <path d="M12 2.5 20 5.5v6c0 4.5-3.2 7.9-8 10-4.8-2.1-8-5.5-8-10v-6l8-3Z" />
      <path d="m8.8 11.8 2.3 2.3 4.1-4.6" />
    </>
  ),
  reuse: (
    <>
      <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
      <path d="M3 21v-5h5" />
    </>
  ),
  quality: (
    <>
      <circle cx="12" cy="8.5" r="5.5" />
      <path d="m8.8 13.2-1.3 7.8 4.5-2.4 4.5 2.4-1.3-7.8" />
    </>
  ),
  docs: (
    <>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
    </>
  ),
  "arrow-right": (
    <>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </>
  ),
  menu: (
    <>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </>
  ),
  close: (
    <>
      <path d="m6 6 12 12" />
      <path d="M18 6 6 18" />
    </>
  ),
};

/**
 * Inline SVG icon set (no icon dependency).
 * Decorative by default — pair with visible text or an aria-label.
 */
export function Icon({ name, size = 20, className }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {ICONS[name]}
    </svg>
  );
}
