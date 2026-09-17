/** Inaaya Store's name and wordmark, used on every page of the portal. */

export const STORE_NAME = 'Inaaya Store';
export const STORE_URL = 'https://inaayastore.com';
/** The ink colour of inaayastore.com. */
export const STORE_INK = '#030302';

// the gap clears the tail of the "y"
const SIZES = {
  sm: { word: 30, caption: 9, spacing: '0.42em', gap: 7 },
  md: { word: 40, caption: 11, spacing: '0.45em', gap: 9 },
  lg: { word: 76, caption: 17, spacing: '0.5em', gap: 17 },
};

/** "Inaaya" in a fine serif over small spaced capitals, as on the shop's sign. */
export function InaayaLogo({
  size = 'md',
  inverted = false,
  caption = 'Fabrics',
}: {
  size?: keyof typeof SIZES;
  inverted?: boolean;
  caption?: string;
}) {
  const s = SIZES[size];
  return (
    <span
      className={`inline-flex select-none flex-col items-center leading-none ${inverted ? 'text-white' : 'text-brand'}`}
      aria-label={STORE_NAME}
      role="img"
    >
      <span className="font-serif font-medium tracking-[0.01em]" style={{ fontSize: s.word }}>
        Inaaya
      </span>
      <span
        className="font-sans font-semibold uppercase"
        style={{ fontSize: s.caption, letterSpacing: s.spacing, marginTop: s.gap, paddingLeft: s.spacing }}
      >
        {caption}
      </span>
    </span>
  );
}
