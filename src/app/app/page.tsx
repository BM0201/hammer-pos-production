import { redirect } from "next/navigation";
import { getCurrentSession } from "@/modules/auth/service";
import { getRoleAwareHome } from "@/modules/rbac/guards";

export default async function AppIndexPage() {
  const session = await getCurrentSession();
  if (!session) {
    redirect("/login");
  }

  redirect(getRoleAwareHome(session.roleCode, session.globalRoles));
}
