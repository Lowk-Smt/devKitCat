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
  fullWidth?: boolean;
  disabled?: boolean;
  onClick?: () => void;
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
  fullWidth = false,
  disabled = false,
  onClick,
}: ButtonProps) {
  const classes = cx(
    styles.button,
    styles[variant],
    styles[size],
    fullWidth && styles.fullWidth,
    className,
  );

  if (href) {
    return (
      <Link
        href={href}
        className={classes}
        aria-label={ariaLabel}
        onClick={onClick}
      >
        {children}
      </Link>
    );
  }

  return (
    <button
      type={type}
      className={classes}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
