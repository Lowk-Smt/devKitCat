"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/account/FormField";
import styles from "./SettingsForm.module.css";

interface SettingsFormProps {
  name: string;
  email: string;
  preferences: {
    theme: string;
    productUpdates: boolean;
    releaseNotes: boolean;
  };
}

export function SettingsForm({ name, email, preferences }: SettingsFormProps) {
  const [message, setMessage] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(
      "Preview only — your changes were not saved or sent to a service.",
    );
  }

  return (
    <form
      action="/account/settings"
      className={styles.form}
      method="get"
      onSubmit={handleSubmit}
    >
      <fieldset className={styles.group}>
        <legend className={styles.legend}>Profile</legend>
        <p className={styles.groupDescription}>
          Edit controls are presentational in this frontend preview.
        </p>
        <div className={styles.profileFields}>
          <FormField id="display-name" label="Display name">
            <input
              className={styles.input}
              id="display-name"
              type="text"
              autoComplete="name"
              defaultValue={name}
              maxLength={80}
            />
          </FormField>
          <FormField id="account-email" label="Email address">
            <input
              className={styles.input}
              id="account-email"
              type="email"
              autoComplete="email"
              defaultValue={email}
              readOnly
              aria-describedby="account-email-hint"
            />
          </FormField>
        </div>
        <p className={styles.fieldHelp} id="account-email-hint">
          Email editing will be available when account services are connected.
        </p>
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={styles.legend}>Preferences</legend>
        <p className={styles.groupDescription}>
          These demo selections do not change or persist your account.
        </p>
        <FormField id="theme-preference" label="Theme preference">
          <select
            className={styles.input}
            id="theme-preference"
            defaultValue={preferences.theme}
          >
            <option value="dark">Dark</option>
            <option value="system">Use device setting</option>
          </select>
        </FormField>
        <div className={styles.checkGroup}>
          <label className={styles.checkRow} htmlFor="product-updates">
            <input
              id="product-updates"
              type="checkbox"
              defaultChecked={preferences.productUpdates}
            />
            <span>
              <strong>Product updates</strong>
              <small>Information about resources in your library</small>
            </span>
          </label>
          <label className={styles.checkRow} htmlFor="release-notes">
            <input
              id="release-notes"
              type="checkbox"
              defaultChecked={preferences.releaseNotes}
            />
            <span>
              <strong>Release notes</strong>
              <small>Updates when a resource version changes</small>
            </span>
          </label>
        </div>
      </fieldset>

      <div className={styles.submitRow}>
        <Button type="submit" variant="primary">
          Save preview changes
        </Button>
        {message ? (
          <p className={styles.message} role="status" aria-live="polite">
            {message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
