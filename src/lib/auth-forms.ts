/**
 * Shared contract between the account Server Functions and the client forms.
 *
 * This module is deliberately dependency-free and framework-free so both sides
 * can import it. It carries only display strings — never a password, a password
 * digest, or a session token.
 */

export type AuthFormField = "name" | "email" | "password" | "confirmPassword" | "acceptTerms";

export type AuthFormErrors = Partial<Record<AuthFormField, string>>;

export interface AuthFormState {
  status: "idle" | "error";
  message?: string;
  errors?: AuthFormErrors;
  /** Re-populated after a failed sign-in or registration; never a password. */
  email?: string;
}

export const initialAuthFormState: AuthFormState = { status: "idle" };

export type SettingsFormField = "name" | "theme";

export type SettingsFormErrors = Partial<Record<SettingsFormField, string>>;

/**
 * Return values are serialized to the browser, so they carry display strings
 * only — never a customer record, a digest, or a token.
 */
export interface SettingsFormState {
  status: "idle" | "saved" | "error";
  message?: string;
  errors?: SettingsFormErrors;
}

export const initialSettingsFormState: SettingsFormState = { status: "idle" };
