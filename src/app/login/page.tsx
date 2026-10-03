import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthPanel } from "@/components/account/AuthPanel";
import { resolveAuthNotice } from "@/lib/account-presentation";
import { ACCOUNT_HOME_PATH, getAuthenticatedCustomer, isAccountServiceAvailable } from "@/lib/server/auth";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your devKitCat customer account.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;

  // A customer with a valid session has nothing to sign in to.
  if (await getAuthenticatedCustomer()) redirect(ACCOUNT_HOME_PATH);

  return (
    <AuthPanel
      mode="login"
      notice={resolveAuthNotice(params)}
      unavailable={!isAccountServiceAvailable()}
    />
  );
}
