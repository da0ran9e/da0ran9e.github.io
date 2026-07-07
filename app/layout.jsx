import "./globals.css";

export const metadata = {
  title: "Vu Duc An - Portfolio",
  description:
    "Portfolio of Vu Duc An, a Computer Science master's student and Research Assistant at HUST focused on network protocol design, SDN, IoT communications, and software development.",
  metadataBase: new URL("https://vuducan.qzz.io"),
  openGraph: {
    title: "Vu Duc An - Portfolio",
    description:
      "Research Assistant at HUST working on network protocols, Software-Defined Networking, IoT communications, and software development.",
    url: "https://vuducan.qzz.io",
    siteName: "Vu Duc An Portfolio",
    type: "website",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/devicon.min.css"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
