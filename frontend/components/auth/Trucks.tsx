/**
 * Two J&T lorries, for the login page.  A hand-drawn SVG in the spirit of
 * jtexpress.my's photo - nothing is copied from J&T's site.
 */

function Lorry({ id }: { id: string }) {
  return (
    <g>
      {/* trailer */}
      <rect x="0" y="0" width="252" height="150" rx="6" fill={`url(#${id}-trailer)`} stroke="#d4d5da" />
      <path d="M0 150V104C64 132 150 86 252 22V150Z" fill={`url(#${id}-red)`} />
      <path d="M0 104C64 132 150 86 252 22" stroke="#ffffff" strokeWidth="5" fill="none" opacity="0.85" />
      <text
        x="18"
        y="64"
        fill="#e60012"
        fontSize="34"
        fontStyle="italic"
        fontWeight="900"
        fontFamily="Arial Black, Arial, sans-serif"
        letterSpacing="-1.5"
      >
        J&amp;T
      </text>
      <text
        x="96"
        y="62"
        fill="#e60012"
        fontSize="15"
        fontStyle="italic"
        fontWeight="700"
        fontFamily="Arial, sans-serif"
      >
        EXPRESS
      </text>
      {/* chassis and side guard */}
      <rect x="-4" y="148" width="372" height="14" rx="3" fill="#3b3b3f" />
      <rect x="132" y="150" width="118" height="9" rx="2" fill="#c9cacf" />
      {/* cab */}
      <path d="M258 18H324Q346 18 353 44L362 88V150H258Z" fill={`url(#${id}-cab)`} />
      <path d="M300 30H321Q335 30 340 48L346 80H300Z" fill="#27313d" />
      <path d="M304 34H318Q328 34 332 46L304 74Z" fill="#ffffff" opacity="0.18" />
      <rect x="267" y="32" width="26" height="42" rx="3" fill="#27313d" />
      <line x1="296" y1="28" x2="296" y2="148" stroke="#9f000c" strokeWidth="2" />
      <rect x="350" y="38" width="7" height="22" rx="2" fill="#1f1f22" />
      <rect x="344" y="108" width="20" height="40" rx="2" fill="#2e2e33" />
      <path d="M346 114h16M346 122h16M346 130h16M346 138h16" stroke="#6b6b73" strokeWidth="2" />
      <rect x="351" y="94" width="11" height="8" rx="2" fill="#ffe6a3" />
      <text
        x="304"
        y="112"
        fill="#ffffff"
        fontSize="13"
        fontStyle="italic"
        fontWeight="900"
        fontFamily="Arial Black, Arial, sans-serif"
      >
        J&amp;T
      </text>
      {/* wheels */}
      {[58, 100, 302].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="170" r="20" fill="#1c1c1f" />
          <circle cx={cx} cy="170" r="9" fill="#a3a4aa" />
          <circle cx={cx} cy="170" r="3" fill="#55565c" />
        </g>
      ))}
    </g>
  );
}

export function Trucks({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 640 330" className={className} role="img" aria-label="J&T Express lorries">
      <defs>
        {['back', 'front'].map((id) => (
          <g key={id}>
            <linearGradient id={`${id}-trailer`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="1" stopColor="#e3e4e8" />
            </linearGradient>
            <linearGradient id={`${id}-red`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#c9000f" />
              <stop offset="1" stopColor="#f0232c" />
            </linearGradient>
            <linearGradient id={`${id}-cab`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#f43038" />
              <stop offset="1" stopColor="#b3000e" />
            </linearGradient>
          </g>
        ))}
      </defs>
      <ellipse cx="330" cy="298" rx="300" ry="16" fill="#000000" opacity="0.09" />
      <g transform="translate(250 40) scale(0.86)" opacity="0.96">
        <Lorry id="back" />
      </g>
      <g transform="translate(40 100)">
        <Lorry id="front" />
      </g>
    </svg>
  );
}
