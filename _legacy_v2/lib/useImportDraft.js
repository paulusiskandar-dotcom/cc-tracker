import { useEffect, useRef, useState } from "react";
import { importDrafts } from "./importDrafts";

export function useImportDraft({ user, source, accountId = null, state, onRestore }) {
  const [draftInfo, setDraftInfo] = useState(null);
  const [showBanner, setShowBanner] = useState(false);
  const debounceRef = useRef(null);
  const hasMountedRef = useRef(false);
  const onRestoreRef = useRef(onRestore);
  useEffect(() => { onRestoreRef.current = onRestore; });

  // On mount: check for existing draft
  useEffect(() => {
    if (!user?.id) return;
    importDrafts.load(user.id, source, accountId).then(draft => {
      if (draft?.state_json) {
        const rowCount = draft.state_json.rows?.length || draft.state_json.stmtRows?.length || 0;
        if (rowCount > 0) {
          setDraftInfo({ updatedAt: draft.updated_at, rowCount });
          setShowBanner(true);
        }
      }
    });
  }, [user?.id, source, accountId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced auto-save whenever state changes
  useEffect(() => {
    if (!user?.id || !hasMountedRef.current) { hasMountedRef.current = true; return; }
    if (!state) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      importDrafts.save(user.id, source, state, accountId);
    }, 2000);
    return () => clearTimeout(debounceRef.current);
  }, [user?.id, source, accountId, JSON.stringify(state)]); // eslint-disable-line react-hooks/exhaustive-deps

  const resume = async () => {
    if (!user?.id) return;
    const draft = await importDrafts.load(user.id, source, accountId);
    if (draft?.state_json) onRestoreRef.current?.(draft.state_json);
    setShowBanner(false);
  };

  const discard = async () => {
    if (!user?.id) return;
    await importDrafts.clear(user.id, source, accountId);
    setShowBanner(false);
    setDraftInfo(null);
  };

  const clearDraft = async () => {
    if (!user?.id) return;
    await importDrafts.clear(user.id, source, accountId);
    setDraftInfo(null);
    setShowBanner(false);
  };

  return { draftInfo, showBanner, resume, discard, clearDraft };
}
