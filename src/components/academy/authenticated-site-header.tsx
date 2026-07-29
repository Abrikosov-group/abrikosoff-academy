import { connection } from "next/server";
import { getUserInitials } from "@/modules/identity/domain/user-presentation";
import { getCurrentUser } from "@/modules/identity/server/session";
import { SiteHeader } from "./site-header";

export async function AuthenticatedSiteHeader() {
  await connection();
  const user = await getCurrentUser();

  return (
    <SiteHeader
      user={
        user
          ? {
              avatarUrl: user.avatarUrl,
              displayName: user.displayName,
              initials: getUserInitials(user.displayName),
            }
          : undefined
      }
    />
  );
}
