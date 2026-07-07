export const profile = {
  name: "Vu Duc An",
  mark: "VA",
  title: "Research Assistant at HUST",
  location: "Hanoi, Vietnam",
  email: "vuducan.2502.emp@gmail.com",
  domain: "vuducan.qzz.io",
  intro:
    "Computer Science master's student and Research Assistant focused on network protocol design, Software-Defined Networking, IoT communication systems, and practical software engineering.",
  about:
    "I work close to the networking layer, where systems need to be measurable, resilient, and clear enough to debug under real constraints. My current research explores wireless sensor networks, SDN-based architectures, IoT communications, and simulation-based performance evaluation. Alongside research, I build software tools, embedded prototypes, and interactive web experiments that turn technical ideas into usable systems.",
  researchAreas: [
    "Network protocol design",
    "Software-Defined Networking",
    "IoT communication systems",
    "Wireless sensor networks",
    "Simulation and performance evaluation",
  ],
  links: [
    { label: "GitHub", href: "https://github.com/da0ran9e" },
    { label: "Email", href: "mailto:vuducan.2502.emp@gmail.com" },
  ],
};

export const navItems = [
  { label: "Profile", href: "#profile" },
  { label: "Research", href: "#research" },
  { label: "Work", href: "#work" },
  { label: "Projects", href: "#projects" },
  { label: "Apps", href: "#apps" },
  { label: "Contact", href: "#contact" },
];

export const education = [
  {
    degree: "Master of Science in Computer Science",
    school: "Hanoi University of Science and Technology",
    period: "Present",
  },
  {
    degree: "Bachelor's Degree in Information and Communication Technology",
    school: "School of Information and Communications Technology, HUST",
    period: "2021 - 2025",
  },
];

export const experience = [
  {
    role: "Research Assistant",
    company: "Hanoi University of Science and Technology",
    period: "2023 - Present",
    logo: "https://hust.edu.vn/uploads/sys/logo-dhbk-1-02_130_191.png",
    fallback: "HU",
    summary:
      "Assist research on network protocol design, SDN-based architectures, IoT communication systems, and simulation-based performance evaluation.",
  },
  {
    role: "Game Developer Intern",
    company: "GAMELOFT Hanoi (HAN-Studio)",
    period: "Mar - May 2024",
    logo: "https://www.google.com/s2/favicons?sz=64&domain=gameloft.com",
    fallback: "GL",
    summary:
      "Completed training in game development workflows, C/C++ development, UI/UX practice, and team-based production.",
  },
  {
    role: "Software Developer Intern",
    company: "BRAVO Software Joint Stock Company",
    period: "Aug - Sep 2023",
    logo: "https://www.google.com/s2/favicons?sz=64&domain=bravo.com.vn",
    fallback: "BR",
    summary:
      "Built a Windows Forms C# desktop application integrating REST APIs, Python, and SQL Server.",
  },
];

export const publications = [
  {
    title:
      "An Elastic Clustering Framework for Large-Scale WSNs Maximizing Network Lifetime",
    venue: "IEEE WCNC 2026",
    authors: "Quan A. Le, An D. Vu, and Khanh-Van Nguyen",
    status: "Submitted",
  },
  {
    title:
      "Joint Fragment Dissemination and Edge Fusion for Fast Target Detection in UAV-Assisted Urban IoT",
    venue: "ICCE 2026",
    authors: "An D. Vu and Khanh-Van Nguyen",
    status: "Submitted",
  },
];

export const skills = [
  { name: "C", icon: "devicon-c-plain" },
  { name: "C++", icon: "devicon-cplusplus-plain" },
  { name: "C Embedded" },
  { name: "C#", icon: "devicon-csharp-plain" },
  { name: "Java", icon: "devicon-java-plain" },
  { name: "Python", icon: "devicon-python-plain" },
  { name: ".NET", icon: "devicon-dotnetcore-plain" },
  { name: "ASP.NET", icon: "devicon-dotnetcore-plain" },
  { name: "REST APIs" },
  { name: "Windows Forms", icon: "devicon-windows8-original" },
  { name: "Django", icon: "devicon-django-plain" },
  { name: "Svelte", icon: "devicon-svelte-plain" },
  { name: "Arduino", icon: "devicon-arduino-plain" },
  { name: "ESP8266" },
  { name: "MQTT" },
  { name: "TCP/IP" },
  { name: "Sockets" },
  { name: "Wireless Sensor Networks" },
  { name: "SDN" },
  { name: "SQL Server", icon: "devicon-microsoftsqlserver-plain" },
  { name: "PostgreSQL", icon: "devicon-postgresql-plain" },
  { name: "Pandas", icon: "devicon-pandas-plain" },
];

