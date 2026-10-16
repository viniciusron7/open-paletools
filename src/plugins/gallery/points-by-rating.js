/**
 * Frozen rating -> points table `galleryPointsByRating` (ratings 45 to 99), used by
 * gallery-grading.js as the fallback card score when an item has no `gradingScore`, and shown by
 * gallery-view.js as the rating reference table.
 *
 * Invariants:
 * - Keys are integer-like, so `Object.entries` lists them in ascending order; `GalleryView`
 *   reverses that to show 99 first.
 * - A rating missing from the table scores 0 and is flagged as estimated by
 *   `getGalleryItemScore`.
 */
export const galleryPointsByRating = Object.freeze({
  99: 100000,
  98: 90000,
  97: 85000,
  96: 55000,
  95: 40000,
  94: 30000,
  93: 25000,
  92: 20000,
  91: 19000,
  90: 14000,
  89: 11000,
  88: 8300,
  87: 5500,
  86: 4100,
  85: 2100,
  84: 830,
  83: 410,
  82: 340,
  81: 280,
  80: 180,
  79: 160,
  78: 140,
  77: 120,
  76: 100,
  75: 90,
  74: 35,
  73: 35,
  72: 35,
  71: 35,
  70: 35,
  69: 35,
  68: 35,
  67: 35,
  66: 35,
  65: 35,
  64: 20,
  63: 20,
  62: 20,
  61: 20,
  60: 20,
  59: 20,
  58: 20,
  57: 20,
  56: 20,
  55: 20,
  54: 20,
  53: 20,
  52: 20,
  51: 20,
  50: 20,
  49: 20,
  48: 20,
  47: 20,
  46: 20,
  45: 20,
});
