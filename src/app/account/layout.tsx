import { AccountShell } from "@/components/account/AccountShell";
import { requireCustomer } from "@/lib/server/auth";

/**
 * Every `/account` route is protected. The layout resolves the signed-in
 * customer for the shell, and each page repeats `requireCustomer()` next to its
 * own data reads so no segment can render without a verified session.
 */
export default async function AccountLayout({ children }: LayoutProps<"/account">) {
  const customer = await requireCustomer();

  return <AccountShell customer={customer}>{children}</AccountShell>;
}
