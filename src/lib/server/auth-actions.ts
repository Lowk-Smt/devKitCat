"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { AuthFormState, SettingsFormState } from "@/lib/auth-forms";
import {
  ACCOUNT_HOME_PATH,
  LOGIN_PATH,
  customerAuth,
  isAccountServiceAvailable,
  requireCustomer,
  signOutCurrentSession,
  storeSessionCookie,
} from "./auth";
import {
  normalizeEmail,
  validateLoginInput,
  validateProfileInput,
  validateRegistrationInput,
} from "./auth-core";

/**
 * Server Functions behind the sign-in, registration, sign-out, and settings
 * forms.
 *
 * Each one is an untrusted HTTP entry point, so each re-validates its input,
 * re-checks authorization, and returns only display strings. Next.js rejects
 * action requests whose `Origin` does not match the host, which covers CSRF for
 * these state-changing operations; the session cookie is `SameSite=Lax` as a
 * second layer.
 */

const SERVICE_UNAVAILABLE_MESSAGE =
  "Account services are temporarily unavailable. Please try again later.";

function unavailableState(): AuthFormState {
  return { status: "error", message: SERVICE_UNAVAILABLE_MESSAGE };
}

/** Verifies credentials, then issues a session and its HttpOnly cookie. */
export async function signInAction(
  _previousState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!isAccountServiceAvailable()) return unavailableState();

  const validation = validateLoginInput({
    email: formData.get("email"),
    password: formData.get("password"),
    rememberMe: formData.get("rememberMe"),
  });
  if (!validation.ok) {
    return { status: "error", errors: validation.errors, message: validation.message };
  }

  const { email, password, rememberMe } = validation.value;
  const verified = await customerAuth.verifyCredentials({ email, password });
  if (!verified.ok) {
    // One message for every rejection: an unknown email, a customer without a
    // password, a wrong password, and a database failure all look the same.
    return {
      status: "error",
      email,
      message:
        verified.code === "INVALID_CREDENTIALS"
          ? "That email and password combination is not recognized."
          : SERVICE_UNAVAILABLE_MESSAGE,
    };
  }

  const session = await customerAuth.createSession(verified.value.id, { rememberMe });
  if (!session.ok) {
    return { status: "error", email, message: SERVICE_UNAVAILABLE_MESSAGE };
  }

  await storeSessionCookie(session.value.token, session.value.expiresAt);
  redirect(ACCOUNT_HOME_PATH);
}

/** Creates a real customer with a hashed password, then signs them in. */
export async function registerAction(
  _previousState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!isAccountServiceAvailable()) return unavailableState();

  const validation = validateRegistrationInput({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
    acceptTerms: formData.get("acceptTerms"),
  });
  if (!validation.ok) {
    return {
      status: "error",
      errors: validation.errors,
      message: validation.message,
      // The address is not secret; keeping it saves retyping after a fix.
      email: normalizeEmail(formData.get("email")) || undefined,
    };
  }

  const created = await customerAuth.registerCustomer(validation.value);
  if (!created.ok) {
    return {
      status: "error",
      email: validation.value.email,
      ...(created.code === "EMAIL_TAKEN"
        ? {
            errors: {
              email: "An account already uses this email address. Try signing in instead.",
            },
            message: "That email address is already registered.",
          }
        : { message: SERVICE_UNAVAILABLE_MESSAGE }),
    };
  }

  // Registration signs the new customer in so they land on their own account.
  const session = await customerAuth.createSession(created.value.id);
  if (!session.ok) {
    return { status: "error", email: created.value.email, message: SERVICE_UNAVAILABLE_MESSAGE };
  }

  await storeSessionCookie(session.value.token, session.value.expiresAt);
  redirect(ACCOUNT_HOME_PATH);
}

/** Revokes the stored session record and expires the cookie. */
export async function signOutAction(): Promise<void> {
  await signOutCurrentSession();
  redirect(`${LOGIN_PATH}?signed-out=1`);
}

/** Saves the signed-in customer's own profile; identity comes from the session. */
export async function updateAccountSettingsAction(
  _previousState: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const customer = await requireCustomer();

  const validation = validateProfileInput({
    name: formData.get("name"),
    theme: formData.get("theme"),
    productUpdates: formData.get("productUpdates"),
    releaseNotes: formData.get("releaseNotes"),
  });
  if (!validation.ok) {
    return {
      status: "error",
      errors: validation.errors,
      message: validation.message ?? "Your changes were not saved.",
    };
  }

  const updated = await customerAuth.updateProfile(customer.id, validation.value);
  if (!updated.ok) {
    return {
      status: "error",
      message:
        updated.code === "NOT_FOUND"
          ? "Your account is no longer available. Please sign in again."
          : "We could not save your changes. Please try again.",
    };
  }

  // Refresh the account shell (sidebar identity) in the same response.
  revalidatePath("/account", "layout");

  return { status: "saved", message: "Your profile and preferences were saved." };
}
