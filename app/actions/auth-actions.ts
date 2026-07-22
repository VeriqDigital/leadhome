"use server";
import { AuthError } from "next-auth";
import { hash } from "bcryptjs";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/auth";
import { prisma } from "@/lib/prisma";
import { credentialsSchema, registerSchema, type ActionState } from "@/lib/validation";

export async function loginAction(_state: ActionState, formData: FormData): Promise<ActionState> { const parsed = credentialsSchema.safeParse(Object.fromEntries(formData)); if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors }; try { await signIn("credentials", { ...parsed.data, redirectTo: "/" }); } catch (error) { if (error instanceof AuthError) return { message: "Email or password is incorrect." }; throw error; } return {}; }
export async function registerAction(_state: ActionState, formData: FormData): Promise<ActionState> { const parsed = registerSchema.safeParse(Object.fromEntries(formData)); if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors }; const exists = await prisma.user.findUnique({ where: { email: parsed.data.email }, select: { id: true } }); if (exists) return { message: "An account with this email already exists." }; try { await prisma.user.create({ data: { name: parsed.data.name, email: parsed.data.email, passwordHash: await hash(parsed.data.password, 12) } }); } catch { return { message: "We couldn't create your account. Please try again." }; } try { await signIn("credentials", { email: parsed.data.email, password: parsed.data.password, redirectTo: "/" }); } catch (error) { if (error instanceof AuthError) redirect("/login"); throw error; } return {}; }
export async function logoutAction() { await signOut({ redirectTo: "/login" }); }
