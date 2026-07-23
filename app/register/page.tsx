import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { registerAction } from "../actions/auth-actions";
import { AuthForm } from "../auth-form";
import { AuthShell } from "../auth-shell";
export default async function RegisterPage() {
  if ((await auth())?.user) redirect("/");
  return (
    <AuthShell
      title="Create your account"
      description="Give every lead a place to move forward."
    >
      <AuthForm mode="register" action={registerAction} />
    </AuthShell>
  );
}
