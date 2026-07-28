import { getCurrentUser } from "@/modules/identity/server/session";
import { SiteHeader } from "./site-header";

function getInitials(displayName: string) {
  return (
    displayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "А"
  );
}

export async function AuthenticatedSiteHeader() {
  const user = await getCurrentUser();

  return (
    <SiteHeader
      user={
        user
          ? {
              displayName: user.displayName,
              initials: getInitials(user.displayName),
            }
          : undefined
      }
    />
  );
}
