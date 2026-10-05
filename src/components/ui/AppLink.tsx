import Link from "next/link";
import type { AnchorHTMLAttributes } from "react";

interface AppLinkProps
  extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: string;
}

/**
 * Keep fragment navigation native. If hydration starts on a hash URL, Next.js
 * can retain that fragment in its cached canonical URL and append a later Link
 * fragment to it, producing a duplicate hash. Route links still use Next.js
 * client-side navigation; fragments are applied once by the browser.
 */
export function AppLink({ href, ...props }: AppLinkProps) {
  if (href.includes("#")) {
    return <a href={href} {...props} />;
  }

  return <Link href={href} {...props} />;
}
