"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useState, type FormEvent } from "react";
import { FormField } from "@/components/account/FormField";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { getPasswordConfirmationError } from "@/lib/account-presentation";
import { initialAuthFormState } from "@/lib/auth-forms";
import { registerAction, signInAction } from "@/lib/server/auth-actions";
import styles from "./AuthForm.module.css";

export type AuthFormMode = "login" | "register";

interface AuthFormProps {
  mode: AuthFormMode;
  /** Set when no database is configured, so credentials cannot be verified. */
  unavailable?: boolean;
}

const PASSWORD_RECOVERY_NOTICE =
  "Password recovery is not available yet. Sign-in help is a future addition to devKitCat.";

/**
 * Real sign-in and registration form.
 *
 * Submission goes to a Server Function, so credentials are validated, hashed,
 * and checked on the server and never reach the client bundle, the URL, or any
 * log. `method="post"` is declared as well so a password can never end up in a
 * query string even if a browser submits the form natively.
 */
export function AuthForm({ mode, unavailable = false }: AuthFormProps) {
  const isRegister = mode === "register";
  const [state, formAction, pending] = useActionState(
    isRegister ? registerAction : signInAction,
    initialAuthFormState,
  );
  const [showPassword, setShowPassword] = useState(false);
  const [confirmationError, setConfirmationError] = useState("");
  const [localNotice, setLocalNotice] = useState("");

  const passwordId = isRegister ? "register-password" : "login-password";
  const fieldErrors = state.errors ?? {};
  const message = localNotice || state.message;
  const busy = pending || unavailable;
  const passwordDescribedBy = [
    `${passwordId}-hint`,
    fieldErrors.password ? `${passwordId}-error` : null,
  ]
    .filter(Boolean)
    .join(" ");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    setLocalNotice("");
    if (!isRegister) return;

    const form = event.currentTarget;
    const password = form.querySelector<HTMLInputElement>(`#${passwordId}`);
    const confirmation = form.querySelector<HTMLInputElement>("#confirm-password");
    if (!password || !confirmation) return;

    // Instant feedback; the server validates the same rule again.
    const confirmationMessage = getPasswordConfirmationError(
      password.value,
      confirmation.value,
    );
    if (confirmationMessage) {
      event.preventDefault();
      setConfirmationError(confirmationMessage);
      confirmation.focus();
    }
  }

  return (
    <div className={styles.formCard}>
      <div className={styles.formHeading}>
        <p className={styles.eyebrow}>
          {isRegister ? "Create a profile" : "Customer sign in"}
        </p>
        <h1>{isRegister ? "Create your account" : "Welcome back"}</h1>
        <p className={styles.description}>
          {isRegister
            ? "Set up your devKitCat customer profile."
            : "Sign in to view your purchases and resource library."}
        </p>
      </div>

      {unavailable ? (
        <div className={styles.warningNotice} role="status">
          <Icon name="info" size={17} />
          <p>
            Account services are unavailable in this deployment because no
            PostgreSQL database is configured. Set <code>DATABASE_URL</code>,
            apply the Prisma migration, and reload to create or use an account.
          </p>
        </div>
      ) : null}

      <form
        action={formAction}
        className={styles.form}
        method="post"
        onSubmit={handleSubmit}
      >
        {isRegister ? (
          <FormField
            id="register-name"
            label="Name"
            error={fieldErrors.name}
          >
            <input
              className={styles.input}
              id="register-name"
              name="name"
              type="text"
              autoComplete="name"
              maxLength={80}
              required
              disabled={unavailable}
              aria-invalid={fieldErrors.name ? true : undefined}
              aria-describedby={fieldErrors.name ? "register-name-error" : undefined}
            />
          </FormField>
        ) : null}

        <FormField
          id={`${mode}-email`}
          label="Email address"
          error={fieldErrors.email}
        >
          <input
            className={styles.input}
            id={`${mode}-email`}
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            maxLength={254}
            required
            disabled={unavailable}
            defaultValue={state.email ?? ""}
            aria-invalid={fieldErrors.email ? true : undefined}
            aria-describedby={fieldErrors.email ? `${mode}-email-error` : undefined}
          />
        </FormField>

        <FormField
          id={passwordId}
          label="Password"
          hint={
            isRegister
              ? "Use at least 8 characters. Do not reuse a password from another service."
              : "Enter the password for your devKitCat account."
          }
          error={fieldErrors.password}
        >
          <div className={styles.passwordWrap}>
            <input
              className={`${styles.input} ${styles.passwordInput}`}
              id={passwordId}
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete={isRegister ? "new-password" : "current-password"}
              minLength={8}
              maxLength={128}
              required
              disabled={unavailable}
              aria-invalid={fieldErrors.password ? true : undefined}
              aria-describedby={passwordDescribedBy}
            />
            <button
              className={styles.passwordToggle}
              type="button"
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              aria-controls={passwordId}
              onClick={() => setShowPassword((visible) => !visible)}
            >
              <Icon name={showPassword ? "eye-off" : "eye"} size={18} />
            </button>
          </div>
        </FormField>

        {isRegister ? (
          <FormField
            id="confirm-password"
            label="Confirm password"
            error={confirmationError || fieldErrors.confirmPassword}
          >
            <input
              className={styles.input}
              id="confirm-password"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={128}
              required
              disabled={unavailable}
              aria-invalid={
                confirmationError || fieldErrors.confirmPassword ? true : undefined
              }
              aria-describedby={
                confirmationError || fieldErrors.confirmPassword
                  ? "confirm-password-error"
                  : undefined
              }
              onInput={() => setConfirmationError("")}
            />
          </FormField>
        ) : (
          <div className={styles.loginOptions}>
            <label className={styles.remember} htmlFor="remember-me">
              <input
                id="remember-me"
                name="rememberMe"
                type="checkbox"
                value="true"
                disabled={unavailable}
              />
              <span>Remember me for 30 days</span>
            </label>
            <button
              className={styles.forgotButton}
              type="button"
              onClick={() => setLocalNotice(PASSWORD_RECOVERY_NOTICE)}
            >
              Forgot password?
            </button>
          </div>
        )}

        {isRegister ? (
          <div className={styles.termsGroup}>
            <details className={styles.termsDetails}>
              <summary>Read the account terms</summary>
              <p>
                Creating an account stores your name, email address, and a
                salted scrypt hash of your password in the devKitCat database so
                you can return to your purchases and library. Checkout, paid
                file delivery, email verification, and password recovery are not
                available yet, so use an address and password you are comfortable
                storing in a preview marketplace.
              </p>
            </details>
            <label className={styles.termsCheck} htmlFor="accept-terms">
              <input
                id="accept-terms"
                name="acceptTerms"
                type="checkbox"
                value="true"
                required
                disabled={unavailable}
                aria-invalid={fieldErrors.acceptTerms ? true : undefined}
                aria-describedby={
                  fieldErrors.acceptTerms ? "accept-terms-error" : undefined
                }
              />
              <span>I acknowledge and agree to the account terms above.</span>
            </label>
            {fieldErrors.acceptTerms ? (
              <p className={styles.fieldError} id="accept-terms-error" aria-live="polite">
                {fieldErrors.acceptTerms}
              </p>
            ) : null}
          </div>
        ) : null}

        {message ? (
          <p
            className={
              state.status === "error" && !localNotice
                ? `${styles.feedback} ${styles.feedbackError}`
                : styles.feedback
            }
            role={state.status === "error" ? "alert" : "status"}
            aria-live="polite"
          >
            {message}
          </p>
        ) : null}

        <Button type="submit" fullWidth disabled={busy}>
          {pending
            ? isRegister
              ? "Creating account…"
              : "Signing in…"
            : isRegister
              ? "Create account"
              : "Sign in"}
        </Button>
      </form>

      <p className={styles.switchPrompt}>
        {isRegister ? "Already have an account?" : "New to devKitCat?"}{" "}
        <Link href={isRegister ? "/login" : "/register"}>
          {isRegister ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </div>
  );
}
