export default function TableToolbar({
  search,
  onSearchChange,
  placeholder = "Suchen...",
  right = null,
  className = "",
  style,
}) {
  return (
    <div className={`toolbar ${className}`.trim()} style={style}>
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
