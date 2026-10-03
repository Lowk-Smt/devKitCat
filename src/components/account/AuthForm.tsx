"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { FormField } from "@/components/account/FormField";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { getPasswordConfirmationError } from "@/lib/account-presentation";
import styles from "./AuthForm.module.css";

export type AuthFormMode = "login" | "register";

interface AuthFormProps {
  mode: AuthFormMode;
}

export function AuthForm({ mode }: AuthFormProps) {
  const isRegister = mode === "register";
  const [showPassword, setShowPassword] = useState(false);
  const [confirmationError, setConfirmationError] = useState("");
  const [feedback, setFeedback] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback("");
    setConfirmationError("");

    const form = event.currentTarget;
    if (!form.reportValidity()) return;

    if (isRegister) {
      const password = form.querySelector<HTMLInputElement>("#register-password");
      const confirmation = form.querySelector<HTMLInputElement>("#confirm-password");
      if (!password || !confirmation) return;
      const confirmationMessage = getPasswordConfirmationError(
        password.value,
        confirmation.value,
      );
      if (confirmationMessage) {
        setConfirmationError(confirmationMessage);
        confirmation.focus();
        return;
      }
    }

    // Credentials are intentionally never submitted, stored, logged, or retained.
    form.reset();
    setShowPassword(false);
    setFeedback(
      isRegister
        ? "Demo only — no account was created, and your credentials were not sent or stored."
        : "Demo only — sign-in is not connected, and your credentials were not sent or stored.",
    );
  }

  const passwordId = isRegister ? "register-password" : "login-password";

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

      <div className={styles.demoNotice} role="note">
        <Icon name="info" size={17} />
        <p>
          UI preview only. Do not enter a real password. Nothing is sent to or
          stored by this page.
        </p>
      </div>

      <form
        action={isRegister ? "/register" : "/login"}
        className={styles.form}
        method="get"
        onSubmit={handleSubmit}
      >
        {isRegister ? (
          <FormField id="register-name" label="Name">
            <input
              className={styles.input}
              id="register-name"
              type="text"
              autoComplete="name"
              maxLength={80}
              required
            />
          </FormField>
        ) : null}

        <FormField id={`${mode}-email`} label="Email address">
          <input
            className={styles.input}
            id={`${mode}-email`}
            type="email"
            autoComplete="email"
            inputMode="email"
            maxLength={254}
            required
          />
        </FormField>

        <FormField
          id={passwordId}
          label="Password"
          hint="Use at least 8 characters."
        >
          <div className={styles.passwordWrap}>
            <input
              className={`${styles.input} ${styles.passwordInput}`}
              id={passwordId}
              type={showPassword ? "text" : "password"}
              aria-describedby={`${passwordId}-hint`}
              autoComplete={isRegister ? "new-password" : "current-password"}
              minLength={8}
              required
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
            error={confirmationError}
          >
            <input
              className={styles.input}
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              aria-invalid={confirmationError ? true : undefined}
              aria-describedby={
                confirmationError ? "confirm-password-error" : undefined
              }
              onInput={() => setConfirmationError("")}
            />
          </FormField>
        ) : (
          <div className={styles.loginOptions}>
            <label className={styles.remember} htmlFor="remember-me">
              <input id="remember-me" type="checkbox" />
              <span>Remember me</span>
            </label>
            <button
              className={styles.forgotButton}
              type="button"
              onClick={() =>
                setFeedback("Password recovery is not available in this preview.")
              }
            >
              Forgot password?
            </button>
          </div>
        )}

        {isRegister ? (
          <div className={styles.termsGroup}>
            <details className={styles.termsDetails}>
              <summary>Read the demo terms</summary>
              <p>
                This screen is a frontend prototype, not a real registration
                service. It does not create an account or accept production
                terms. Use placeholder information only; credentials are not
                transmitted or saved.
              </p>
            </details>
            <label className={styles.termsCheck} htmlFor="accept-demo-terms">
              <input
                id="accept-demo-terms"
                type="checkbox"
                required
              />
              <span>I acknowledge and agree to the demo terms above.</span>
            </label>
          </div>
        ) : null}

        {feedback ? (
          <p className={styles.feedback} role="status" aria-live="polite">
            {feedback}
          </p>
        ) : null}

        <Button type="submit" fullWidth>
          {isRegister ? "Create account" : "Sign in"}
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
