import {
  ArrowDown,
  ArrowUpRight,
  BookOpenText,
  Layers3,
  Mail,
  Network,
  RadioTower,
  Sparkles,
} from "lucide-react";
import FloatingDock from "@/components/FloatingDock";
import Header from "@/components/Header";
import LogoBadge from "@/components/LogoBadge";
import NetworkField from "@/components/NetworkField";
import ProjectVisual from "@/components/ProjectVisual";
import SmoothScroll from "@/components/SmoothScroll";
import {
  apps,
  education,
  experience,
  profile,
  projects,
  publications,
  skills,
} from "@/lib/portfolio-data";

const external = (href) => href.startsWith("http");

function SectionIntro({ kicker, title, text }) {
  return (
    <div className="section-intro" data-reveal>
      <span className="section-kicker">{kicker}</span>
      <h2>{title}</h2>
      {text ? <p>{text}</p> : null}
    </div>
  );
}

function TagList({ items }) {
  return (
    <div className="tag-list">
      {items.map((item) => (
        <span key={item}>{item}</span>
      ))}
    </div>
  );
}

export default function HomePage() {
  return (
    <>
      <SmoothScroll />
      <Header />
      <FloatingDock />
      <div className="scroll-rail" aria-hidden="true">
        <span />
      </div>
      <main id="home">
        <section className="hero-shell" aria-labelledby="hero-title">
          <div className="hero-bg-layer">
            <NetworkField />
          </div>
          <div className="hero-content">
            <div className="hero-copy" data-reveal>
              <span className="eyebrow">
                <RadioTower size={16} strokeWidth={1.8} />
                {profile.title}
              </span>
              <h1 id="hero-title" aria-label="Network systems, IoT research, and software craft.">
                <span className="desktop-headline" aria-hidden="true">
                  <span className="headline-line">Network systems,</span>
                  <span className="headline-line headline-accent">IoT research,</span>
                  <span className="headline-line">and software craft.</span>
                </span>
                <span className="mobile-headline" aria-hidden="true">
                  <span className="headline-line">Network</span>
                  <span className="headline-line headline-accent">IoT research</span>
                  <span className="headline-line">Software</span>
                </span>
              </h1>
              <p>{profile.intro}</p>
              <div className="hero-actions">
                <a className="primary-link" href="#projects">
                  View work <ArrowDown size={17} strokeWidth={2} />
                </a>
                <a className="ghost-link" href={`mailto:${profile.email}`}>
                  Contact <Mail size={17} strokeWidth={2} />
                </a>
              </div>
            </div>
            <aside className="hero-panel" data-reveal style={{ "--delay": "120ms" }}>
              <div className="panel-header">
                <span>Current Focus</span>
                <Sparkles size={17} strokeWidth={1.8} />
              </div>
              <div className="focus-stack">
                {profile.researchAreas.map((area, index) => (
                  <span style={{ "--i": index }} key={area}>
                    {area}
                  </span>
                ))}
              </div>
            </aside>
          </div>
        </section>

        <section id="profile" className="content-section profile-section">
          <div className="section-grid">
            <SectionIntro
              kicker="Profile"
              title="Research-led engineering with a systems mindset."
              text={profile.about}
            />
            <div className="profile-metrics" data-reveal>
              <div>
                <span>2023</span>
                <p>Research assistant work started at HUST</p>
              </div>
              <div>
                <span>2</span>
                <p>Academic submissions currently listed</p>
              </div>
              <div>
                <span>22</span>
                <p>Technical skills across networking and software</p>
              </div>
            </div>
          </div>
        </section>

        <section id="research" className="content-section layered-section">
          <SectionIntro
            kicker="Research"
            title="Education and publications"
            text="The portfolio keeps academic context close to the research work, so readers can understand both the current path and the technical direction."
          />
          <div className="split-layer">
            <div className="sticky-label" data-reveal>
              <BookOpenText size={22} strokeWidth={1.8} />
              <span>Academic track</span>
            </div>
            <div className="stacked-list">
              <div className="list-cluster" data-reveal>
                <h3>Education</h3>
                {education.map((item) => (
                  <article className="timeline-card" key={`${item.degree}-${item.period}`}>
                    <div>
                      <h4>{item.degree}</h4>
                      <p>{item.school}</p>
                    </div>
                    <span>{item.period}</span>
                  </article>
                ))}
              </div>
              <div id="publications" className="list-cluster" data-reveal>
                <h3>Academic Publications</h3>
                {publications.map((paper) => (
                  <article className="publication-card" key={paper.title}>
                    <div>
                      <span>{paper.venue}</span>
                      <strong>{paper.status}</strong>
                    </div>
                    <h4>{paper.title}</h4>
                    <p>{paper.authors}</p>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="work" className="content-section layered-section">
          <SectionIntro
            kicker="Experience"
            title="Work across research, game development, and software tooling"
            text="The experience layer is structured as a compact timeline, with each role showing the organization, period, and the technical work behind it."
          />
          <div className="experience-lane">
            {experience.map((item, index) => (
              <article className="experience-card" data-reveal style={{ "--delay": `${index * 70}ms` }} key={item.role}>
                <LogoBadge src={item.logo} alt={`${item.company} logo`} fallback={item.fallback} />
                <div>
                  <div className="card-title-row">
                    <h3>{item.role}</h3>
                    <span>{item.period}</span>
                  </div>
                  <p className="muted">{item.company}</p>
                  <p>{item.summary}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="content-section skills-section">
          <SectionIntro
            kicker="Skills"
            title="A toolkit shaped by networks and product work"
            text="Core programming, embedded systems, networking, backend development, databases, and analysis tools."
          />
          <div className="skills-cloud" data-reveal>
            {skills.map((skill, index) => (
              <span className="skill-chip" style={{ "--i": index }} key={skill.name}>
                {skill.icon ? <i className={skill.icon} aria-hidden="true" /> : null}
                {skill.name}
              </span>
            ))}
          </div>
        </section>

        <section id="projects" className="content-section projects-section">
          <SectionIntro
            kicker="Projects"
            title="Selected technical projects"
            text="A focused set of research and engineering projects connected to IoT, networking, TCP/IP, and systems-oriented software."
          />
          <div className="project-grid">
            {projects.map((project, index) => (
              <a
                className="project-card"
                data-reveal
                style={{ "--delay": `${index * 80}ms` }}
                href={project.href}
                target="_blank"
                rel="noopener noreferrer"
                key={project.title}
              >
                <ProjectVisual type={project.visual} title={project.title} />
                <div className="project-body">
                  <div className="card-title-row">
                    <span className="project-category">{project.category}</span>
                    <ArrowUpRight size={18} strokeWidth={1.8} />
                  </div>
                  <h3>{project.title}</h3>
                  <p>{project.summary}</p>
                  <TagList items={project.tags} />
                </div>
              </a>
            ))}
          </div>
        </section>

        <section id="apps" className="content-section apps-section">
          <SectionIntro
            kicker="Apps"
            title="Interactive apps and visual experiments"
            text="These side projects keep the portfolio connected to 3D, simulation, WebGL, map rendering, and real-time interaction."
          />
          <div className="apps-marquee" data-reveal>
            {apps.map((app, index) => (
              <a
                className="app-tile"
                style={{ "--i": index }}
                href={app.href}
                target={external(app.href) ? "_blank" : undefined}
                rel={external(app.href) ? "noopener noreferrer" : undefined}
                key={app.title}
              >
                <span>{app.stack}</span>
                <h3>{app.title}</h3>
                <p>{app.summary}</p>
                <ArrowUpRight size={17} strokeWidth={1.8} />
              </a>
            ))}
          </div>
        </section>

        <section id="contact" className="contact-section">
          <div className="contact-layer" data-reveal>
            <Layers3 size={24} strokeWidth={1.7} />
            <span>{profile.domain}</span>
            <h2>Let&apos;s build systems that are clear, measurable, and useful.</h2>
            <p>
              I am open to discussing network research, IoT, SDN, software engineering, and suitable
              research or internship opportunities.
            </p>
            <a className="primary-link" href={`mailto:${profile.email}`}>
              {profile.email} <ArrowUpRight size={17} strokeWidth={2} />
            </a>
          </div>
        </section>
      </main>
    </>
  );
}
