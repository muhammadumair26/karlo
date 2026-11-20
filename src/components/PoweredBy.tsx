/** "Powered by Orion Soft Sol" — logo on a white pill so it reads on dark and light backgrounds (same as Orion Souq). */
export function PoweredBy({ compact = false, onDark = false, className = '' }: { compact?: boolean; onDark?: boolean; className?: string }) {
  return (
    <a
      className={`powered-by ${compact ? 'compact' : ''} ${onDark ? 'on-dark' : ''} ${className}`}
      href="https://orionsoftsol.com"
      target="_blank"
      rel="noopener"
      aria-label="Powered by Orion Soft Sol"
    >
      <span className="pb-label">POWERED BY</span>
      <span className="pb-pill">
        <img src={`${import.meta.env.BASE_URL}orion-logo.png`} alt="" />
        <span className="pb-name">
          Orion <em>Soft Sol</em>
        </span>
      </span>
    </a>
  );
}
