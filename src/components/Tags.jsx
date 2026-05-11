import { useState, useEffect, useMemo } from "react";
import { tagsApi } from "../api";
import { fmtIDR } from "../utils";
import { showToast } from "./shared/Card";

const FF = "Figtree, system-ui, -apple-system, sans-serif";

const TAG_TYPES = [
  { value: "trip",    label: "Trip",    icon: "✈️" },
  { value: "project", label: "Project", icon: "🛠️" },
  { value: "event",   label: "Event",   icon: "🎉" },
  { value: "other",   label: "Other",   icon: "📌" },
];

const TAG_COLORS = [
  "#3b5bdb", "#059669", "#d97706", "#dc2626",
  "#7c3aed", "#0891b2", "#ec4899", "#84cc16",
];

export default function Tags({ user, ledger }) {
  const [tags,     setTags]     = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [activeTab, setActiveTab] = useState("active");
  const [editTag,  setEditTag]  = useState(null); // null | "new" | tag object

  // Load tags
  const load = async (tab = activeTab) => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const opts = tab === "archived" ? { status: "archived" } : {};
      const data = await tagsApi.list(user.id, opts);
      setTags(data);
    } catch (err) {
      console.error("Failed to load tags:", err);
    }
    setLoading(false);
  };

  useEffect(() => { load(activeTab); }, [user?.id, activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Compute stats from ledger prop (no extra DB call)
  const tagStats = useMemo(() => {
    const stats = {};
    tags.forEach(t => {
      const linked = (ledger || []).filter(e => e.tag_id === t.id);
      stats[t.id] = {
        totalSpend: linked
          .filter(e => e.tx_type === "expense" || e.tx_type === "buy_asset")
          .reduce((s, e) => s + Number(e.amount_idr || 0), 0),
        transactionCount: linked.length,
      };
    });
    return stats;
  }, [tags, ledger]);

  const filteredTags = useMemo(() => {
    if (activeTab === "archived") return tags;
    return tags.filter(t => t.status === activeTab);
  }, [tags, activeTab]);

  const heroStats = useMemo(() => {
    let totalActive = 0, totalCompleted = 0, totalSpendAll = 0;
    tags.forEach(t => {
      totalSpendAll += tagStats[t.id]?.totalSpend || 0;
      if (t.status === "active")    totalActive++;
      else if (t.status === "completed") totalCompleted++;
    });
    return { totalActive, totalCompleted, totalSpendAll };
  }, [tags, tagStats]);

  const handleSave = async (tagData) => {
    try {
      if (editTag === "new") {
        await tagsApi.create(user.id, tagData);
        showToast(`✓ "${tagData.name}" created`);
      } else if (editTag?.id) {
        await tagsApi.update(editTag.id, tagData);
        showToast("Tag updated");
      }
      setEditTag(null);
      await load();
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const handleArchive = async (tag) => {
    if (!window.confirm(`Archive "${tag.name}"? It will no longer appear in transaction dropdowns.`)) return;
    try {
      await tagsApi.delete(tag.id);
      showToast(`"${tag.name}" archived`);
      await load();
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const handleComplete = async (tag) => {
    try {
      await tagsApi.update(tag.id, { status: "completed" });
      showToast(`"${tag.name}" marked complete`);
      await load();
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const handleReactivate = async (tag) => {
    try {
      await tagsApi.update(tag.id, { status: "active" });
      showToast(`"${tag.name}" reactivated`);
      await load();
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const TABS = [
    { key: "active",    label: "Active"    },
    { key: "completed", label: "Completed" },
    { key: "archived",  label: "Archived"  },
  ];

  return (
    <div style={{ padding: "24px 20px", fontFamily: FF, maxWidth: 1280, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 800, color: "#111827" }}>Tags</div>
          <div style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
            Group transactions for trips, projects, or events
          </div>
        </div>
        <button
          onClick={() => setEditTag("new")}
          style={{ padding: "10px 20px", background: "#111827", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, fontFamily: FF, cursor: "pointer" }}
        >+ New Tag</button>
      </div>

      {/* Hero KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24 }}>
        <KPICard label="Active"            value={String(heroStats.totalActive)}        color="#3b5bdb" />
        <KPICard label="Completed"         value={String(heroStats.totalCompleted)}      color="#059669" />
        <KPICard label="Total Tagged Spend" value={fmtIDR(heroStats.totalSpendAll)}      color="#111827" />
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid #e5e7eb" }}>
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: "10px 16px", border: "none", background: "transparent",
              fontSize: 13, fontWeight: 600, fontFamily: FF,
              color: activeTab === tab.key ? "#111827" : "#6b7280",
              borderBottom: `2px solid ${activeTab === tab.key ? "#111827" : "transparent"}`,
              cursor: "pointer",
            }}
          >{tab.label}</button>
        ))}
      </div>

      {/* Tag grid */}
      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: "#9ca3af" }}>Loading…</div>
      ) : filteredTags.length === 0 ? (
        <div style={{ padding: 60, textAlign: "center", color: "#9ca3af", background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 16 }}>
          {activeTab === "active"
            ? "No active tags. Create one to start tracking trips or projects!"
            : `No ${activeTab} tags.`}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
          {filteredTags.map(tag => (
            <TagCard
              key={tag.id}
              tag={tag}
              stats={tagStats[tag.id] || { totalSpend: 0, transactionCount: 0 }}
              onEdit={() => setEditTag(tag)}
              onArchive={() => handleArchive(tag)}
              onComplete={() => handleComplete(tag)}
              onReactivate={() => handleReactivate(tag)}
            />
          ))}
        </div>
      )}

      {/* Edit / Create modal */}
      {editTag && (
        <TagEditModal
          tag={editTag === "new" ? null : editTag}
          onClose={() => setEditTag(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

// ─── KPI CARD ─────────────────────────────────────────────────
function KPICard({ label, value, color }) {
  return (
    <div style={{ background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 16, padding: 16, borderTop: `3px solid ${color}` }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: "#111827", marginTop: 4 }}>{value}</div>
    </div>
  );
}

// ─── TAG CARD ─────────────────────────────────────────────────
function TagCard({ tag, stats, onEdit, onArchive, onComplete, onReactivate }) {
  const typeInfo = TAG_TYPES.find(t => t.value === tag.type) || TAG_TYPES[0];
  const dateRange = tag.start_date && tag.end_date
    ? `${tag.start_date} → ${tag.end_date}`
    : tag.start_date ? `From ${tag.start_date}` : null;

  return (
    <div style={{ background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 16, padding: 16, borderTop: `3px solid ${tag.color || "#3b5bdb"}`, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 16 }}>{tag.icon || typeInfo.icon}</span>
          <span style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>{tag.name}</span>
        </div>
        <span style={{ fontSize: 9, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5, background: "#f3f4f6", padding: "2px 6px", borderRadius: 4 }}>
          {typeInfo.label}
        </span>
      </div>

      {dateRange && (
        <div style={{ fontSize: 11, color: "#6b7280" }}>{dateRange}</div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 4 }}>
        <div>
          <div style={{ fontSize: 10, color: "#9ca3af", textTransform: "uppercase" }}>Total Spend</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#111827" }}>{fmtIDR(stats.totalSpend)}</div>
        </div>
        <div style={{ fontSize: 11, color: "#6b7280" }}>{stats.transactionCount} tx</div>
      </div>

      {tag.notes && (
        <div style={{ fontSize: 11, color: "#6b7280", fontStyle: "italic" }}>{tag.notes}</div>
      )}

      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <ActionBtn variant="default" onClick={onEdit}>Edit</ActionBtn>
        {tag.status === "active" && (
          <ActionBtn variant="success" onClick={onComplete}>Complete</ActionBtn>
        )}
        {(tag.status === "completed" || tag.status === "archived") && (
          <ActionBtn variant="primary" onClick={onReactivate}>Reactivate</ActionBtn>
        )}
        {tag.status !== "archived" && (
          <ActionBtn variant="danger" onClick={onArchive}>Archive</ActionBtn>
        )}
      </div>
    </div>
  );
}

// ─── ACTION BUTTON ────────────────────────────────────────────
const VARIANT_STYLE = {
  default: { background: "#fff",    color: "#6b7280", border: "1px solid #e5e7eb" },
  success: { background: "#ecfdf5", color: "#059669", border: "1px solid #d1fae5" },
  primary: { background: "#eff6ff", color: "#3b5bdb", border: "1px solid #dbeafe" },
  danger:  { background: "#fef2f2", color: "#dc2626", border: "1px solid #fee2e2" },
};
function ActionBtn({ variant = "default", onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{ flex: 1, padding: "6px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: FF, ...VARIANT_STYLE[variant] }}
    >{children}</button>
  );
}

// ─── EDIT MODAL ───────────────────────────────────────────────
function TagEditModal({ tag, onClose, onSave }) {
  const [name,      setName]      = useState(tag?.name       || "");
  const [type,      setType]      = useState(tag?.type       || "trip");
  const [startDate, setStartDate] = useState(tag?.start_date || "");
  const [endDate,   setEndDate]   = useState(tag?.end_date   || "");
  const [color,     setColor]     = useState(tag?.color      || "#3b5bdb");
  const [icon,      setIcon]      = useState(tag?.icon       || "");
  const [notes,     setNotes]     = useState(tag?.notes      || "");

  const handleSubmit = () => {
    if (!name.trim()) { showToast("Name is required", "error"); return; }
    onSave({
      name:       name.trim(),
      type,
      start_date: startDate || null,
      end_date:   endDate   || null,
      color,
      icon:       icon || null,
      notes:      notes || null,
    });
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100 }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: "#fff", borderRadius: 16, padding: 24, width: "min(440px, 92vw)", maxHeight: "90vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 14, fontFamily: FF }}
      >
        <div style={{ fontSize: 17, fontWeight: 800, color: "#111827" }}>{tag ? "Edit Tag" : "New Tag"}</div>

        <ModalField label="Name">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g., Bali 2026, Renovasi Rumah"
            style={iStyle}
          />
        </ModalField>

        <ModalField label="Type">
          <select value={type} onChange={e => setType(e.target.value)} style={iStyle}>
            {TAG_TYPES.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
          </select>
        </ModalField>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <ModalField label="Start Date (optional)">
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={iStyle} />
          </ModalField>
          <ModalField label="End Date (optional)">
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={iStyle} />
          </ModalField>
        </div>

        <ModalField label="Icon (emoji, optional)">
          <input
            type="text"
            value={icon}
            onChange={e => setIcon(e.target.value)}
            placeholder="🏖️ ✈️ 🎉"
            maxLength={4}
            style={iStyle}
          />
        </ModalField>

        <ModalField label="Color">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {TAG_COLORS.map(c => (
              <button
                key={c}
                onClick={() => setColor(c)}
                style={{ width: 32, height: 32, borderRadius: 8, background: c, border: color === c ? "3px solid #111827" : "1px solid #e5e7eb", cursor: "pointer" }}
              />
            ))}
          </div>
        </ModalField>

        <ModalField label="Notes (optional)">
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Additional notes…"
            rows={2}
            style={{ ...iStyle, resize: "vertical" }}
          />
        </ModalField>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
          <ActionBtn variant="default" onClick={onClose}>Cancel</ActionBtn>
          <button
            onClick={handleSubmit}
            style={{ flex: 1, padding: "8px 10px", borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: FF, background: "#111827", color: "#fff", border: "none" }}
          >Save</button>
        </div>
      </div>
    </div>
  );
}

function ModalField({ label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</label>
      {children}
    </div>
  );
}

const iStyle = {
  width: "100%", padding: "8px 10px", border: "1px solid #d1d5db",
  borderRadius: 8, fontSize: 14, fontFamily: FF, background: "#fff", boxSizing: "border-box",
};
