import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

import "./globals.css";

const inter = localFont({
  src: "../public/fonts/inter-latin-wght-normal.woff2",
  display: "swap",
  variable: "--font-inter",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Wind Tunnel — SaaS pricing decisions",
  description:
    "A private, client-side studio for testing SaaS pricing and packaging assumptions before launch.",
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f2" },
    { media: "(prefers-color-scheme: dark)", color: "#101514" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <body className={inter.variable}>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var s=window.localStorage.getItem("wind-tunnel.scenario.v1");var t=s?JSON.parse(s).settings.theme:"system";if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}document.documentElement.dataset.theme=t;}catch(e){}`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
