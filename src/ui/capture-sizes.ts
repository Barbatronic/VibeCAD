/** Tailles proposées pour les images et les vidéos rendues (pixels). */
export const CAPTURE_SIZES: readonly { label: string; width: number; height: number }[] = [
  { label: '1280 × 720', width: 1280, height: 720 },
  { label: '1920 × 1080', width: 1920, height: 1080 },
  { label: '3840 × 2160 (4K)', width: 3840, height: 2160 },
  { label: '1080 × 1080 (carré)', width: 1080, height: 1080 },
  { label: '1080 × 1920 (vertical)', width: 1080, height: 1920 },
];
