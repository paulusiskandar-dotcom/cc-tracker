export default function AutoDetectBadge({ confidence, matchedBy, style }) {
  if (!confidence) return null;
  const cfgMap = {
    high:   { color: '#0F6E56', bg: '#E1F5EE', text: '✨ Auto-detected' },
    medium: { color: '#854F0B', bg: '#FAEEDA', text: '✨ Auto-detected' },
    low:    { color: '#5F5E5A', bg: '#F1EFE8', text: '✨ Suggested'     },
  };
  const cfg = cfgMap[confidence];
  if (!cfg) return null;
  const tips = {
    high:   'High confidence match',
    medium: 'Medium confidence — verify',
    low:    'Low confidence — please verify',
  };
  const tooltip = `${tips[confidence]}\nMatched by: ${(matchedBy || []).join(', ')}`;
  return (
    <span title={tooltip} style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 8px', background: cfg.bg, color: cfg.color,
      borderRadius: 4, fontSize: 11, fontWeight: 500,
      fontFamily: 'Figtree, sans-serif', whiteSpace: 'nowrap',
      cursor: 'default', ...style,
    }}>
      {cfg.text}
    </span>
  );
}
