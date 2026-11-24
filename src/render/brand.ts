// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

// The trazo marks: the header symbol is the brand kit's trazo-symbol-small.svg geometry (the kit
// stays outside the repo; below 48 px the guide asks for the small symbol), recolored for dark
// themes; the favicon comes from the same kit. Keep them in sync when the brand changes.
// The READMEs keep the horizontal logos in docs/logo.

/** Symbol-small for light backgrounds, shown at 24 px: ink #1f2933 and node #2f6fdb. */
export const LOGO_LIGHT =
  '<svg class="logo logo-light" viewBox="0 0 256 256" height="24" width="24" aria-hidden="true"><g transform="translate(-2,10)"><path d="M68,34 a18,18 0 0 1 36,0 V140 a18,18 0 0 0 18,18 H148 V194 H122 a54,54 0 0 1 -54,-54 Z" fill="#1f2933"/><rect x="32" y="74" width="122" height="36" rx="18" fill="#1f2933"/><rect x="148" y="136" width="80" height="80" rx="16" fill="#2f6fdb"/></g></svg>';

/** The same symbol-small recolored for dark backgrounds: white ink and node #6ea2f5 (as the favicon). */
export const LOGO_DARK =
  '<svg class="logo logo-dark" viewBox="0 0 256 256" height="24" width="24" aria-hidden="true"><g transform="translate(-2,10)"><path d="M68,34 a18,18 0 0 1 36,0 V140 a18,18 0 0 0 18,18 H148 V194 H122 a54,54 0 0 1 -54,-54 Z" fill="#ffffff"/><rect x="32" y="74" width="122" height="36" rx="18" fill="#ffffff"/><rect x="148" y="136" width="80" height="80" rx="16" fill="#6ea2f5"/></g></svg>';

/** Favicon; it switches to the light mark when the browser is in dark mode. */
export const FAVICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256"><style>@media (prefers-color-scheme: dark){.t{fill:#ffffff}.n{fill:#6ea2f5}}</style><g transform="translate(-29.31 -26.85) scale(1.229)"><g transform="translate(-2,10)"><path d="M68,34 a18,18 0 0 1 36,0 V140 a18,18 0 0 0 18,18 H148 V194 H122 a54,54 0 0 1 -54,-54 Z" class="t" fill="#1f2933"/><rect x="32" y="74" width="122" height="36" rx="18" class="t" fill="#1f2933"/><rect x="148" y="136" width="80" height="80" rx="16" class="n" fill="#2f6fdb"/></g></g></svg>';
