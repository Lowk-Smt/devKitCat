"use client";

import { useActionState } from "react";
import { FormField } from "@/components/account/FormField";
import { Button } from "@/components/ui/Button";
import { cx } from "@/lib/cx";
import { initialSettingsFormState } from "@/lib/auth-forms";
import { updateAccountSettingsAction } from "@/lib/server/auth-actions";
import type { CustomerRecord } from "@/types/account";
import styles from "./SettingsForm.module.css";

interface SettingsFormProps {
  /** The authenticated customer whose profile this form edits. */
  customer: CustomerRecord;
}

/**
 * Profile and preference editor.
 *
 * The submission carries only the customer's own changes; identity comes from
 * the verified session on the server, so there is no account ID to tamper with
 * and the email address is deliberately not an editable field.
 */
export function SettingsForm({ customer }: SettingsFormProps) {
  const [state, formAction, pending] = useActionState(
    updateAccountSettingsAction,
    initialSettingsFormState,
  );
  const nameError = state.errors?.name;
  const themeError = state.errors?.theme;

  return (
    <form action={formAction} className={styles.form} method="post">
      <fieldset className={styles.group} disabled={pending}>
        <legend className={styles.legend}>Profile</legend>
        <p className={styles.groupDescription}>
          Your display name is stored on your devKitCat customer account.
        </p>
        <div className={styles.profileFields}>
          <FormField id="display-name" label="Display name" error={nameError}>
            <input
              className={styles.input}
              id="display-name"
              name="name"
              type="text"
              autoComplete="name"
              defaultValue={customer.name}
              minLength={2}
              maxLength={80}
              required
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? "display-name-error" : undefined}
            />
          </FormField>
          <FormField id="account-email" label="Email address">
            <input
              className={styles.input}
              id="account-email"
              type="email"
              autoComplete="email"
              defaultValue={customer.email}
              readOnly
              aria-describedby="account-email-hint"
            />
          </FormField>
        </div>
        <p className={styles.fieldHelp} id="account-email-hint">
          This address signs you in, so it cannot be changed yet. Email changes
          and verification are a future addition.
        </p>
      </fieldset>

      <fieldset className={styles.group} disabled={pending}>
        <legend className={styles.legend}>Preferences</legend>
        <p className={styles.groupDescription}>
          These selections are saved with your account.
        </p>
        <FormField id="theme-preference" label="Theme preference" error={themeError}>
          <select
            className={styles.input}
            id="theme-preference"
            name="theme"
            defaultValue={customer.preferences.theme}
            aria-invalid={themeError ? true : undefined}
            aria-describedby={themeError ? "theme-preference-error" : undefined}
          >
            <option value="dark">Dark</option>
            <option value="system">Use device setting</option>
          </select>
        </FormField>
        <div className={styles.checkGroup}>
          <label className={styles.checkRow} htmlFor="product-updates">
            <input
              id="product-updates"
              name="productUpdates"
              type="checkbox"
              value="true"
              defaultChecked={customer.preferences.productUpdates}
            />
            <span>
              <strong>Product updates</strong>
              <small>Information about resources in your library</small>
            </span>
          </label>
          <label className={styles.checkRow} htmlFor="release-notes">
            <input
              id="release-notes"
              name="releaseNotes"
              type="checkbox"
              value="true"
              defaultChecked={customer.preferences.releaseNotes}
            />
            <span>
              <strong>Release notes</strong>
              <small>Updates when a resource version changes</small>
            </span>
          </label>
        </div>
      </fieldset>

      <div className={styles.submitRow}>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving changes…" : "Save changes"}
        </Button>
        {state.message ? (
          <p
            className={cx(styles.message, state.status === "error" && styles.messageError)}
            role={state.status === "error" ? "alert" : "status"}
            aria-live="polite"
          >
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
