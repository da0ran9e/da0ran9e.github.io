import { ArrowUpRight } from "lucide-react";
import { navItems, profile } from "@/lib/portfolio-data";
import ThemeToggle from "./ThemeToggle";

export default function Header() {
  return (
    <header className="site-header">
      <a className="brand" href="#home" aria-label="Vu Duc An home">
        <span className="brand-mark">{profile.mark}</span>
        <span className="brand-text">{profile.name}</span>
      </a>
      <nav className="top-nav" aria-label="Primary navigation">
        {navItems.map((item) => (
          <a href={item.href} key={item.href}>
            {item.label}
          </a>
        ))}
      </nav>
      <div className="header-actions">
        <ThemeToggle />
        <a className="header-cta" href={`mailto:${profile.email}`}>
          Email <ArrowUpRight size={15} strokeWidth={2} />
        </a>
      </div>
    </header>
  );
}
