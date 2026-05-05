import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { RealtimeProvider } from "@/components/providers/RealtimeProvider";
import { AuthProvider } from "@/contexts/AuthContext";
import { ToastProvider } from "@/components/providers/ToastProvider";
import { IncidentRecorderProvider } from "@/contexts/IncidentRecorderContext";
import { Suspense } from "react";

const inter = Inter({ subsets: ["latin"] });

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
    <html lang="es" className="h-full">
      <body className={`${inter.className} h-full m-0 p-0 overflow-hidden`}>
        <AuthProvider>
          <Suspense>
            <IncidentRecorderProvider>
              <RealtimeProvider escenarioId={1000}>
                {children}
              </RealtimeProvider>
            </IncidentRecorderProvider>
          </Suspense>
        </AuthProvider>
        <ToastProvider />
      </body>
    </html>
  );
}
