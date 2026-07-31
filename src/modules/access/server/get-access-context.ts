import "server-only";

import { getDatabasePool } from "@/lib/database";
import { getCurrentUser } from "@/modules/identity/server/session";
import { readStudentCourseAccess } from "./read-student-course-access";

export async function getAccessContext() {
  const user = await getCurrentUser();

  if (!user) {
    return {
      user: null,
      subscription: null,
      canReadCourses: false,
    };
  }

  const { subscription, canReadCourses } = await readStudentCourseAccess(
    getDatabasePool(),
    user.id,
  );

  return {
    user,
    subscription,
    canReadCourses,
  };
}
