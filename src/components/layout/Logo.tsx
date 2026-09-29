import { cx } from "@/lib/cx";
import styles from "./Logo.module.css";

interface LogoProps {
  size?: number;
  className?: string;
}

/**
 * devKitCat brand mark: a minimal cat outline with a terminal prompt face.
 * Decorative — pair with a visible wordmark or an accessible label.
 */
export function Logo({ size = 28, className }: LogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={cx(styles.mark, className)}
    >
      {/* Ears */}
      <path d="M9 10V4.5L14 10" />
      <path d="M23 10V4.5L18 10" />
      {/* Head */}
      <rect x="4" y="10" width="24" height="18" rx="4.5" />
      {/* Eyes */}
      <circle cx="12" cy="16.5" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="20" cy="16.5" r="1.3" fill="currentColor" stroke="none" />
      {/* Terminal prompt "face" */}
      <path d="m12.2 21.8 2.4 2.2-2.4 2.2" />
      <path d="M17.4 26.2h4" />
    </svg>
  );
}
