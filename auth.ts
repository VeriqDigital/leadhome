import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { compare } from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { credentialsSchema } from "@/lib/validation";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email },
          select: { id: true, name: true, email: true, passwordHash: true },
        });
        if (
          !user ||
          !user.passwordHash ||
          !(await compare(parsed.data.password, user.passwordHash))
        ) {
          return null;
        }
        return { id: user.id, name: user.name, email: user.email };
      },
    }),
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "google-not-configured",
      clientSecret:
        process.env.GOOGLE_CLIENT_SECRET ?? "google-not-configured",
      authorization: { params: { scope: "openid email profile" } },
    }),
  ],
  callbacks: {
    signIn({ account, profile }) {
      if (account?.provider === "google" && profile && profile.email_verified !== true) {
        return false;
      }
      return true;
    },
    jwt({ token, user }) {
      if (user?.id) token.id = user.id;
      return token;
    },
    session({ session, token }) {
      if (session.user && typeof token.id === "string") {
        session.user.id = token.id;
      }
      return session;
    },
    authorized({ auth: session, request }) {
      const isAuthPage = ["/login", "/register"].includes(
        request.nextUrl.pathname,
      );
      if (isAuthPage) {
        return session?.user
          ? Response.redirect(new URL("/", request.nextUrl))
          : true;
      }
      return Boolean(session?.user);
    },
  },
});
