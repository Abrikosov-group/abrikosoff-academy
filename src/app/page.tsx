export default function Home() {
  return (
    <main className="landing">
      <div className="ambient ambient-top" aria-hidden="true" />
      <div className="ambient ambient-bottom" aria-hidden="true" />

      <div className="landing-content">
        <header className="brand-row">
          <p className="brand">Академия Абрикософф</p>
          <p className="launch-status">
            <span aria-hidden="true" />
            Готовим запуск
          </p>
        </header>

        <section className="hero" aria-labelledby="hero-title">
          <p className="eyebrow">Современная образовательная платформа</p>
          <h1 id="hero-title">Знания, которые становятся частью жизни.</h1>
          <p className="lead">
            Здесь появятся курсы, личный кабинет и удобный доступ к материалам
            Академии.
          </p>
        </section>

        <section className="course-card" aria-labelledby="first-course">
          <div>
            <p className="course-label">Первая программа</p>
            <h2 id="first-course">
              Здоровые привычки: система на каждый день
            </h2>
          </div>
          <p className="course-note">Тексты · практики · последовательный путь</p>
        </section>

        <footer>
          <p>academy.abrikosoff.com</p>
          <p>© {new Date().getFullYear()} Abrikosoff</p>
        </footer>
      </div>
    </main>
  );
}
