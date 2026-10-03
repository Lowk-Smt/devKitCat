"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { cx } from "@/lib/cx";
import styles from "./AccountNavigation.module.css";

const ACCOUNT_LINKS = [
  { href: "/account", label: "Overview", icon: "home" },
  { href: "/account/purchases", label: "Purchases", icon: "receipt" },
  { href: "/account/downloads", label: "Downloads", icon: "download" },
  { href: "/account/settings", label: "Settings", icon: "settings" },
] as const;

interface AccountNavigationProps {
  variant: "sidebar" | "mobile";
}

/** Shared customer navigation, with a compact disclosure presentation on mobile. */
export function AccountNavigation({ variant }: AccountNavigationProps) {
  const pathname = usePathname();

  return (
    <nav
      className={cx(styles.navigation, styles[variant])}
      aria-label="Account navigation"
    >
      {ACCOUNT_LINKS.map((link) => {
        const active =
          link.href === "/account"
            ? pathname === link.href
            : pathname.startsWith(link.href);

        return (
          <Link
            key={link.href}
            href={link.href}
            className={cx(styles.link, active && styles.active)}
            aria-current={active ? "page" : undefined}
            onClick={(event) => {
              if (variant === "mobile") {
                const disclosure = event.currentTarget.closest("details");
                if (disclosure) disclosure.open = false;
              }
            }}
          >
            <Icon name={link.icon} size={18} />
            <span>{link.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
