import type { Metadata } from "next";
import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import {
  AdminStudentAccessSection,
  AdminStudentIdentitySection,
  AdminStudentOverview,
  AdminStudentSessionList,
  AdminStudentSummary,
} from "@/components/academy/admin-student-detail";
import { AdminStudentSectionNavigation } from "@/components/academy/admin-student-section-navigation";
import { normalizeAdminStudentsReturnTo } from "@/modules/administration/domain/student-presentation";
import { getAdminDisplayTimeZone } from "@/modules/administration/server/administration-config";
import { getAdministrationRuntime } from "@/modules/administration/server/get-administration-runtime";
import { requireAdminContext } from "@/modules/administration/server/require-admin-context";

export const metadata: Metadata = {
  title: "Карточка ученика — Администрирование",
};

type StudentDetailSearchParams = {
  returnTo?: string | string[];
};

export default async function AdminStudentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<StudentDetailSearchParams>;
}) {
  const [{ userId }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams,
  ]);
  const context = await requireAdminContext(
    "users.read",
    `/admin/students/${userId}`,
  );

  if (!context.permissions.has("access.read")) {
    forbidden();
  }

  const { studentReadService } = getAdministrationRuntime();
  const student = await studentReadService.findStudentDetail({
    userId,
    permissions: context.permissions,
  });

  if (!student) {
    notFound();
  }

  const displayTimeZone = getAdminDisplayTimeZone();
  const returnTo = normalizeAdminStudentsReturnTo(
    resolvedSearchParams.returnTo,
  );

  return (
    <>
      <Link className="admin-back-to-list" href={returnTo}>
        ← Все ученики
      </Link>
      <AdminStudentSummary
        displayTimeZone={displayTimeZone}
        student={student}
      />
      <AdminStudentSectionNavigation />
      <AdminStudentOverview
        displayTimeZone={displayTimeZone}
        student={student}
      />
      <AdminStudentAccessSection
        displayTimeZone={displayTimeZone}
        student={student}
      />
      <AdminStudentIdentitySection
        displayTimeZone={displayTimeZone}
        student={student}
      />
      <AdminStudentSessionList
        displayTimeZone={displayTimeZone}
        student={student}
      />
    </>
  );
}
