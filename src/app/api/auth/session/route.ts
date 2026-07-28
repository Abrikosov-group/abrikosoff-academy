import { getCurrentUser } from "@/modules/identity/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();

  return Response.json(
    user
      ? {
          authenticated: true,
          user: {
            id: user.id,
            displayName: user.displayName,
            methodType: user.primaryMethod.type,
          },
        }
      : {
          authenticated: false,
        },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
