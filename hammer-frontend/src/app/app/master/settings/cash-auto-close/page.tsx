import { redirect } from "next/navigation";

export default function CashAutoCloseRedirectPage() {
  redirect("/app/master/settings/operational-automation");
}
