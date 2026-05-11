import { useState, useEffect, useMemo } from "react";
import { tagsApi } from "../api";
import { supabase } from "../lib/supabase";
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

export default function Tags({ user, ledger, onRefresh }) {
  const [tags,        setTags]        = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [activeTab,   setActiveTab]   = useState("active");
  const [editTag,     setEditTag]     = useState(null); // null | "new" | tag object
  const [selectedTag, setSelectedTag] = useState(null);

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
        // keep selectedTag in sync if editing the currently viewed tag
        if (selectedTag?.id === editTag.id) {
          setSelectedTag({ ...selectedTag, ...tagData });
        }
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

  // Drill-down: show detail view when a tag is selected
  if (selectedTag) {
    return (
      <TagDetailView
        tag={selectedTag}
        user={user}
        ledger={ledger}
        onBack={() => setSelectedTag(null)}
        onRefresh={onRefresh}
        onEdit={() => setEditTag(selectedTag)}
        editTag={editTag}
        setEditTag={setEditTag}
        onSave={handleSave}
      />
    );
  }

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
              onClick={() => setSelectedTag(tag)}
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
function TagCard({ tag, stats, onClick, onEdit, onArchive, onComplete, onReactivate }) {
  const typeInfo = TAG_TYPES.find(t => t.value === tag.type) || TAG_TYPES[0];
  const dateRange = tag.start_date && tag.end_date
    ? `${tag.start_date} → ${tag.end_date}`
    : tag.start_date ? `From ${tag.start_date}` : null;

  return (
    <div
      onClick={onClick}
      style={{ background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 16, padding: 16, borderTop: `3px solid ${tag.color || "#3b5bdb"}`, display: "flex", flexDirection: "column", gap: 8, cursor: "pointer" }}
    >
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
        <ActionBtn variant="default" onClick={(e) => { e.stopPropagation(); onEdit(); }}>Edit</ActionBtn>
        {tag.status === "active" && (
          <ActionBtn variant="success" onClick={(e) => { e.stopPropagation(); onComplete(); }}>Complete</ActionBtn>
        )}
        {(tag.status === "completed" || tag.status === "archived") && (
          <ActionBtn variant="primary" onClick={(e) => { e.stopPropagation(); onReactivate(); }}>Reactivate</ActionBtn>
        )}
        {tag.status !== "archived" && (
          <ActionBtn variant="danger" onClick={(e) => { e.stopPropagation(); onArchive(); }}>Archive</ActionBtn>
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

const smallInputStyle = {
  padding: "6px 8px",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  fontSize: 12,
  fontFamily: FF,
  background: "#fff",
};

// ─── TAG DETAIL VIEW ──────────────────────────────────────────
function TagDetailView({ tag, user, ledger, onBack, onRefresh, onEdit, editTag, setEditTag, onSave }) {
  const [detailTab,       setDetailTab]       = useState("tagged");
  const [selected,        setSelected]        = useState({});
  const [filterSearch,    setFilterSearch]    = useState("");
  const [showAllTypes,    setShowAllTypes]    = useState(false);
  const [busy,            setBusy]            = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  const defaultStartDate = useMemo(() => {
    if (tag.start_date) {
      const d = new Date(tag.start_date);
      d.setMonth(d.getMonth() - 6);
      return d.toISOString().slice(0, 10);
    }
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return d.toISOString().slice(0, 10);
  }, [tag.start_date]);

  const defaultEndDate = useMemo(() => {
    if (tag.end_date) {
      const d = new Date(tag.end_date);
      d.setDate(d.getDate() + 30);
      return d.toISOString().slice(0, 10);
    }
    return today;
  }, [tag.end_date, today]);

  const [filterStartDate, setFilterStartDate] = useState(defaultStartDate);
  const [filterEndDate,   setFilterEndDate]   = useState(defaultEndDate);

  // Reset selection when switching tabs
  useEffect(() => { setSelected({}); }, [detailTab]);

  const taggedEntries = useMemo(() => {
    return (ledger || [])
      .filter(e => e.tag_id === tag.id)
      .sort((a, b) => (b.tx_date || "").localeCompare(a.tx_date || ""));
  }, [ledger, tag.id]);

  const untaggedCandidates = useMemo(() => {
    const search = filterSearch.toLowerCase().trim();
    return (ledger || [])
      .filter(e => !e.tag_id)
      .filter(e => {
        if (filterStartDate && e.tx_date && e.tx_date < filterStartDate) return false;
        if (filterEndDate   && e.tx_date && e.tx_date > filterEndDate)   return false;
        if (!showAllTypes && e.tx_type !== "expense") return false;
        if (search && !((e.description || "").toLowerCase().includes(search))) return false;
        return true;
      })
      .sort((a, b) => (b.tx_date || "").localeCompare(a.tx_date || ""));
  }, [ledger, filterStartDate, filterEndDate, filterSearch, showAllTypes]);

  const totalSpend = useMemo(() => {
    return taggedEntries
      .filter(e => e.tx_type === "expense" || e.tx_type === "buy_asset")
      .reduce((s, e) => s + Number(e.amount_idr || 0), 0);
  }, [taggedEntries]);

  const visibleEntries = detailTab === "tagged" ? taggedEntries : untaggedCandidates;
  const selectedCount  = Object.values(selected).filter(Boolean).length;
  const allSelected    = visibleEntries.length > 0 && visibleEntries.every(e => selected[e.id]);

  const toggleSelect = (id) => setSelected(s => ({ ...s, [id]: !s[id] }));
  const toggleAll    = () => {
    if (allSelected) {
      setSelected({});
    } else {
      setSelected(Object.fromEntries(visibleEntries.map(e => [e.id, true])));
    }
  };

  const handleAssignToTag = async () => {
    const ids = Object.entries(selected).filter(([, v]) => v).map(([id]) => id);
    if (ids.length === 0) return;
    if (!window.confirm(`Assign ${ids.length} transaction(s) to "${tag.name}"?`)) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from("ledger")
        .update({ tag_id: tag.id, updated_at: new Date().toISOString() })
        .in("id", ids);
      if (error) throw error;
      setSelected({});
      if (onRefresh) await onRefresh();
      showToast(`✓ Assigned ${ids.length} transaction(s) to "${tag.name}"`);
    } catch (err) {
      showToast("Failed: " + err.message, "error");
    }
    setBusy(false);
  };

  const handleUntagSelected = async () => {
    const ids = Object.entries(selected).filter(([, v]) => v).map(([id]) => id);
    if (ids.length === 0) return;
    if (!window.confirm(`Remove tag from ${ids.length} transaction(s)?`)) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from("ledger")
        .update({ tag_id: null, updated_at: new Date().toISOString() })
        .in("id", ids);
      if (error) throw error;
      setSelected({});
      if (onRefresh) await onRefresh();
      showToast(`✓ Removed tag from ${ids.length} transaction(s)`);
    } catch (err) {
      showToast("Failed: " + err.message, "error");
    }
    setBusy(false);
  };

  const typeInfo = TAG_TYPES.find(t => t.value === tag.type) || TAG_TYPES[0];
  const dateRange = tag.start_date && tag.end_date
    ? `${tag.start_date} → ${tag.end_date}`
    : tag.start_date ? `From ${tag.start_date}`
    : tag.end_date   ? `Until ${tag.end_date}`
    : "No date range";

  return (
    <div style={{ padding: "24px 20px", fontFamily: FF, maxWidth: 1280, margin: "0 auto" }}>
      {/* Back */}
      <button
        onClick={onBack}
        style={{ padding: "6px 12px", background: "transparent", border: "1px solid #e5e7eb", borderRadius: 6, fontSize: 12, fontWeight: 600, color: "#6b7280", cursor: "pointer", fontFamily: FF, marginBottom: 16 }}
      >← Back to Tags</button>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 28 }}>{tag.icon || typeInfo.icon}</span>
          <div>
            <div style={{ fontSize: 24, fontWeight: 800, color: "#111827" }}>{tag.name}</div>
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
              {typeInfo.label} · {dateRange}
            </div>
          </div>
        </div>
        <button
          onClick={onEdit}
          style={{ padding: "8px 16px", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 6, fontSize: 12, fontWeight: 600, color: "#6b7280", cursor: "pointer", fontFamily: FF }}
        >Edit Tag</button>
      </div>

      {/* Color bar */}
      <div style={{ height: 4, background: tag.color || "#3b5bdb", borderRadius: 2, marginBottom: 16 }} />

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24 }}>
        <KPICard label="Total Spend"           value={fmtIDR(totalSpend)}            color={tag.color || "#3b5bdb"} />
        <KPICard label="Tagged"                value={taggedEntries.length}           color="#059669" />
        <KPICard label="Untagged Candidates"   value={untaggedCandidates.length}      color="#d97706" />
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid #e5e7eb" }}>
        {[
          { key: "tagged",   label: `Tagged (${taggedEntries.length})` },
          { key: "untagged", label: `Untagged Candidates (${untaggedCandidates.length})` },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setDetailTab(t.key)}
            style={{
              padding: "10px 16px", border: "none", background: "transparent",
              fontSize: 13, fontWeight: 600, fontFamily: FF,
              color: detailTab === t.key ? "#111827" : "#6b7280",
              borderBottom: `2px solid ${detailTab === t.key ? "#111827" : "transparent"}`,
              cursor: "pointer",
            }}
          >{t.label}</button>
        ))}
      </div>

      {/* Filters (untagged tab only) */}
      {detailTab === "untagged" && (
        <div style={{ background: "#f9fafb", border: "0.5px solid #e5e7eb", borderRadius: 12, padding: 12, marginBottom: 16, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "#6b7280" }}>FROM</label>
            <input type="date" value={filterStartDate} onChange={e => setFilterStartDate(e.target.value)} style={smallInputStyle} />
            <label style={{ fontSize: 11, fontWeight: 600, color: "#6b7280" }}>TO</label>
            <input type="date" value={filterEndDate}   onChange={e => setFilterEndDate(e.target.value)}   style={smallInputStyle} />
          </div>
          <input
            type="text"
            placeholder="Search description…"
            value={filterSearch}
            onChange={e => setFilterSearch(e.target.value)}
            style={{ ...smallInputStyle, flex: 1, minWidth: 180 }}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={showAllTypes} onChange={e => setShowAllTypes(e.target.checked)} style={{ cursor: "pointer" }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: "#6b7280" }}>Show all types</span>
          </label>
        </div>
      )}

      {/* Bulk action bar */}
      {selectedCount > 0 && (
        <div style={{ background: "#eff6ff", border: "1px solid #93c5fd", borderRadius: 8, padding: 10, marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#1e3a8a" }}>{selectedCount} selected</span>
          {detailTab === "untagged" ? (
            <button
              onClick={handleAssignToTag}
              disabled={busy}
              style={{ padding: "8px 16px", background: busy ? "#9ca3af" : "#3b5bdb", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: busy ? "not-allowed" : "pointer", fontFamily: FF }}
            >{busy ? "Saving…" : `Assign ${selectedCount} to "${tag.name}"`}</button>
          ) : (
            <button
              onClick={handleUntagSelected}
              disabled={busy}
              style={{ padding: "8px 16px", background: busy ? "#9ca3af" : "#dc2626", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: busy ? "not-allowed" : "pointer", fontFamily: FF }}
            >{busy ? "Saving…" : `Remove tag from ${selectedCount}`}</button>
          )}
        </div>
      )}

      {/* Entry list */}
      <div style={{ background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
        {/* Column header */}
        {visibleEntries.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", background: "#fafafa", borderBottom: "1px solid #e5e7eb", fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5 }}>
            <input type="checkbox" checked={allSelected} onChange={toggleAll} style={{ cursor: "pointer", margin: 0 }} />
            <span style={{ width: 88 }}>Date</span>
            <span style={{ flex: 1 }}>Description</span>
            <span style={{ width: 100 }}>Type</span>
            <span style={{ width: 120, textAlign: "right" }}>Amount</span>
          </div>
        )}

        {visibleEntries.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
            {detailTab === "tagged"
              ? `No transactions tagged yet. Switch to "Untagged Candidates" to assign.`
              : `No untagged transactions match the current filter.`}
          </div>
        ) : (
          visibleEntries.map(e => (
            <div
              key={e.id}
              onClick={() => toggleSelect(e.id)}
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: "1px solid #f3f4f6", cursor: "pointer", background: selected[e.id] ? "#eff6ff" : "#fff", fontSize: 13 }}
            >
              <input
                type="checkbox"
                checked={!!selected[e.id]}
                onChange={() => toggleSelect(e.id)}
                onClick={ev => ev.stopPropagation()}
                style={{ cursor: "pointer", margin: 0 }}
              />
              <span style={{ width: 88, color: "#6b7280", fontSize: 12 }}>{e.tx_date}</span>
              <span style={{ flex: 1, color: "#111827", fontWeight: 500 }}>{e.description || "—"}</span>
              <span style={{ width: 100 }}>
                <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 4, background: e.tx_type === "expense" ? "#fef2f2" : "#f3f4f6", color: e.tx_type === "expense" ? "#dc2626" : "#6b7280", textTransform: "capitalize" }}>
                  {(e.tx_type || "").replace(/_/g, " ")}
                </span>
              </span>
              <span style={{ width: 120, textAlign: "right", fontWeight: 700, color: e.tx_type === "expense" ? "#dc2626" : "#111827" }}>
                {fmtIDR(Number(e.amount_idr || e.amount || 0))}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Edit modal (reuse from parent scope via prop) */}
      {editTag && (
        <TagEditModal
          tag={editTag === "new" ? null : editTag}
          onClose={() => setEditTag(null)}
          onSave={onSave}
        />
      )}
    </div>
  );
}
