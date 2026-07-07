import {
  BriefcaseBusiness,
  Cpu,
  GraduationCap,
  Home,
  Mail,
  PanelsTopLeft,
  ScrollText,
} from "lucide-react";

const dockItems = [
  { label: "Home", href: "#home", icon: Home },
  { label: "Research", href: "#research", icon: GraduationCap },
  { label: "Work", href: "#work", icon: BriefcaseBusiness },
  { label: "Projects", href: "#projects", icon: Cpu },
  { label: "Apps", href: "#apps", icon: PanelsTopLeft },
  { label: "Contact", href: "#contact", icon: Mail },
];

export default function FloatingDock() {
  return (
    <nav className="floating-dock" aria-label="Quick navigation">
      {dockItems.map((item) => {
        const Icon = item.icon;
        return (
          <a href={item.href} aria-label={item.label} title={item.label} key={item.href}>
            <Icon size={19} strokeWidth={1.8} />
          </a>
        );
      })}
      <a href="#publications" aria-label="Publications" title="Publications">
        <ScrollText size={19} strokeWidth={1.8} />
      </a>
    </nav>
  );
}
