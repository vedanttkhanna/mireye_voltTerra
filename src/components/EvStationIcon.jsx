export default function EvStationIcon({ dcFast = false }) {
  return (
    <span className={`rider-station-icon ${dcFast ? 'dc-fast' : 'level-two'}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        <path d="M5 13.5 6.4 9.4A2 2 0 0 1 8.3 8h7.4a2 2 0 0 1 1.9 1.4l1.4 4.1" />
        <path d="M5 12.5h14a2 2 0 0 1 2 2V18H3v-3.5a2 2 0 0 1 2-2Z" />
        <path d="M5 18v1.5M19 18v1.5" />
        <circle cx="7" cy="15.2" r="1" />
        <circle cx="17" cy="15.2" r="1" />
        <path className="ev-glyph-bolt" d="m13.2 2-3 4.4h2.3l-.8 3.5 3.3-4.7h-2.2l.4-3.2Z" />
      </svg>
      <span>{dcFast ? '⚡' : 'L2'}</span>
    </span>
  );
}
