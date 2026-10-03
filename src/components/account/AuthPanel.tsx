import Link from "next/link";
import { AuthForm, type AuthFormMode } from "@/components/account/AuthForm";
import { Logo } from "@/components/layout/Logo";
import { Icon } from "@/components/ui/Icon";
import { cx } from "@/lib/cx";
import type { AuthNotice } from "@/lib/account-presentation";
import styles from "./AuthPanel.module.css";

interface AuthPanelProps {
  mode: AuthFormMode;
  /** Optional sign-out/unavailability banner derived from the query string. */
  notice?: AuthNotice | null;
  /** True when no database is configured, so accounts cannot be verified. */
  unavailable?: boolean;
}

const ACCOUNT_AREAS = [
  { icon: "receipt", text: "Purchase history" },
  { icon: "download", text: "Resource library" },
  { icon: "settings", text: "Profile preferences" },
] as const;

export function AuthPanel({ mode, notice = null, unavailable = false }: AuthPanelProps) {
  const isRegister = mode === "register";

  return (
    <section className={styles.page}>
      <div className={styles.container}>
        <div className={styles.layout}>
          <div className={styles.formColumn}>
            {notice ? (
              <div
                className={cx(
                  styles.notice,
                  notice.tone === "warning" && styles.noticeWarning,
                )}
                role="status"
              >
                <Icon name="info" size={17} />
                <p>
                  <strong>{notice.title}</strong>
                  <span>{notice.body}</span>
                </p>
              </div>
            ) : null}
            <AuthForm mode={mode} unavailable={unavailable} />
          </div>
          <aside className={styles.intro}>
            <Link className={styles.brand} href="/" aria-label="devKitCat homepage">
              <Logo size={30} />
              <span>devKitCat</span>
            </Link>
            <p className={styles.eyebrow}>Customer workspace</p>
            <h2>Keep your developer resources in one place.</h2>
            <p className={styles.introText}>
              The account area brings your order details, product library, and
              profile controls into the same calm workspace as the marketplace.
            </p>
            <ul className={styles.areaList}>
              {ACCOUNT_AREAS.map((area) => (
                <li key={area.text}>
                  <span className={styles.areaIcon}>
                    <Icon name={area.icon} size={17} />
                  </span>
                  <span>{area.text}</span>
                </li>
              ))}
            </ul>
            <div className={styles.statusNote}>
              <span className={styles.statusDot} aria-hidden="true" />
              <p>
                <strong>Signed out</strong>
                <span>
                  {isRegister
                    ? "Registration creates your devKitCat customer account and signs you in."
                    : "Sign in with your devKitCat account to open purchases and downloads."}
                </span>
              </p>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
