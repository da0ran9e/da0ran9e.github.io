import { Cpu, Gamepad2, MessagesSquare, Network } from "lucide-react";

const iconMap = {
  "sensor-grid": Cpu,
  "routing-mesh": Network,
  "packet-flow": MessagesSquare,
  "tile-world": Gamepad2,
};

export default function ProjectVisual({ type, title }) {
  const Icon = iconMap[type] || Network;

  return (
    <div className={`project-visual project-visual-${type}`} aria-label={`${title} visual`}>
      <div className="visual-grid" />
      <div className="visual-orbit visual-orbit-a" />
      <div className="visual-orbit visual-orbit-b" />
      <Icon size={44} strokeWidth={1.4} />
    </div>
  );
}
