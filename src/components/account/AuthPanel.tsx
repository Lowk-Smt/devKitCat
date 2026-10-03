import Link from "next/link";
import { AuthForm, type AuthFormMode } from "@/components/account/AuthForm";
import { Logo } from "@/components/layout/Logo";
import { Icon } from "@/components/ui/Icon";
import styles from "./AuthPanel.module.css";

interface AuthPanelProps {
  mode: AuthFormMode;
}

const ACCOUNT_AREAS = [
  { icon: "receipt", text: "Purchase history" },
  { icon: "download", text: "Resource library" },
  { icon: "settings", text: "Profile preferences" },
] as const;

export function AuthPanel({ mode }: AuthPanelProps) {
  return (
    <section className={styles.page}>
      <div className={styles.container}>
        <div className={styles.layout}>
          <AuthForm mode={mode} />
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
            <div className={styles.previewNote}>
              <span className={styles.previewDot} aria-hidden="true" />
              <p>
                <strong>Preview state</strong>
                <span>
                  {mode === "login"
                    ? "You are viewing the logged-out sign-in screen."
                    : "You are viewing the logged-out registration screen."}
                </span>
              </p>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
