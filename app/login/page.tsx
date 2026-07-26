import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { loginAction } from "../actions/auth-actions";
import { AuthForm } from "../auth-form";
import { AuthShell } from "../auth-shell";
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if ((await auth())?.user) redirect("/");
  const error = (await searchParams).error;
  const oauthMessage =
    error === "OAuthAccountNotLinked"
      ? "An account with this email already exists. Sign in with your password first, then link Google from Settings."
      : error
        ? "Google sign-in could not be completed. Please try again."
        : null;
  return (
    <AuthShell title="Welcome back" description="Sign in to manage your leads.">
      {oauthMessage && <p role="alert" className="mt-5 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">{oauthMessage}</p>}
      <AuthForm mode="login" action={loginAction} />
    </AuthShell>
  );
}
