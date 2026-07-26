"use client";
import Link from "next/link";
import { useActionState } from "react";
import type { ActionState } from "@/lib/validation";
import { googleLoginAction } from "@/app/actions/auth-actions";

const initialState: ActionState = {};
export function AuthForm({
  mode,
  action,
}: {
  mode: "login" | "register";
  action: (state: ActionState, data: FormData) => Promise<ActionState>;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const register = mode === "register";
  return (
    <div className="mt-8 text-[#17181c]">
    {!register && (
      <>
        <form action={googleLoginAction}>
          <button className="h-11 w-full rounded-xl border border-black/10 bg-white text-sm font-semibold">
            Continue with Google
          </button>
        </form>
        <div className="my-5 flex items-center gap-3 text-xs text-[#9297a1] before:h-px before:flex-1 before:bg-black/10 after:h-px after:flex-1 after:bg-black/10">or</div>
      </>
    )}
    <form action={formAction} className="space-y-5">
      {register && (
        <Field
          name="name"
          label="Full name"
          placeholder="Mick Enev"
          error={state.errors?.name?.[0]}
        />
      )}
      <Field
        name="email"
        type="email"
        label="Email address"
        placeholder="you@company.com"
        error={state.errors?.email?.[0]}
      />
      <Field
        name="password"
        type="password"
        label="Password"
        placeholder={register ? "At least 8 characters" : "Enter your password"}
        error={state.errors?.password?.[0]}
      />
      {state.message && (
        <p
          className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700"
          role="alert"
        >
          {state.message}
        </p>
      )}
      <button
        disabled={pending}
        className="h-11 w-full rounded-xl bg-[#17181c] text-sm font-semibold text-white transition-colors hover:bg-black disabled:opacity-60"
      >
        {pending ? "Please wait..." : register ? "Create account" : "Sign in"}
      </button>
      <p className="text-center text-sm text-[#687080]">
        {register ? "Already have an account?" : "New to LeadHome?"}{" "}
        <Link
          className="font-semibold text-[#17181c] hover:underline"
          href={register ? "/login" : "/register"}
        >
          {register ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </form></div>
  );
}
function Field({
  name,
  label,
  type = "text",
  placeholder,
  error,
}: {
  name: string;
  label: string;
  type?: string;
  placeholder: string;
  error?: string;
}) {
  return (
    <label className="block text-[#17181c]">
      <span className="mb-2 block text-sm font-semibold text-[#17181c]">
        {label}
      </span>
      <input
        required
        name={name}
        type={type}
        placeholder={placeholder}
        autoComplete={name === "password" ? "current-password" : name}
        className="h-11 w-full rounded-xl border border-black/10 bg-white px-3.5 text-sm text-[#17181c] outline-none transition placeholder:text-[#9297a1] focus:border-[#7770c8] focus:ring-2 focus:ring-[#7770c8]/15"
      />
      {error && (
        <span className="mt-1.5 block text-xs text-red-600">{error}</span>
      )}
    </label>
  );
}
