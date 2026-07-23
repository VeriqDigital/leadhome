import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { loginAction } from "../actions/auth-actions";
import { AuthForm } from "../auth-form";
import { AuthShell } from "../auth-shell";
export default async function LoginPage() {
  if ((await auth())?.user) redirect("/");
  return (
    <AuthShell title="Welcome back" description="Sign in to manage your leads.">
      <AuthForm mode="login" action={loginAction} />
    </AuthShell>
  );
}
