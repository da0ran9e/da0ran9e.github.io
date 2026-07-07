const nodes = [
  { x: 9, y: 26, size: "s", label: "IoT" },
  { x: 22, y: 68, size: "m", label: "WSN" },
  { x: 36, y: 39, size: "s", label: "TCP" },
  { x: 52, y: 20, size: "l", label: "SDN" },
  { x: 63, y: 58, size: "s", label: "MQTT" },
  { x: 78, y: 32, size: "m", label: "HUST" },
  { x: 88, y: 72, size: "s", label: "SIM" },
];

export default function NetworkField() {
  return (
    <div className="network-field" aria-hidden="true">
      <div className="mesh-plane" />
      <div className="signal-line signal-line-one" />
      <div className="signal-line signal-line-two" />
      <div className="signal-line signal-line-three" />
      {nodes.map((node, index) => (
        <span
          className={`network-node network-node-${node.size}`}
          style={{ "--x": `${node.x}%`, "--y": `${node.y}%`, "--delay": `${index * 0.4}s` }}
          key={node.label}
        >
          <span>{node.label}</span>
        </span>
      ))}
    </div>
  );
}
