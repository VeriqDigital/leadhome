import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { Sidebar } from "./sidebar";
import { auth } from "@/auth";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LeadHome Dashboard",
  description: "Every lead has a home.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Sidebar user={(await auth())?.user} />
        <main className="dashboard-main min-h-screen px-4 pb-5 pt-24 sm:px-7 sm:pb-8 lg:ml-[246px] lg:px-10 lg:py-8 xl:px-12 xl:py-10">
          {children}
        </main>
      </body>
    </html>
  );
}
