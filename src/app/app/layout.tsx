import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getCurrentSession } from "@/modules/auth/service";
import { AppShellRouter } from "@/components/layout/app-shell-router";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  return <AppShellRouter session={session}>{children}</AppShellRouter>;
}
