import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OIStexas — Texas Hold'em with friends",
  description: "Free multiplayer Texas Hold'em with virtual chips. Private tables with friends or three levels of AI.",
};
export const viewport: Viewport = { themeColor: "#0d1110", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
