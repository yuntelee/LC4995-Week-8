import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/admin-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if ("response" in auth) {
    return auth.response;
  }

  return NextResponse.json({
    user: {
      id: auth.user.id,
      email: auth.user.email ?? "",
    },
    authorized: true,
  });
}
