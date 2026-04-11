import { redirect } from "next/navigation";
import { getCurrentSession } from "@/modules/auth/service";
import { isOwnerRole, isSystemAdminRole } from "@/modules/rbac/role-routing";
import { OwnerDashboard } from "@/components/owner/owner-dashboard";

export default async function OwnerPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");

  const role = session.roleCode as string;
  const globals = (session.globalRoles ?? []) as unknown as string[];
  if (!isOwnerRole(role, globals) && !isSystemAdminRole(role, globals)) {
    redirect("/app");
  }

  return <OwnerDashboard />;
}
