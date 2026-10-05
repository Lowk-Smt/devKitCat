"use client";

import { usePathname } from "next/navigation";
import { AppLink } from "@/components/ui/AppLink";
import { useEffect, useState } from "react";
import { CartButton } from "@/components/cart/CartButton";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Logo } from "@/components/layout/Logo";
import { cx } from "@/lib/cx";
import styles from "./Header.module.css";

const NAV_LINKS = [
  { href: "/products", label: "Products" },
  { href: "/#categories", label: "Categories" },
  { href: "/account", label: "Account" },
] as const;

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();

  // Close the mobile menu with the Escape key.
  useEffect(() => {
    if (!menuOpen) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  function isActive(href: string): boolean {
    if (href === "/products") return pathname.startsWith("/products");
    if (href === "/account") return pathname.startsWith("/account");
    if (href === "/#categories") return false;
    return pathname === href;
  }

  return (
    <header className={styles.header}>
      <div className={cx("container", styles.inner)}>
        <AppLink
          href="/"
          className={styles.brand}
          aria-label="devKitCat — home"
          onClick={() => setMenuOpen(false)}
        >
          <Logo size={28} />
          <span className={styles.wordmark}>devKitCat</span>
        </AppLink>

        <nav className={styles.desktopNav} aria-label="Main navigation">
          {NAV_LINKS.map((link) => (
            <AppLink
              key={link.href}
              href={link.href}
              className={cx(
                styles.navLink,
                isActive(link.href) && styles.navLinkActive,
              )}
              aria-current={isActive(link.href) ? "page" : undefined}
            >
              {link.label}
            </AppLink>
          ))}
          <span className={styles.navPlaceholder}>
            Documentation
            <span className={styles.soonChip}>Soon</span>
          </span>
        </nav>

        <div className={styles.actions}>
          <Button href="/products" size="sm" className={styles.headerCta}>
            Browse Products
          </Button>
          <CartButton />
          <button
            type="button"
            className={styles.menuButton}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Icon name={menuOpen ? "close" : "menu"} size={22} />
          </button>
        </div>
      </div>

      {menuOpen ? (
        <nav
          id="mobile-menu"
          className={styles.mobileNav}
          aria-label="Mobile navigation"
        >
          <div className={cx("container", styles.mobileNavInner)}>
            {NAV_LINKS.map((link) => (
              <AppLink
                key={link.href}
                href={link.href}
                className={cx(
                  styles.mobileNavLink,
                  isActive(link.href) && styles.navLinkActive,
                )}
                aria-current={isActive(link.href) ? "page" : undefined}
                onClick={() => setMenuOpen(false)}
              >
                {link.label}
              </AppLink>
            ))}
            <span className={cx(styles.mobileNavLink, styles.navPlaceholder)}>
              Documentation
              <span className={styles.soonChip}>Soon</span>
            </span>
            <Button
              href="/products"
              size="sm"
              className={styles.mobileMenuCta}
            >
              Browse Products
            </Button>
          </div>
        </nav>
      ) : null}
    </header>
  );
}
