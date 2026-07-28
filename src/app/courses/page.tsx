import type { Metadata } from "next";
import { CourseCatalog } from "@/components/academy/course-catalog";
import { SiteFooter } from "@/components/academy/site-footer";
import { AuthenticatedSiteHeader } from "@/components/academy/authenticated-site-header";

export const metadata: Metadata = {
  title: "Курсы",
  description: "Каталог практических курсов Академии Абрикософф.",
};

export default function CoursesPage() {
  return (
    <main>
      <AuthenticatedSiteHeader />
      <section className="inner-page catalog-page">
        <div className="page-shell">
          <CourseCatalog />
        </div>
      </section>
      <SiteFooter />
    </main>
  );
}
