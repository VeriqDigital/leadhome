import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { credentialsSchema } from "@/lib/validation";

export const { handlers, auth, signIn, signOut } = NextAuth({
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  providers: [Credentials({ credentials: { email: {}, password: {} }, async authorize(raw) { const parsed = credentialsSchema.safeParse(raw); if (!parsed.success) return null; const user = await prisma.user.findUnique({ where: { email: parsed.data.email }, select: { id: true, name: true, email: true, passwordHash: true } }); if (!user || !(await compare(parsed.data.password, user.passwordHash))) return null; return { id: user.id, name: user.name, email: user.email }; } })],
  callbacks: {
    jwt({ token, user }) { if (user?.id) token.id = user.id; return token; },
    session({ session, token }) { if (session.user) session.user.id = token.id as string; return session; },
    authorized({ auth: session, request }) { const isAuthPage = ["/login", "/register"].includes(request.nextUrl.pathname); if (isAuthPage) return session?.user ? Response.redirect(new URL("/", request.nextUrl)) : true; return Boolean(session?.user); },
  },
});
