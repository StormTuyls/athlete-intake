"use client";

import { useEffect } from "react";

/**
 * Opent het printdialoog zodra de pagina staat.
 *
 * De link naar deze route werkt ook zonder JavaScript: dan krijgt de coach het
 * rapport te zien en print hij het zelf. Het dialoog is de verbetering, niet de
 * voorwaarde.
 */
export function AutoPrint() {
  useEffect(() => {
    // Eén frame wachten, anders vuurt het dialoog voordat de webfonts en de
    // printregels toegepast zijn en staat de eerste pagina scheef.
    const id = requestAnimationFrame(() => window.print());
    return () => cancelAnimationFrame(id);
  }, []);

  return null;
}
