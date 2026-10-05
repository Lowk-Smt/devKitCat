import { requireStaffAccess } from "@/lib/server/staff";

/**
 * The management surface is private.
 *
 * This layout is the outermost check, but it is not what makes the area secure:
 * Next.js layouts do not re-render on client-side navigation, so every page and
 * every Server Function under `/manage` re-checks authorization itself. The check
 * is `cache()`-memoized per request, so the layout and the page together still
 * read the grant once.
 */
export default async function ManageLayout({ children }: LayoutProps<"/manage">) {
  await requireStaffAccess();

  return <>{children}</>;
}
