import type { Metadata } from "next";
import { Inter, Fira_Sans, Fira_Code } from "next/font/google";
import "./globals.css";
import { RealtimeProvider } from "@/components/providers/RealtimeProvider";
import { AuthProvider } from "@/contexts/AuthContext";
import { ToastProvider } from "@/components/providers/ToastProvider";
import { AuditProvider } from "@/components/providers/AuditProvider";
import { IncidentRecorderProvider } from "@/contexts/IncidentRecorderContext";
import { Suspense } from "react";

const inter = Inter({ subsets: ["latin"] });

// Fonts del design system "Stats" (skill ui-ux-pro-max): Fira Sans para body
// y Fira Code para tabulares (KPIs, charts, números que necesitan no "bailar").
// Expuestos como CSS variables para que globals.css los consuma como font tokens.
const firaSans = Fira_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-stats-sans-base",
  display: "swap",
});
const firaCode = Fira_Code({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-stats-mono-base",
  display: "swap",
});

export const metadata: Metadata = {
  title: "TrackMovil - Rastreo en Tiempo Real",
  description: "Sistema de rastreo vehicular en tiempo real con OpenStreetMap",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={`h-full ${firaSans.variable} ${firaCode.variable}`}>
      <body className={`${inter.className} h-full m-0 p-0 overflow-hidden`}>
        <AuthProvider>
          <Suspense>
            <AuditProvider>
              <IncidentRecorderProvider>
                <RealtimeProvider escenarioId={1000}>
                  {children}
                </RealtimeProvider>
              </IncidentRecorderProvider>
            </AuditProvider>
          </Suspense>
        </AuthProvider>
        <ToastProvider />
      </body>
    </html>
  );
}
