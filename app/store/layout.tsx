import type { ReactNode } from "react";
import "./store.css";
import { PageTools, TelegramInit } from "./shared";

export const viewport = { width: "device-width", initialScale: 1, maximumScale: 5, userScalable: true };

export default function StoreLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" precedence="default" />
      <TelegramInit />
      <PageTools />
      {children}
    </>
  );
}
