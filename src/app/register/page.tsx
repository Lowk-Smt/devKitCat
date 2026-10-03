import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthPanel } from "@/components/account/AuthPanel";
import { resolveAuthNotice } from "@/lib/account-presentation";
import { ACCOUNT_HOME_PATH, getAuthenticatedCustomer, isAccountServiceAvailable } from "@/lib/server/auth";

export const metadata: Metadata = {
  title: "Create an account",
  description: "Create a devKitCat customer account to track purchases and downloads.",
};

export default async function RegisterPage({ searchParams }: PageProps<"/register">) {
  const params = await searchParams;

  // Registration is for new customers; signed-in visitors go to their account.
  if (await getAuthenticatedCustomer()) redirect(ACCOUNT_HOME_PATH);

  return (
    <AuthPanel
      mode="register"
      notice={resolveAuthNotice(params)}
      unavailable={!isAccountServiceAvailable()}
    />
  );
}
