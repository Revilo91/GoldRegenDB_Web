export default function TableToolbar({
  search,
  onSearchChange,
  placeholder = "Suchen...",
  right = null,
  className = "",
}) {
  return (
    <div className={`toolbar ${className}`.trim()}>
      <input
        className="form-control search-input"
        placeholder={placeholder}
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
      />
      {right}
    </div>
  );
}
