import type { Metadata } from "next";
import { AuthPanel } from "@/components/account/AuthPanel";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Frontend preview of the devKitCat customer sign-in screen.",
};

export default function LoginPage() {
  return <AuthPanel mode="login" />;
}