export const projects = [
  {
    title: "Smart Terrarium/Garden IoT Project",
    href: "https://github.com/da0ran9e/Smart-Terrarium-IoT-Project",
    category: "Embedded IoT",
    visual: "sensor-grid",
    summary:
      "An IoT automation system that uses soil moisture, temperature, and humidity data to control pumps and fans.",
    tags: ["ESP8266", "MQTT", "Arduino"],
  },
  {
    title: "IoT Wireless Sensor Network Protocol Research",
    href: "https://github.com/da0ran9e/Net-Formation",
    category: "Network Research",
    visual: "routing-mesh",
    summary:
      "A routing-layer protocol for large-scale WSNs, focused on network formation and communication efficiency.",
    tags: ["WSN", "Routing", "C"],
  },
  {
    title: "TCP/IP Chat Application",
    href: "https://github.com/da0ran9e/Chat-Application",
    category: "Network Software",
    visual: "packet-flow",
    summary:
      "A multithreaded TCP/IP chat application that supports concurrent client communication.",
    tags: ["TCP/IP", "Sockets", "Threads"],
  },
  {
    title: "Dig It Up - 2D Top-Down Survival Game",
    href: "https://github.com/da0ran9e/Dig-It-Up-2D-Topdown",
    category: "Game Development",
    visual: "tile-world",
    summary:
      "A 2D open-world survival game built with SDL2, applying software design, UI/UX, and project management practices.",
    tags: ["C++", "SDL2", "Game"],
  },
];

export const apps = [
  {
    title: "Demo 3D - Three.js",
    href: "https://next-js-vcuc.onrender.com",
    stack: "Next.js / Render",
    summary:
      "A Next.js server-rendered page on Render showing a real-time rotating Three.js 3D model.",
  },
  {
    title: "Studio - Swiss / WebGL",
    href: "/studio/",
    stack: "Three.js / Static",
    summary:
      "A Swiss-style portfolio page with grid systems, animated WebGL geometry, and images loaded from Supabase.",
  },
  {
    title: "Gravity Box - Physics",
    href: "/box/",
    stack: "Three.js / Cannon",
    summary:
      "A gravity simulation where cubes drop into a box, with each face showing a random album image.",
  },
  {
    title: "Basketball Court - glTF",
    href: "/court/",
    stack: "Three.js / GLB",
    summary:
      "A real-time 3D basketball court scene with a game-ready glTF model, lighting, shadows, orbit controls, and PBR reflections.",
  },
  {
    title: "Pink Stage - Showcase",
    href: "/stage/",
    stack: "Three.js / GLB",
    summary:
      "A pink product-showcase stage combining a podium, two figures, and a rear canvas with studio lighting and shadows.",
  },
  {
    title: "Terrain Map - Procedural",
    href: "/map/",
    stack: "Three.js / Shader",
    summary:
      "A procedural terrain map with infinite panning and zoom-dependent elevation, built without texture assets.",
  },
  {
    title: "Earth Globe - NASA",
    href: "/globe/",
    stack: "Three.js / Globe",
    summary:
      "An Earth globe using NASA Blue Marble imagery, with rotation, zoom, elevation detail, atmosphere, and a star field.",
  },
  {
    title: "Atlas - Map tiles + 3D",
    href: "/atlas/",
    stack: "MapLibre / OSM",
    summary:
      "A real map-tile viewer with street-level OSM tiles, DEM-based 3D terrain, tilt, rotation, and fly-to navigation.",
  },
  {
    title: "Capital Circuit - Boardgame 3D",
    href: "/apps/forge-circuit/",
    stack: "Three.js / Game",
    summary:
      "A 3D hot-seat property-trading board game with dice, purchases, rent, cards, taxes, and jail logic.",
  },
];
