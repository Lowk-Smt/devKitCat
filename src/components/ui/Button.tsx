import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import styles from "./Button.module.css";

type ButtonVariant = "primary" | "secondary";
type ButtonSize = "md" | "sm";

interface ButtonProps {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** When set, renders as a link. */
  href?: string;
  type?: "button" | "submit";
  className?: string;
  ariaLabel?: string;
}

/**
 * Shared action component. Renders a Next.js link when `href` is provided,
 * otherwise a native `<button>`.
 */
export function Button({
  children,
  variant = "primary",
  size = "md",
  href,
  type = "button",
  className,
  ariaLabel,
}: ButtonProps) {
  const classes = cx(
    styles.button,
    styles[variant],
    styles[size],
    className,
  );

  if (href) {
    return (
      <Link href={href} className={classes} aria-label={ariaLabel}>
        {children}
      </Link>
    );
  }

  return (
    <button type={type} className={classes} aria-label={ariaLabel}>
      {children}
    </button>
  );
}
