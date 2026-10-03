import type { Metadata } from "next";
import { AuthPanel } from "@/components/account/AuthPanel";

export const metadata: Metadata = {
  title: "Create an account",
  description: "Frontend preview of the devKitCat customer registration screen.",
};

export default function RegisterPage() {
  return <AuthPanel mode="register" />;
}
